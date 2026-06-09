import crypto from 'node:crypto';
import { MessengerBridgeStore } from './messenger-bridge-store.js';
import { executeMessengerCommand, parseLeadingCommand } from './messenger-commands.js';
import { DEFAULT_VERBOSITY, normalizeVerbosity } from './messenger-verbosity.js';
import { renderPartForMessenger, renderPermissionContext, escapeMd, clipBlock } from './messenger-render.js';

/**
 * Bidirectional bridge between Discord/Telegram and OpenCode chat sessions.
 *
 * Threading model (modelled after https://github.com/remorses/kimaki):
 *   - Each new conversation starter in a Discord text channel spawns a public
 *     Thread on that message via POST /channels/:id/messages/:id/threads. The
 *     OpenCode session is bound to the THREAD, not the channel. Follow-up
 *     messages posted inside the thread reuse the same session.
 *   - Telegram already gets per-topic surfaces from message_thread_id; no
 *     thread creation needed.
 *
 * Outbound model:
 *   - One new Discord/Telegram message per renderable OpenCode part.
 *     No edit-in-place — text streams complete (part.time.end set) before
 *     they're posted, tool runs post a single one-liner per state change,
 *     reasoning posts a `┣ thinking` marker.
 *   - Tool summaries follow kimaki's compact format: file name and ±line
 *     count for edits, file name for reads, escaped command for bash,
 *     match count for glob/grep, etc. Not `[⋯ tool-name]`.
 *   - Typing indicator pulses every 7s (Discord) / 4s (Telegram) while a
 *     session has unfinished assistant work — to give the user a visible
 *     "thinking…" affordance without spamming the chat.
 */

const DISCORD_LIMIT = 2000;
const TELEGRAM_LIMIT = 4096;
const NAME_TTL_MS = 5 * 60_000;
const TYPING_PULSE_DISCORD_MS = 7_000;
const TYPING_PULSE_TELEGRAM_MS = 4_000;

function tokenHash(token) {
  if (!token) return '';
  return crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 12);
}

/**
 * Stable key identifying a conversation surface. We want the SAME key
 * whether the gateway delivers a brand-new message in a parent channel
 * (we're about to spawn a thread) or a follow-up inside an existing
 * thread.
 *
 * Discord: thread channels carry their own unique IDs, so once a thread
 *   exists we key purely by the thread id. The parent-channel id is
 *   irrelevant from then on (and Discord MESSAGE_CREATE on a follow-up
 *   gives us `channel_id = thread_id` with no `parent_id` in the payload).
 *
 * Telegram: forum topics are scoped per-chat, so we keep "chat:topic".
 */
function targetKey({ type, channelId, threadId }) {
  if (type === 'discord') {
    return threadId ? `${threadId}` : `${channelId}`;
  }
  return threadId ? `${channelId}:${threadId}` : `${channelId}`;
}

function maxLenFor(type) {
  return type === 'discord' ? DISCORD_LIMIT : TELEGRAM_LIMIT;
}

function slugify(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function pickProjectForName(projects, name) {
  if (!name) return null;
  const wanted = slugify(name);
  if (!wanted) return null;
  for (const p of projects) {
    const candidates = [
      slugify(p.label ?? ''),
      slugify((p.path ?? '').split('/').pop() ?? ''),
      slugify(p.id ?? ''),
    ];
    if (candidates.includes(wanted)) return p;
  }
  for (const p of projects) {
    const candidates = [
      slugify(p.label ?? ''),
      slugify((p.path ?? '').split('/').pop() ?? ''),
    ].filter(Boolean);
    if (candidates.some((c) => wanted.includes(c) || c.includes(wanted))) return p;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Discord / Telegram REST adapters
// ---------------------------------------------------------------------------

async function sendDiscord({ token, channelId, content }) {
  const r = await fetch(
    `https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`,
    {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.slice(0, DISCORD_LIMIT) }),
    },
  );
  if (!r.ok) return { ok: false, error: `Discord ${r.status}: ${(await r.text()).slice(0, 200)}` };
  const data = await r.json();
  return { ok: true, id: data.id };
}

async function sendTelegram({ token, chatId, threadId, content }) {
  const body = { chat_id: chatId, text: content.slice(0, TELEGRAM_LIMIT) };
  if (threadId) body.message_thread_id = Number(threadId);
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!d.ok) return { ok: false, error: d.description ?? `Telegram ${r.status}` };
  return { ok: true, id: d.result?.message_id };
}

// ── Approval flow helpers ─────────────────────────────────────────────
// Maps approvalId → { sessionID, requestID, directory, sdkDirectory }
// so button clicks can be routed back to OpenCode's permission.reply API.
export const approvalContexts = new Map();

/** Generate a unique approval ID. */
function generateApprovalId() {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Post an approval-request message with Approve / Deny buttons.
 * Returns { ok, approvalId, messageId } or { ok, error }.
 */
async function sendApprovalToSurface({ type, token, channelId, threadId, permission, directory }) {
  const approvalId = generateApprovalId();
  const tool = String(permission?.permission ?? 'approval');
  const contextStr = renderPermissionContext(permission);
  const preamble = `⚠️ **Permission Required** — \`${escapeMd(tool)}\``;
  const content = contextStr
    ? `${preamble}\n\n${contextStr}`
    : `⚠️ **Permission Required** — \`${escapeMd(tool)}\``;

  // Always show 3 buttons: Approve (once), Always Allow, Deny
  // matching the web UI's PermissionCard behavior
  const alwaysStr = Array.isArray(permission?.always) && permission.always.length > 0
    ? permission.always.slice(0, 2).join(', ') + (permission.always.length > 2 ? '…' : '')
    : '';

  // Helper to store and auto-expire approval context
  const storeApprovalContext = () => {
    approvalContexts.set(approvalId, {
      sessionID: permission?.sessionID,
      requestID: permission?.id,
      directory: directory || permission?.metadata?.directory || null,
      sdkDirectory: permission?.metadata?.sdkDirectory || directory || null,
      createdAt: Date.now(),
    });
    setTimeout(() => approvalContexts.delete(approvalId), 10 * 60 * 1000).unref();
  };

  if (type === 'discord') {
    // Build Discord buttons: Approve, Always Allow, Deny
    const buttons = [
      { type: 2, style: 3, label: '✅ Allow Once', custom_id: `otto-approve:${approvalId}` },
      { type: 2, style: 2, label: alwaysStr ? `Always: ${alwaysStr}` : '♻️ Always Allow', custom_id: `otto-approve-always:${approvalId}` },
      { type: 2, style: 4, label: '❌ Deny', custom_id: `otto-deny:${approvalId}` },
    ];

    const ch = threadId ?? channelId;
    const r = await fetch(
      `https://discord.com/api/v10/channels/${encodeURIComponent(ch)}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: content.slice(0, DISCORD_LIMIT),
          components: [{ type: 1, components: buttons }],
        }),
      },
    );
    if (!r.ok) {
      console.error('[BRIDGE] Failed to send approval to Discord:', r.status, (await r.text()).slice(0, 200));
      return { ok: false, error: `Discord ${r.status}: ${(await r.text()).slice(0, 200)}` };
    }
    // Only store context after the Discord API call succeeds
    storeApprovalContext();
    const data = await r.json();
    return { ok: true, approvalId, messageId: data.id };
  }

  // Telegram
  // Build Telegram inline keyboard: Approve, Always Allow, Deny
  const tgButtons = [
    { text: '✅ Allow Once', callback_data: `otto-approve:${approvalId}` },
    { text: alwaysStr ? `Always: ${alwaysStr}` : '♻️ Always Allow', callback_data: `otto-approve-always:${approvalId}` },
    { text: '❌ Deny', callback_data: `otto-deny:${approvalId}` },
  ];

  const tgBody = {
    chat_id: channelId,
    text: content.slice(0, TELEGRAM_LIMIT),
    reply_markup: {
      inline_keyboard: [tgButtons],
    },
  };
  if (threadId) tgBody.message_thread_id = Number(threadId);

  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tgBody),
  });
  const d = await r.json();
  if (!d.ok) {
    console.error('[BRIDGE] Failed to send approval to Telegram:', d.description ?? `HTTP ${r.status}`);
    return { ok: false, error: d.description ?? `Telegram ${r.status}` };
  }
  // Only store context after the Telegram API call succeeds
  storeApprovalContext();
  return { ok: true, approvalId, messageId: d.result?.message_id };
}

/**
 * Create a public Discord thread starting from a user's message. Returns
 * the new thread id, or null when the API call failed (we fall back to
 * the channel in that case so the user still gets a reply).
 */
async function startDiscordThread({ token, channelId, messageId, name }) {
  if (!messageId) return { ok: false, error: 'no source message id' };
  const safeName = (name || 'Otto').replace(/\s+/g, ' ').slice(0, 80) || 'Otto';
  const r = await fetch(
    `https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/threads`,
    {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: safeName, auto_archive_duration: 1440 }),
    },
  );
  if (!r.ok) return { ok: false, error: `Discord ${r.status}: ${(await r.text()).slice(0, 200)}` };
  const data = await r.json();
  return { ok: true, threadId: data.id ?? null, threadName: data.name ?? safeName };
}

async function discordTyping({ token, channelId }) {
  try {
    await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/typing`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}` },
    });
  } catch {
    // ignore
  }
}

async function telegramTyping({ token, chatId, threadId }) {
  try {
    const body = { chat_id: chatId, action: 'typing' };
    if (threadId) body.message_thread_id = Number(threadId);
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Bridge factory
// ---------------------------------------------------------------------------

export function createMessengerOpencodeBridge({
  globalEventHub,
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  broadcastEvent,
  store,
  listProjects,
  /**
   * Optional bootstrap handler called when an unbound channel sends a
   * `clone <url>` / `path <abs>` / `new <label>` reply. Signature:
   *   ({ action, url?, path?, label? }) => { ok, project?: { id, path, label }, error? }
   * If unset, the bridge falls back to slug-matching / first-project.
   */
  bootstrapProject = null,
  /**
   * Optional lookup function for reverse-mapping a session ID to a
   * messenger surface. Used by the permission.asked handler when the
   * session is not tracked locally (e.g. gateway bot handles inbound).
   * Signature: (sessionId) => { type, token, targetKey, threadId?, projectPath? } | null
   */
  lookupMessengerTarget = null,
  /**
   * Optional accessor for the OpenChamber-wide defaults the rest of the UI
   * uses (Settings → Defaults). Lets the messenger fall back to the SAME
   * default model/agent the web chat uses instead of whatever OpenCode would
   * pick on its own. Signature: () => { model?: string|null, agent?: string|null }
   * (may be async).
   */
  getGlobalDefaults = null,
}) {
  const bridgeStore = store ?? new MessengerBridgeStore();

  /**
   * Resolve the OpenChamber-wide default model/agent (Settings → Defaults).
   * Best-effort: returns `{ model: null, agent: null }` when unavailable so
   * callers can fall through to OpenCode's own default.
   */
  async function resolveGlobalDefaults() {
    if (!getGlobalDefaults) return { model: null, agent: null };
    try {
      const d = await getGlobalDefaults();
      const model =
        typeof d?.model === 'string' && /^[^/]+\/[^/]+$/.test(d.model.trim())
          ? d.model.trim()
          : null;
      const agent = typeof d?.agent === 'string' && d.agent.trim() ? d.agent.trim() : null;
      return { model, agent };
    } catch {
      return { model: null, agent: null };
    }
  }

  // Per-session live context. Holds the messenger surface (channel/thread)
  // OpenCode events should be routed to, and the set of part ids we've
  // already posted (so we don't double-post on partial-update events).
  /** @type {Map<string, {
   *   type: 'discord'|'telegram',
   *   token: string,
   *   channelId: string,
   *   threadId: string|null,
   *   sentPartIds: Set<string>,
   *   typingTimer?: NodeJS.Timeout,
   *   startedAt: number,
   *   lastError: string|null,
   * }>}
   */
  const sessionContexts = new Map();

  // Per-surface project bootstrap dialogue state. When a new channel sends
  // its first message and we have no slug-match (and the user has not yet
  // told us what project this channel maps to), we stash the original
  // text here and ask "clone | path | new". The follow-up reply lands here
  // and triggers the bootstrap.
  /** @type {Map<string, { type, token, channelId, threadId, sourceMessageId, originalText, askedAt }>} */
  const bootstrapPending = new Map();

  /**
   * Bootstrap dialogue key — uses the same Discord-aware semantics as
   * targetKey so the first message's stash and the user's reply (which
   * arrives with `channel_id = thread_id` on Discord) land on the same
   * surface.
   */
  function bootstrapKey({ type, channelId, threadId }) {
    return `${type}:${targetKey({ type, channelId, threadId })}`;
  }

  /**
   * Parse a user's bootstrap reply. Returns `{ action, url?, path?, label? }`
   * or null when the message isn't a bootstrap command.
   */
  function parseBootstrapReply(text) {
    if (typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (!trimmed) return null;
    const m = trimmed.match(/^(clone|path|new)\s+(.+)$/i);
    if (!m) return null;
    const action = m[1].toLowerCase();
    const rest = m[2].trim();
    if (action === 'clone') return { action: 'clone', url: rest };
    if (action === 'path') return { action: 'path', path: rest };
    if (action === 'new') return { action: 'new', label: rest };
    return null;
  }

  // Cache: target name lookups (for slug-matching projects).
  const nameCache = new Map();

  async function lookupTargetName({ type, token, channelId, threadId }) {
    const key = `${type}:${channelId}${threadId ? `:${threadId}` : ''}`;
    const cached = nameCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.name;
    let name = null;
    try {
      if (type === 'discord') {
        const lookupId = threadId ?? channelId;
        const r = await fetch(
          `https://discord.com/api/v10/channels/${encodeURIComponent(lookupId)}`,
          { headers: { Authorization: `Bot ${token}` } },
        );
        if (r.ok) {
          const data = await r.json();
          name = data.name ?? null;
        }
      } else if (type === 'telegram') {
        const r = await fetch(`https://api.telegram.org/bot${token}/getChat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: channelId }),
        });
        const data = await r.json();
        if (data.ok) name = data.result?.title ?? data.result?.username ?? null;
      }
    } catch {
      // ignore
    }
    nameCache.set(key, { name, expiresAt: Date.now() + NAME_TTL_MS });
    return name;
  }

  async function autoResolveProject({ type, token, channelId, threadId }) {
    if (!listProjects) return null;
    let projects = [];
    try {
      projects = (await listProjects()) ?? [];
    } catch {
      return null;
    }
    if (!Array.isArray(projects) || projects.length === 0) return null;
    const name = await lookupTargetName({ type, token, channelId, threadId });
    const matched = pickProjectForName(projects, name);
    const project = matched ?? projects[0];
    if (!project?.path) return null;
    return {
      projectPath: project.path,
      projectLabel: project.label ?? project.path.split('/').pop() ?? project.path,
      autoResolved: !matched ? 'fallback-first' : 'slug-match',
      resolvedFromName: name,
    };
  }

  // --- OpenCode REST ------------------------------------------------------
  async function opencodeFetch(pathSuffix, init = {}) {
    const url = buildOpenCodeUrl(pathSuffix, '');
    const headers = {
      ...(init.headers ?? {}),
      ...(getOpenCodeAuthHeaders?.() ?? {}),
      'Content-Type': 'application/json',
    };
    return fetch(url, { ...init, headers });
  }

  async function createOpencodeSession({ projectPath, title }) {
    const params = projectPath ? `?directory=${encodeURIComponent(projectPath)}` : '';
    const r = await opencodeFetch(`/session${params}`, {
      method: 'POST',
      body: JSON.stringify({ title: title ?? 'Otto messenger session' }),
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`OpenCode session create ${r.status}: ${text.slice(0, 200)}`);
    }
    const data = await r.json();
    return data?.id ?? data?.sessionID ?? data?.session_id ?? data;
  }

  async function sendOpencodePrompt({ sessionId, projectPath, text, modelOverride, agentOverride }) {
    const params = projectPath ? `?directory=${encodeURIComponent(projectPath)}` : '';
    const body = { parts: [{ type: 'text', text }] };
    if (modelOverride && /^[^/]+\/[^/]+$/.test(modelOverride)) {
      const [providerID, ...rest] = modelOverride.split('/');
      body.model = { providerID, modelID: rest.join('/') };
    }
    if (agentOverride) body.agent = agentOverride;
    const r = await opencodeFetch(
      `/session/${encodeURIComponent(sessionId)}/prompt_async${params}`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    if (!r.ok) {
      const errText = await r.text();
      throw new Error(`OpenCode prompt ${r.status}: ${errText.slice(0, 300)}`);
    }
    return true;
  }

  /**
   * Small adapter exposed to the messenger-command handlers so they can
   * talk to OpenCode without re-implementing the auth/url plumbing.
   */
  const opencodeAdapter = {
    async listProviders() {
      const r = await opencodeFetch('/provider');
      if (!r.ok) return [];
      const d = await r.json().catch(() => null);
      // OpenCode returns { location, data: [...] } (w/ /api prefix),
      // { all: [...], default: ..., connected: [...] } (w/o /api prefix),
      // { providers: [...] }, or a bare array on older versions — be defensive.
      const raw = Array.isArray(d) ? d
        : Array.isArray(d?.data) ? d.data
        : Array.isArray(d?.all) ? d.all
        : Array.isArray(d?.providers) ? d.providers
        : [];
      return raw.map((p) => ({
        id: p.id ?? p.name,
        name: p.name ?? p.id,
        models: Array.isArray(p.models)
          ? p.models.map((m) => ({ id: m.id ?? m.name, name: m.name ?? m.id }))
          : [],
      }));
    },
    async listAgents() {
      const r = await opencodeFetch('/agent');
      if (!r.ok) return [];
      const d = await r.json().catch(() => null);
      const raw = Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : Array.isArray(d?.agents) ? d.agents : [];
      return raw.map((a) => ({
        name: a.name,
        description: a.description,
        model: a.model,
        hidden: Boolean(a.hidden),
        mode: a.mode,
      }));
    },
    async listSessions(directory) {
      const params = directory ? `?directory=${encodeURIComponent(directory)}` : '';
      const r = await opencodeFetch(`/session${params}`);
      if (!r.ok) return [];
      const d = await r.json().catch(() => null);
      const raw = Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : Array.isArray(d?.sessions) ? d.sessions : [];
      return raw;
    },
    async abortSession(sessionId) {
      try {
        const r = await opencodeFetch(`/session/${encodeURIComponent(sessionId)}/abort`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        if (!r.ok) return { ok: false, error: `OpenCode ${r.status}: ${(await r.text()).slice(0, 200)}` };
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e?.message ?? 'abort failed' };
      }
    },
    async revertSession(sessionId, messageId) {
      try {
        const body = messageId ? { messageID: messageId } : {};
        const r = await opencodeFetch(`/session/${encodeURIComponent(sessionId)}/revert`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        if (!r.ok) return { ok: false, error: `OpenCode ${r.status}: ${(await r.text()).slice(0, 200)}` };
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e?.message ?? 'revert failed' };
      }
    },
    async unrevertSession(sessionId) {
      try {
        const r = await opencodeFetch(`/session/${encodeURIComponent(sessionId)}/unrevert`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        if (!r.ok) return { ok: false, error: `OpenCode ${r.status}: ${(await r.text()).slice(0, 200)}` };
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e?.message ?? 'unrevert failed' };
      }
    },
    async summarizeSession(sessionId, modelRef) {
      try {
        const body = {};
        if (modelRef && /^[^/]+\/[^/]+$/.test(modelRef)) {
          const [providerID, ...rest] = modelRef.split('/');
          body.providerID = providerID;
          body.modelID = rest.join('/');
        }
        const r = await opencodeFetch(`/session/${encodeURIComponent(sessionId)}/summarize`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        if (!r.ok) return { ok: false, error: `OpenCode ${r.status}: ${(await r.text()).slice(0, 200)}` };
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e?.message ?? 'summarize failed' };
      }
    },
    async sendOpencodeCommand(sessionId, name, argsText) {
      try {
        const r = await opencodeFetch(`/session/${encodeURIComponent(sessionId)}/command`, {
          method: 'POST',
          body: JSON.stringify({ command: name, arguments: argsText ?? '' }),
        });
        if (!r.ok) return { ok: false, error: `OpenCode ${r.status}: ${(await r.text()).slice(0, 200)}` };
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e?.message ?? 'command failed' };
      }
    },
    async sendPrompt(sessionId, projectPath, text) {
      try {
        await sendOpencodePrompt({ sessionId, projectPath, text });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e?.message ?? 'prompt failed' };
      }
    },
  };

  // --- Session resolution -------------------------------------------------
  async function resolveOrCreateSession({ type, token, channelId, threadId, projectPath, projectLabel }) {
    const hash = tokenHash(token);
    const key = targetKey({ type, channelId, threadId });
    const existing = bridgeStore.lookup({ type, botTokenHash: hash, targetKey: key });
    if (existing?.sessionId) {
      bridgeStore.touch({ type, botTokenHash: hash, targetKey: key });
      return { sessionId: existing.sessionId, projectPath: existing.projectPath, autoResolved: 'cached' };
    }

    let effectivePath = projectPath ?? null;
    let effectiveLabel = projectLabel ?? null;
    let autoResolved = null;
    let resolvedFromName = null;
    if (!effectivePath) {
      const auto = await autoResolveProject({ type, token, channelId, threadId });
      if (auto) {
        effectivePath = auto.projectPath;
        effectiveLabel = auto.projectLabel;
        autoResolved = auto.autoResolved;
        resolvedFromName = auto.resolvedFromName;
      }
    }

    const title = effectiveLabel
      ? `Otto · ${type} · ${effectiveLabel}`
      : `Otto · ${type} · ${channelId}${threadId ? `:${threadId}` : ''}`;
    const sessionId = await createOpencodeSession({ projectPath: effectivePath, title });
    bridgeStore.bind({
      type,
      botTokenHash: hash,
      targetKey: key,
      sessionId,
      projectPath: effectivePath,
      projectLabel: effectiveLabel,
    });
    broadcastEvent?.('messenger.bridge.session_bound', {
      type,
      channelId,
      threadId,
      sessionId,
      projectPath: effectivePath,
      projectLabel: effectiveLabel,
      autoResolved,
      resolvedFromName,
    });
    return { sessionId, projectPath: effectivePath, autoResolved };
  }

  /**
   * Resolve the effective verbosity for a surface at render time.
   * Resolution order: surface override (`/verbosity X`) → parent-channel
   * override (for thread follow-ups) → per-messenger UI default → `normal`.
   */
  function resolveVerbosity({ type, token, channelId, threadId }) {
    const hash = tokenHash(token);
    const stableKey = targetKey({ type, channelId, threadId });
    let level = null;
    try {
      const row = bridgeStore.lookup({ type, botTokenHash: hash, targetKey: stableKey });
      level = row?.verbosityOverride ?? null;
      if (!level && stableKey !== String(channelId)) {
        const parent = bridgeStore.lookup({
          type,
          botTokenHash: hash,
          targetKey: String(channelId),
        });
        level = parent?.verbosityOverride ?? null;
      }
      if (!level) level = bridgeStore.getVerbosityDefault?.(type) ?? null;
    } catch {
      // ignore — verbosity is best-effort, fall back to the default
    }
    return normalizeVerbosity(level ?? DEFAULT_VERBOSITY);
  }

  // --- Outbound: post one message per renderable part --------------------
  async function postToSurface(ctx, content) {
    return postMessengerSurface(ctx, content);
  }

  /** Like postToSurface but takes a raw surface descriptor — used by the
   *  bootstrap dialogue before a session exists. */
  async function postMessengerSurface({ type, token, channelId, threadId }, content) {
    if (!content) return { ok: false, error: 'empty content' };
    if (type === 'discord') {
      const ch = threadId ?? channelId;
      return sendDiscord({ token, channelId: ch, content });
    }
    return sendTelegram({ token, chatId: channelId, threadId, content });
  }

  function startTypingPulse(ctx) {
    if (ctx.typingTimer) return;
    const pulse = async () => {
      if (!sessionContexts.has(ctx.sessionId)) return;
      if (ctx.type === 'discord') {
        await discordTyping({ token: ctx.token, channelId: ctx.threadId ?? ctx.channelId });
      } else {
        await telegramTyping({ token: ctx.token, chatId: ctx.channelId, threadId: ctx.threadId });
      }
      ctx.typingTimer = setTimeout(
        pulse,
        ctx.type === 'discord' ? TYPING_PULSE_DISCORD_MS : TYPING_PULSE_TELEGRAM_MS,
      );
    };
    // First pulse immediately so the user sees the indicator right away.
    void pulse();
  }

  function stopTypingPulse(ctx) {
    if (ctx.typingTimer) {
      clearTimeout(ctx.typingTimer);
      ctx.typingTimer = undefined;
    }
  }

  async function emitPart(sessionId, part) {
    const ctx = sessionContexts.get(sessionId);
    if (!ctx) return;
    const partId = part?.id;
    const partType = part?.type;
    const verbosity = normalizeVerbosity(ctx.verbosity);

    // Skip duplicates we've already posted (parts get many updates as they
    // stream — we only want one Discord/Telegram message per logical part).
    // Tools transition pending → running → completed/error; we want the
    // running/error/completed event with a stable state, not every delta.
    if (partType === 'text') {
      if (!part?.time?.end) return; // wait until streaming finishes
    }
    if (partType === 'tool') {
      // `quiet` suppresses tool activity entirely.
      if (verbosity === 'quiet') return;
      const status = part.state?.status ?? 'running';
      // One message per tool, at the terminal state. Posting a separate
      // "running" line and then a "completed" line doubled every tool into
      // two messages and made the feed unreadable. Waiting for the terminal
      // state also lets the one-liner include result metadata (match counts,
      // error text) and, at `verbose`, the real input + output spoiler.
      if (status !== 'completed' && status !== 'error') return;
    }
    if (partType === 'reasoning') {
      if (verbosity === 'quiet') return;
      // Post a single thinking marker per reasoning block — once.
    }

    const dedupKey = partId ? `${partId}:${partType}:${part?.state?.status ?? ''}` : null;
    if (dedupKey && ctx.sentPartIds.has(dedupKey)) return;

    const rendered = renderPartForMessenger(part, verbosity);
    if (!rendered) return;

    const sent = await postToSurface(ctx, rendered);
    if (!sent.ok) {
      ctx.lastError = sent.error;
      return;
    }
    if (dedupKey) ctx.sentPartIds.add(dedupKey);
  }

  function handleGlobalEvent(normalized) {
    const payload = normalized.payload ?? normalized;
    if (!payload || typeof payload !== 'object') return;
    const type = payload.type ?? payload.event ?? null;
    const props = payload.properties ?? payload.props ?? payload;
    // The SSE envelope carries the authoritative directory the event belongs
    // to. This is the directory OpenCode expects when we reply to a permission
    // request — more reliable than guessing from the session's project path.
    const envelopeDirectory =
      typeof normalized?.directory === 'string' &&
      normalized.directory.length > 0 &&
      normalized.directory !== 'global'
        ? normalized.directory
        : null;

    if (type === 'message.part.updated') {
      const part = props?.part;
      const sessionId = part?.sessionID ?? part?.sessionId ?? props?.sessionID ?? null;
      if (!sessionId || !sessionContexts.has(sessionId)) return;
      if (part?.role === 'user') return;
      void emitPart(sessionId, part);
      return;
    }
    if (type === 'message.updated') {
      // We rely on part.updated for line-by-line streaming; nothing to do here.
      return;
    }
    if (type === 'session.idle') {
      const sessionId = props?.sessionID ?? props?.sessionId ?? null;
      const ctx = sessionId ? sessionContexts.get(sessionId) : null;
      if (!ctx) return;
      stopTypingPulse(ctx);
      const ms = Date.now() - ctx.startedAt;
      const duration = ms < 1000 ? ms + 'ms' : Math.round(ms / 100) / 10 + 's';

      // Fetch model + token + context limit from OpenCode API.
      void (async () => {
        let footer = `_done · ${duration}`;
        try {
          const dir = ctx.projectPath ? `?directory=${encodeURIComponent(ctx.projectPath)}` : '';
          const [sessionRes, providersRes] = await Promise.all([
            opencodeFetch(`/session/${encodeURIComponent(sessionId)}${dir}`),
            opencodeFetch(`/provider`),
          ]);
          if (sessionRes.ok) {
            const d = await sessionRes.json().catch(() => null);
            const modelInfo = d?.model;
            const tokensInfo = d?.tokens;

            // Add model name
            if (modelInfo) {
              const modelId = modelInfo.id ?? '';
              const providerId = modelInfo.providerID ?? '';
              const modelStr = providerId ? `${providerId}/${modelId}` : modelId;
              if (modelStr) footer += ` ⋅ \`${modelStr}\``;
            }

            // Add token count + context percentage
            if (tokensInfo && typeof tokensInfo === 'object') {
              const total =
                (tokensInfo.input ?? 0) +
                (tokensInfo.output ?? 0) +
                (tokensInfo.reasoning ?? 0) +
                (tokensInfo.cache?.read ?? 0) +
                (tokensInfo.cache?.write ?? 0);

              // Look up context limit from provider data
              let contextLimit = null;
              if (providersRes.ok) {
                try {
                  const pd = await providersRes.json();
                  const allProviders = Array.isArray(pd?.all) ? pd.all : Array.isArray(pd?.data) ? pd.data : [];
                  const targetProvider = allProviders.find((p) => p.id === modelInfo?.providerID);
                  if (targetProvider?.models) {
                    const models = Array.isArray(targetProvider.models)
                      ? targetProvider.models
                      : Object.values(targetProvider.models);
                    const targetModel = models.find((m) => (m.id ?? m.name) === modelInfo?.id);
                    if (targetModel?.limit?.context) {
                      contextLimit = targetModel.limit.context;
                    }
                  }
                } catch {}
              }

              if (total > 0) {
                footer += ` ⋅ ${total.toLocaleString()} tokens`;
                if (contextLimit && contextLimit > 0) {
                  const pct = Math.round((total / contextLimit) * 100);
                  footer += ` (${pct}%)`;
                }
              }
            }
          }
        } catch {
          // Best-effort — fall back to duration-only footer.
        }
        footer += '_';
        void postToSurface(ctx, footer);
      })();

      // Keep ctx around — follow-up messages in the same thread will reuse
      // the session id; but reset sentPartIds and startedAt for the next turn.
      ctx.sentPartIds.clear();
      ctx.startedAt = Date.now();
      broadcastEvent?.('messenger.bridge.session_idle', {
        type: ctx.type,
        sessionId,
        channelId: ctx.channelId,
        threadId: ctx.threadId,
      });
      return;
    }
    if (type === 'session.error') {
      const sessionId = props?.sessionID ?? props?.sessionId ?? null;
      const ctx = sessionId ? sessionContexts.get(sessionId) : null;
      if (!ctx) return;
      stopTypingPulse(ctx);
      const err = (() => {
        const raw = props?.error;
        if (!raw) return 'OpenCode session error';
        if (typeof raw === 'string') return raw;
        if (typeof raw?.message === 'string' && raw.message) return raw.message;
        if (typeof raw?.cause === 'object' && raw.cause) {
          const c = raw.cause;
          const failures = c.failures ?? c;
          if (Array.isArray(failures) && failures.length > 0) {
            const first = failures[0];
            const errMsg = first?.error?.message ?? first?.message ?? first?.error ?? '';
            if (errMsg) return String(errMsg).slice(0, 200);
          }
        }
        try { return JSON.stringify(raw).slice(0, 200); } catch { return String(raw).slice(0, 200); }
      })();
      void postToSurface(ctx, `✗ session error: ${escapeMd(clipBlock(err, 300))}`);
      ctx.sentPartIds.clear();
      return;
    }

    // ── Permission requested — send Approve/Deny buttons ───────────
    if (type === 'permission.asked') {
      const sessionId = props?.sessionID ?? props?.sessionId ?? null;
      let ctx = sessionId ? sessionContexts.get(sessionId) : null;

      // If the session is not tracked locally (e.g. gateway bot handles inbound),
      // try to look up the binding from the bridge store and messenger config.
      if (!ctx && sessionId && lookupMessengerTarget) {
        try {
          const binding = lookupMessengerTarget(sessionId);
          if (binding) {
            // Build a temporary context so we can forward the permission
            ctx = {
              type: binding.type,
              token: binding.token,
              channelId: binding.targetKey,
              threadId: binding.threadId ?? null,
              projectPath: binding.projectPath ?? null,
            };
          }
        } catch {
          // lookup failed — fall through to the return below
        }
      }

      if (!ctx) {
        // No surface to post to — log and skip
        console.log('[PERMISSION]', `No surface for session=${sessionId} — cannot forward to messenger`);
        return;
      }

      // Permission requests are interactive UI — stop typing indicator
      if (stopTypingPulse) stopTypingPulse(ctx);

      const permission = {
        id: props?.id ?? props?.requestID ?? props?.requestId ?? null,
        sessionID: sessionId,
        permission: props?.permission ?? props?.type ?? 'unknown',
        patterns: Array.isArray(props?.patterns) ? props.patterns : [],
        metadata: (props?.metadata && typeof props.metadata === 'object') ? props.metadata : {},
        always: Array.isArray(props?.always) ? props.always : [],
      };

      // Resolve the directory OpenCode needs for the reply. Priority:
      //   1. the event envelope's directory (authoritative)
      //   2. directory already present on the permission metadata
      //   3. the surface's bound project path
      // Without a correct directory, POST /permission/{id}/reply silently
      // targets the wrong workspace and the request stays pending forever.
      const replyDirectory =
        envelopeDirectory || permission.metadata.directory || ctx.projectPath || null;
      if (replyDirectory) {
        permission.metadata.directory = permission.metadata.directory || replyDirectory;
        permission.metadata.sdkDirectory = permission.metadata.sdkDirectory || replyDirectory;
      }

      console.log('[PERMISSION]', `session=${sessionId} tool=${permission.permission} dir=${replyDirectory ?? 'none'} patterns=${permission.patterns.join(',')}`);

      sendApprovalToSurface({
        type: ctx.type,
        token: ctx.token,
        channelId: ctx.channelId,
        threadId: ctx.threadId,
        permission,
        directory: replyDirectory,
      }).then((result) => {
        if (result && !result.ok) {
          console.error('[PERMISSION] Failed to send approval to surface:', result.error);
        }
      }).catch((err) => {
        console.error('[PERMISSION] sendApprovalToSurface threw:', err?.message ?? err);
      });
      return;
    }
  }

  let unsubscribe = null;
  function ensureSubscribed() {
    if (unsubscribe) return;
    if (!globalEventHub) return;
    unsubscribe = globalEventHub.subscribeEvent(handleGlobalEvent);
  }

  // --- Inbound: bridge a messenger message into OpenCode -----------------
  /**
   * @param {object} args
   * @param {'discord'|'telegram'} args.type
   * @param {string} args.token
   * @param {string} args.channelId
   * @param {string|null} [args.threadId]
   * @param {string} [args.sourceMessageId] - the Discord message id we should
   *                                          start a thread off of (Discord only).
   * @param {string} args.text
   * @param {string|null} [args.projectPath]
   * @param {string|null} [args.projectLabel]
   * @param {object} [args.from]
   */
  async function routeInbound({
    type,
    token,
    channelId,
    threadId,
    sourceMessageId,
    text,
    projectPath,
    projectLabel,
    from,
  }) {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return { ok: false, error: 'empty text' };
    }
    ensureSubscribed();

    // -----------------------------------------------------------------
    // Step 0 — Slash command interceptor
    //
    // /help, /status, /abort, /new, /undo, /redo, /compact, /summary,
    // /init, /review, /model, /agent, /sessions — these are handled
    // BEFORE bootstrap dialogue and BEFORE thread creation. They never
    // reach OpenCode as a prompt; the bot replies inline.
    //
    // Unknown /commands fall through to the normal pipeline (so
    // OpenCode-registered user commands like /changelog still work via
    // the existing session.command machinery).
    // -----------------------------------------------------------------
    const parsedCmd = parseLeadingCommand(text);
    if (parsedCmd) {
      const hash = tokenHash(token);
      const stableKey = targetKey({ type, channelId, threadId: threadId ?? null });
      const stored = bridgeStore.lookup({ type, botTokenHash: hash, targetKey: stableKey });
      const projectDefaults = stored?.projectPath
        ? bridgeStore.getProjectDefaults?.(stored.projectPath) ?? null
        : null;
      const globals = await resolveGlobalDefaults();
      const surface = { type, token, channelId, threadId: threadId ?? null };
      const result = await executeMessengerCommand({
        command: parsedCmd,
        ctx: { ...surface, sourceMessageId },
        opencode: opencodeAdapter,
        binding: {
          sessionId: stored?.sessionId || null,
          projectPath: stored?.projectPath ?? null,
          projectLabel: stored?.projectLabel ?? null,
          modelOverride: stored?.modelOverride ?? null,
          agentOverride: stored?.agentOverride ?? null,
          verbosityOverride: stored?.verbosityOverride ?? null,
          verbosityDefault: bridgeStore.getVerbosityDefault?.(type) ?? null,
          projectDefaults,
          globalDefaultModel: globals.model,
          globalDefaultAgent: globals.agent,
        },
        surfaceMutators: {
          async setOverrides(changes) {
            bridgeStore.setOverrides({
              type,
              botTokenHash: hash,
              targetKey: stableKey,
              ...changes,
            });
          },
          async setVerbosityDefault(level) {
            bridgeStore.setVerbosityDefault(type, level);
          },
          async unbindSession() {
            bridgeStore.unbindSession({ type, botTokenHash: hash, targetKey: stableKey });
          },
          async setProjectDefaults(changes) {
            if (!stored?.projectPath) return;
            bridgeStore.setProjectDefaults({
              projectPath: stored.projectPath,
              projectLabel: stored.projectLabel,
              ...changes,
            });
          },
        },
      });
      if (result) {
        await postMessengerSurface(surface, result.reply);
        broadcastEvent?.('messenger.bridge.command_handled', {
          type,
          channelId,
          threadId,
          command: parsedCmd.name,
        });
        return { ok: true, handledCommand: parsedCmd.name };
      }
      // null → unknown command; fall through.
    }

    // -----------------------------------------------------------------
    // Step 1 — Bootstrap dialogue
    //
    // Done BEFORE any thread creation, so the dialogue is conducted in
    // the user's original surface (channel or thread). Only after we know
    // which project this conversation belongs to do we spawn a thread and
    // resolve a session. This avoids the bug where the reply to our
    // bootstrap prompt landed on a different surface key than the stash.
    // -----------------------------------------------------------------
    const surfaceKey = bootstrapKey({ type, channelId, threadId: threadId ?? null });
    if (bootstrapProject) {
      const pending = bootstrapPending.get(surfaceKey);
      const reply = parseBootstrapReply(text);

      if (pending && reply) {
        try {
          const result = await bootstrapProject(reply);
          if (!result.ok || !result.project) {
            await postMessengerSurface(
              { type, token, channelId, threadId: threadId ?? null },
              `⚠ Could not bootstrap project: ${escapeMd(clipBlock(result.error ?? 'unknown error', 400))}`,
            );
            return { ok: false, error: result.error ?? 'bootstrap failed' };
          }
          bootstrapPending.delete(surfaceKey);
          await postMessengerSurface(
            { type, token, channelId, threadId: threadId ?? null },
            `✓ Project ready: *${escapeMd(result.project.label ?? result.project.path)}* → ${escapeMd(result.project.path)}\nOtto will use this directory from now on. Re-sending your earlier message…`,
          );
          // Recurse with the stashed original text + the now-known project.
          // sourceMessageId remains from the ORIGINAL message so the thread
          // (when we create it below) is anchored on the user's first
          // message, matching kimaki's UX.
          return routeInbound({
            type,
            token,
            channelId,
            threadId: threadId ?? null,
            sourceMessageId: pending.sourceMessageId ?? sourceMessageId,
            text: pending.originalText,
            projectPath: result.project.path,
            projectLabel: result.project.label,
            from,
          });
        } catch (err) {
          await postMessengerSurface(
            { type, token, channelId, threadId: threadId ?? null },
            `⚠ Could not bootstrap project: ${escapeMd(clipBlock(err?.message ?? String(err), 400))}`,
          );
          return { ok: false, error: err?.message ?? 'bootstrap failed' };
        }
      }

      // No pending dialogue — decide whether to open one.
      if (!projectPath) {
        const hash = tokenHash(token);
        const keyForStore = targetKey({ type, channelId, threadId: threadId ?? null });
        const stored = bridgeStore.lookup({ type, botTokenHash: hash, targetKey: keyForStore });
        if (!stored?.sessionId) {
          const auto = await autoResolveProject({
            type,
            token,
            channelId,
            threadId: threadId ?? null,
          });
          if (!auto || auto.autoResolved !== 'slug-match') {
            bootstrapPending.set(surfaceKey, {
              type,
              token,
              channelId,
              threadId: threadId ?? null,
              sourceMessageId,
              originalText: text,
              askedAt: Date.now(),
            });
            const intro =
              type === 'discord'
                ? `**Otto — new channel detected**`
                : `🤖 *Otto — new chat detected*`;
            const guidance = [
              intro,
              ``,
              `I don't have a project bound to this ${type === 'discord' ? 'channel' : 'chat'} yet.`,
              `Reply with one of:`,
              `• \`clone <git-url>\` — git-clone the repo into Otto's projects folder`,
              `• \`path </absolute/path>\` — use an existing folder on the server`,
              `• \`new <project-name>\` — create an empty project`,
              ``,
              `Your message _"${clipBlock(text, 120)}"_ is stashed; I'll re-send it to Otto once the project is ready.`,
            ].join('\n');
            await postMessengerSurface(
              { type, token, channelId, threadId: threadId ?? null },
              guidance,
            );
            broadcastEvent?.('messenger.bridge.bootstrap_prompt', {
              type,
              channelId,
              threadId: threadId ?? null,
              originalText: text,
            });
            return { ok: true, awaitingBootstrap: true };
          }
        }
      }
    }

    // -----------------------------------------------------------------
    // Step 2 — Spawn a thread on the user's message (Discord only).
    // We only get here once we know what project this conversation
    // belongs to.
    // -----------------------------------------------------------------
    let effectiveThreadId = threadId ?? null;
    if (type === 'discord' && !effectiveThreadId && sourceMessageId) {
      const threadName = clipBlock(text.split('\n')[0] ?? 'Otto', 80);
      const thread = await startDiscordThread({
        token,
        channelId,
        messageId: sourceMessageId,
        name: threadName,
      });
      if (thread.ok && thread.threadId) {
        effectiveThreadId = thread.threadId;
      }
      // If thread creation failed (e.g. message is already in a thread, or
      // bot lacks Create Public Threads), keep going in the existing
      // surface — gracefully falling back is better than refusing.
    }

    let sessionId;
    let effectiveProjectPath = projectPath ?? null;
    try {
      const resolved = await resolveOrCreateSession({
        type,
        token,
        channelId,
        threadId: effectiveThreadId,
        projectPath,
        projectLabel,
      });
      sessionId = resolved.sessionId;
      effectiveProjectPath = resolved.projectPath ?? effectiveProjectPath;
    } catch (err) {
      return { ok: false, error: err?.message ?? 'session resolve failed' };
    }

    // Bind context so the SSE handler routes outbound parts here.
    const existingCtx = sessionContexts.get(sessionId);
    if (existingCtx) {
      // Same surface, follow-up message — keep typing pulse alive but reset
      // the dedup set so the next turn's parts post.
      existingCtx.sentPartIds.clear();
      existingCtx.startedAt = Date.now();
      existingCtx.lastError = null;
      // Keep the resolved directory current — it's needed for the session.idle
      // footer and (critically) for replying to permission requests.
      if (effectiveProjectPath) existingCtx.projectPath = effectiveProjectPath;
    } else {
      const ctx = {
        sessionId,
        type,
        token,
        channelId,
        threadId: effectiveThreadId,
        projectPath: effectiveProjectPath,
        sentPartIds: new Set(),
        startedAt: Date.now(),
        lastError: null,
        verbosity: DEFAULT_VERBOSITY,
        from,
      };
      sessionContexts.set(sessionId, ctx);
    }
    const ctx = sessionContexts.get(sessionId);
    // Re-resolve verbosity each turn so a mid-session `/verbosity` change (or a
    // UI default change) takes effect on the next prompt.
    ctx.verbosity = resolveVerbosity({ type, token, channelId, threadId: effectiveThreadId });
    startTypingPulse(ctx);

    // Pull per-surface model/agent overrides (set via /model and /agent).
    //
    // Resolution order:
    //   1. thread-keyed binding (where the bot answers)
    //   2. parent channel id  — so an override set in the channel BEFORE a
    //      thread was spawned still applies to the conversation that
    //      thread hosts
    //   3. project default    — settable from `/model default <X>` or the
    //      OpenChamber UI; applies to every Discord/Telegram surface
    //      that lands in this project
    //   4. OpenCode default   — nothing set, server picks
    let modelOverride = null;
    let agentOverride = null;
    try {
      const hash = tokenHash(token);
      const stableKey = targetKey({ type, channelId, threadId: effectiveThreadId });
      const surfaceRow = bridgeStore.lookup({ type, botTokenHash: hash, targetKey: stableKey });
      modelOverride = surfaceRow?.modelOverride ?? null;
      agentOverride = surfaceRow?.agentOverride ?? null;

      // Parent channel fallback (Discord follow-ups in a thread carry a
      // different surface key than the channel where /model was first set).
      if ((!modelOverride || !agentOverride) && stableKey !== String(channelId)) {
        const parent = bridgeStore.lookup({
          type,
          botTokenHash: hash,
          targetKey: String(channelId),
        });
        if (parent) {
          modelOverride = modelOverride ?? parent.modelOverride ?? null;
          agentOverride = agentOverride ?? parent.agentOverride ?? null;
        }
      }

      // Project default fallback — the layer the user can set once and
      // have it apply everywhere a session lands in this project.
      if ((!modelOverride || !agentOverride) && effectiveProjectPath) {
        const pd = bridgeStore.getProjectDefaults?.(effectiveProjectPath);
        if (pd) {
          modelOverride = modelOverride ?? pd.modelDefault ?? null;
          agentOverride = agentOverride ?? pd.agentDefault ?? null;
        }
      }

      // OpenChamber-wide default fallback — the same Settings → Defaults model
      // the web chat uses. Applied before letting OpenCode pick on its own, so
      // the messenger doesn't silently run on some unexpected provider default.
      if (!modelOverride || !agentOverride) {
        const globals = await resolveGlobalDefaults();
        modelOverride = modelOverride ?? globals.model ?? null;
        agentOverride = agentOverride ?? globals.agent ?? null;
      }
    } catch {
      // ignore — overrides are optional
    }

    try {
      await sendOpencodePrompt({
        sessionId,
        projectPath: effectiveProjectPath,
        text,
        modelOverride,
        agentOverride,
      });
    } catch (err) {
      const errMsg = err?.message ?? 'prompt failed';
      stopTypingPulse(ctx);
      await postToSurface(ctx, `⚠ Otto could not reach OpenCode: ${escapeMd(clipBlock(errMsg, 300))}`);
      return { ok: false, sessionId, threadId: effectiveThreadId, error: errMsg };
    }

    broadcastEvent?.('messenger.bridge.inbound', {
      type,
      channelId,
      threadId: effectiveThreadId,
      sessionId,
      text,
    });

    return { ok: true, sessionId, threadId: effectiveThreadId };
  }

  function statusSnapshot({ type, token } = {}) {
    const hash = token ? tokenHash(token) : undefined;
    const bindings = bridgeStore.list({ type, botTokenHash: hash });
    const active = [...sessionContexts.values()].map((ctx) => ({
      type: ctx.type,
      channelId: ctx.channelId,
      threadId: ctx.threadId,
      sessionId: ctx.sessionId,
      startedAt: ctx.startedAt,
      lastError: ctx.lastError,
    }));
    return { bindings, active };
  }

  function isEnabled() {
    return true;
  }

  /**
   * Fetch available providers from OpenCode.
   * Returns { all: [...], connected: [...], default: string } or null.
   */
  async function fetchProviders() {
    const r = await opencodeFetch('/provider');
    if (!r.ok) return null;
    try {
      const d = await r.json();
      // OpenCode may return { all: [...], connected: [...], default } or { data: [...] }
      if (d && typeof d === 'object') {
        if (Array.isArray(d.all)) return { all: d.all, connected: d.connected ?? [], default: d.default ?? null };
        if (Array.isArray(d.data)) return { all: d.data, connected: d.data.map(p => p.id), default: d.default ?? null };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Execute a command directly and return the reply text, without posting to a surface.
   * Used by the gateway listener to respond to native slash commands.
   * Returns `{ reply: string }` on success, `null` if the command is not recognised.
   */
  async function runCommand({ type, token, channelId, threadId, commandName, args = '', from }) {
    const text = `/${commandName}${args ? ' ' + args : ''}`;
    const parsedCmd = parseLeadingCommand(text);
    if (!parsedCmd) return null;

    const hash = tokenHash(token);
    const stableKey = targetKey({ type, channelId, threadId: threadId ?? null });
    const stored = bridgeStore.lookup({ type, botTokenHash: hash, targetKey: stableKey });
    const projectDefaults = stored?.projectPath
      ? bridgeStore.getProjectDefaults?.(stored.projectPath) ?? null
      : null;
    const globals = await resolveGlobalDefaults();
    const surface = { type, token, channelId, threadId: threadId ?? null };

    const result = await executeMessengerCommand({
      command: parsedCmd,
      ctx: surface,
      opencode: opencodeAdapter,
      binding: {
        sessionId: stored?.sessionId || null,
        projectPath: stored?.projectPath ?? null,
        projectLabel: stored?.projectLabel ?? null,
        modelOverride: stored?.modelOverride ?? null,
        agentOverride: stored?.agentOverride ?? null,
        verbosityOverride: stored?.verbosityOverride ?? null,
        verbosityDefault: bridgeStore.getVerbosityDefault?.(type) ?? null,
        projectDefaults,
        globalDefaultModel: globals.model,
        globalDefaultAgent: globals.agent,
      },
      surfaceMutators: {
        async setOverrides(changes) {
          bridgeStore.setOverrides({ type, botTokenHash: hash, targetKey: stableKey, ...changes });
        },
        async setVerbosityDefault(level) {
          bridgeStore.setVerbosityDefault(type, level);
        },
        async unbindSession() {
          bridgeStore.unbindSession({ type, botTokenHash: hash, targetKey: stableKey });
        },
        async setProjectDefaults(changes) {
          if (!stored?.projectPath) return;
          bridgeStore.setProjectDefaults({ projectPath: stored.projectPath, projectLabel: stored.projectLabel, ...changes });
        },
      },
    });

    return result ?? null;
  }

  /**
   * Wire up the bridge to listen for approval button clicks from the
   * Discord/Telegram listeners and respond to OpenCode.
   *
   * @param {Function} respondToOpenCode - async ({ sessionID, requestID, reply, directory }) => void
   */
  /**
   * Direct handler for approval decisions from Discord/Telegram button clicks.
   * Bypasses the global event hub to avoid routing issues.
   * Called by the Discord/Telegram listeners directly or via initApprovalListener.
   *
   * @param {string} approvalId
   * @param {'approve'|'approve-always'|'deny'} decision
   */
  function handleApprovalDecision(approvalId, decision) {
    if (!approvalId || !decision) return;
    const ctx = approvalContexts.get(approvalId);
    if (!ctx) {
      console.log('[BRIDGE] No approval context for', approvalId, '(expired or unknown) — likely already processed');
      return;
    }
    // Delete immediately so duplicate calls (direct + event hub fallback)
    // are idempotent. The 10-minute expiry timeout is harmless — deleting
    // a non-existent key is a no-op.
    approvalContexts.delete(approvalId);

    const reply = decision === 'approve' ? 'once' : decision === 'approve-always' ? 'always' : 'reject';
    console.log('[BRIDGE] Approval decision:', { approvalId, decision, reply, sessionID: ctx.sessionID, requestID: ctx.requestID });
    // Call respondToOpenCode if available
    if (typeof _respondToOpenCode === 'function') {
      _respondToOpenCode({
        sessionID: ctx.sessionID,
        requestID: ctx.requestID,
        reply,
        directory: ctx.directory || ctx.sdkDirectory,
      }).catch((err) => {
        console.error('[BRIDGE] Failed to respond to permission:', err?.message ?? err);
      });
    }
  }

  // Store the respondToOpenCode callback for handleApprovalDecision
  let _respondToOpenCode = null;

  function initApprovalListener(respondToOpenCode) {
    if (typeof respondToOpenCode !== 'function') return;
    _respondToOpenCode = respondToOpenCode;
    console.log('[BRIDGE] Approval listener initialized');

    // Also subscribe to global event hub as a fallback
    if (!globalEventHub) return;
    const handler = (event) => {
      const payload = event?.payload ?? event;
      if (!payload || typeof payload !== 'object') return;
      const type = payload.type ?? payload.event ?? null;
      if (type !== 'messenger.discord.approval' && type !== 'messenger.telegram.approval') return;
      handleApprovalDecision(payload.approvalId, payload.decision);
    };
    const unsub = globalEventHub.subscribeEvent?.(handler);
    if (unsub) approvalContexts._cleanup = unsub;
  }

  return {
    routeInbound,
    runCommand,
    fetchProviders,
    statusSnapshot,
    isEnabled,
    ensureSubscribed,
    initApprovalListener,
    handleApprovalDecision,
    /** Test seam — exposed so tests can drive events without an SSE stream. */
    _handleGlobalEvent: handleGlobalEvent,
    store: bridgeStore,
    /** Shared approval context map — exposed so listeners can inspect it */
    approvalContexts,
  };
}
