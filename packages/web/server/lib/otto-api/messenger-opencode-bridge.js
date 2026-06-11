import crypto from 'node:crypto';
import { MessengerBridgeStore } from './messenger-bridge-store.js';
import { executeMessengerCommand, parseLeadingCommand } from './messenger-commands.js';
import { DEFAULT_VERBOSITY, normalizeVerbosity } from './messenger-verbosity.js';
import { renderPartForMessenger, renderPermissionContext, escapeMd, clipBlock } from './messenger-render.js';

/**
 * Bidirectional bridge between Discord and OpenCode chat sessions.
 *
 * Threading model (modelled after https://github.com/remorses/kimaki):
 *   - Each new conversation starter in a Discord text channel spawns a public
 *     Thread on that message via POST /channels/:id/messages/:id/threads. The
 *     OpenCode session is bound to the THREAD, not the channel. Follow-up
 *     messages posted inside the thread reuse the same session.
 *
 * Outbound model:
 *   - One new Discord message per renderable OpenCode part.
 *     No edit-in-place — text streams complete (part.time.end set) before
 *     they're posted, tool runs post a single one-liner per state change,
 *     reasoning posts a `┣ thinking` marker.
 *   - Tool summaries follow kimaki's compact format: file name and ±line
 *     count for edits, file name for reads, escaped command for bash,
 *     match count for glob/grep, etc. Not `[⋯ tool-name]`.
 *   - Typing indicator pulses every 7s while a session has unfinished
 *     assistant work — to give the user a visible "thinking…" affordance
 *     without spamming the chat.
 */

const DISCORD_LIMIT = 2000;
const NAME_TTL_MS = 5 * 60_000;
const TYPING_PULSE_DISCORD_MS = 7_000;

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
 */
function targetKey({ type, channelId, threadId }) {
  if (type === 'discord') {
    return threadId ? `${threadId}` : `${channelId}`;
  }
  return threadId ? `${channelId}:${threadId}` : `${channelId}`;
}

function maxLenFor(_type) {
  return DISCORD_LIMIT;
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
// Discord REST adapters
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

  return { ok: false, error: `Unsupported messenger type: ${type}` };
}

/**
 * Add a Discord user to a thread so it shows up under the channel for them
 * immediately (Discord only lists threads in the channel sidebar for members).
 * Best-effort: a failure here never breaks thread creation — the user can still
 * open the thread manually. `userIds` may be a single id or an array of ids.
 */
async function addThreadMembers({ token, threadId, userIds }) {
  if (!threadId || !userIds) return;
  const ids = (Array.isArray(userIds) ? userIds : [userIds])
    .map((id) => (id == null ? '' : String(id).trim()))
    .filter(Boolean);
  for (const userId of ids) {
    try {
      const r = await fetch(
        `https://discord.com/api/v10/channels/${encodeURIComponent(threadId)}/thread-members/${encodeURIComponent(userId)}`,
        { method: 'PUT', headers: { Authorization: `Bot ${token}` } },
      );
      if (!r.ok) {
        console.warn(
          `[BRIDGE] Failed to add user ${userId} to thread ${threadId}: Discord ${r.status} — ${(await r.text()).slice(0, 200)}`,
        );
      }
    } catch (err) {
      console.warn(`[BRIDGE] Failed to add user ${userId} to thread ${threadId}: ${err?.message ?? err}`);
    }
  }
}

/**
 * Create a public Discord thread starting from a user's message. Returns
 * the new thread id, or null when the API call failed (we fall back to
 * the channel in that case so the user still gets a reply).
 *
 * When `userId` is provided, the user is added to the thread immediately
 * so the thread shows up under the channel for them (Discord only shows
 * threads in the channel list for members).
 */
async function startDiscordThread({ token, channelId, messageId, name, userId }) {
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
  const threadId = data.id ?? null;
  if (threadId && userId) await addThreadMembers({ token, threadId, userIds: userId });
  return { ok: true, threadId: threadId ?? null, threadName: data.name ?? safeName };
}

/**
 * Create a Discord thread that is NOT anchored to an existing message
 * (the "Start Thread without Message" endpoint). Used to give each web-UI
 * conversation its own thread inside the project channel, so the channel feed
 * stays clean. type 11 = GUILD_PUBLIC_THREAD. Returns the new thread id or an
 * error (callers fall back to posting in the channel itself).
 */
async function startStandaloneDiscordThread({ token, channelId, name, userIds }) {
  const safeName = (name || 'Otto').replace(/\s+/g, ' ').slice(0, 90) || 'Otto';
  const r = await fetch(
    `https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/threads`,
    {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: safeName, type: 11, auto_archive_duration: 1440 }),
    },
  );
  if (!r.ok) return { ok: false, error: `Discord ${r.status}: ${(await r.text()).slice(0, 200)}` };
  const data = await r.json();
  const threadId = data.id ?? null;
  // A web-UI conversation has no Discord author to anchor on, so the thread
  // would otherwise stay invisible in the channel sidebar for the human owner.
  // Add the configured owner id(s) so the thread shows up for them immediately.
  if (threadId && userIds) await addThreadMembers({ token, threadId, userIds });
  return { ok: true, threadId, threadName: data.name ?? safeName };
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
  /**
   * Optional default messenger target for web-originated OpenCode sessions.
   * Discord-originated sessions already have a bound context; this
   * lets unbound web UI sessions mirror into the configured messenger space.
   * Signature: ({ sessionId, projectPath }) => { type, token, channelId, threadId?, projectPath? } | null
   */
  getDefaultMessengerTarget = null,
  /**
   * Optional accessor for the locally-discovered skills available to the agent
   * in a given project. Powers the Discord `/skill` picker. Signature:
   *   ({ projectPath }) => Array<{ name, description?, scope?, source? }> (sync or async)
   */
  listSkills = null,
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
   *   type: 'discord',
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

  // messageID → role ('user' | 'assistant'). OpenCode's `message.part.updated`
  // events do NOT carry the message role — it lives on the separate
  // `message.updated` event (`properties.info.role`). We cache it here so the
  // part handler can tell a user's own prompt apart from assistant output and
  // mirror the former into the messenger as a **Web** block. Bounded so it can
  // never grow without limit on a long-lived server.
  /** @type {Map<string, 'user'|'assistant'>} */
  const messageRoles = new Map();
  const MESSAGE_ROLE_CACHE_MAX = 2000;
  function rememberMessageRole(messageId, role) {
    if (!messageId || (role !== 'user' && role !== 'assistant')) return;
    if (messageRoles.has(messageId)) {
      messageRoles.set(messageId, role);
      return;
    }
    if (messageRoles.size >= MESSAGE_ROLE_CACHE_MAX) {
      // Drop the oldest entry (insertion order) to keep the cache bounded.
      const oldest = messageRoles.keys().next().value;
      if (oldest !== undefined) messageRoles.delete(oldest);
    }
    messageRoles.set(messageId, role);
  }
  function getMessageId(value) {
    return value?.id ?? value?.messageID ?? value?.messageId ?? value?.message?.id ?? value?.message?.messageID ?? value?.message?.messageId ?? null;
  }

  function getPartMessageId(part) {
    return part?.messageID ?? part?.messageId ?? part?.message?.id ?? part?.message?.messageID ?? part?.message?.messageId ?? null;
  }

  function getPartSessionId(part, props) {
    return (
      part?.sessionID ??
      part?.sessionId ??
      part?.session?.id ??
      part?.message?.sessionID ??
      part?.message?.sessionId ??
      props?.sessionID ??
      props?.sessionId ??
      props?.session?.id ??
      props?.message?.sessionID ??
      props?.message?.sessionId ??
      null
    );
  }

  /**
   * Resolve a part's message role. OpenCode has used multiple payload shapes:
   * role may live on the part, on a nested message, or only on message.updated.
   */
  function resolvePartRole(part, props = null) {
    const role = part?.role ?? part?.message?.role ?? props?.role ?? props?.message?.role ?? null;
    if (role === 'user' || role === 'assistant') return role;
    const messageId = getPartMessageId(part);
    if (messageId && messageRoles.has(messageId)) return messageRoles.get(messageId);
    return null;
  }

  // Part events may arrive before the matching message.updated event that
  // declares the message role. Keep the latest part briefly, keyed by messageID,
  // then replay it once the role arrives.
  /** @type {Map<string, { part: object, projectPath: string|null }>} */
  const pendingPartsByMessageId = new Map();
  const PENDING_PART_CACHE_MAX = 2000;
  function rememberPendingPart(part, projectPath) {
    const messageId = getPartMessageId(part);
    if (!messageId) return;
    if (!pendingPartsByMessageId.has(messageId) && pendingPartsByMessageId.size >= PENDING_PART_CACHE_MAX) {
      const oldest = pendingPartsByMessageId.keys().next().value;
      if (oldest !== undefined) pendingPartsByMessageId.delete(oldest);
    }
    pendingPartsByMessageId.set(messageId, { part, projectPath });
  }

  // Guards against creating two threads / contexts for the same session when
  // the user and assistant parts arrive nearly simultaneously.
  /** @type {Map<string, Promise<object|null>>} */
  const pendingContextCreations = new Map();

  // Prompts that arrived FROM a messenger (Discord inbound). OpenCode
  // echoes every prompt back as a `user` part; when the session also mirrors web
  // activity into the messenger (a thread that was created from the web UI but is
  // later answered from Discord), that echo would re-post the user's own message
  // right back at them. We remember each inbound prompt per session and consume
  // the matching `user` part so it is never mirrored back to its own author.
  /** @type {Map<string, string[]>} */
  const messengerInboundPrompts = new Map();
  const MESSENGER_INBOUND_CACHE_MAX = 200;
  function rememberMessengerInbound(sessionId, text) {
    if (!sessionId || typeof text !== 'string') return;
    const trimmed = text.trim();
    if (!trimmed) return;
    const queue = messengerInboundPrompts.get(sessionId) ?? [];
    queue.push(trimmed);
    // Bound per-session queue so a chatty session can't grow it without limit.
    if (queue.length > 16) queue.splice(0, queue.length - 16);
    messengerInboundPrompts.set(sessionId, queue);
    if (messengerInboundPrompts.size > MESSENGER_INBOUND_CACHE_MAX) {
      const oldest = messengerInboundPrompts.keys().next().value;
      if (oldest !== undefined && oldest !== sessionId) messengerInboundPrompts.delete(oldest);
    }
  }
  /** Consume a remembered inbound prompt; returns true when the text matched. */
  function consumeMessengerInbound(sessionId, text) {
    if (!sessionId || typeof text !== 'string') return false;
    const queue = messengerInboundPrompts.get(sessionId);
    if (!queue || queue.length === 0) return false;
    const trimmed = text.trim();
    const idx = queue.indexOf(trimmed);
    if (idx === -1) return false;
    queue.splice(idx, 1);
    if (queue.length === 0) messengerInboundPrompts.delete(sessionId);
    return true;
  }

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
    async abortSession(sessionId, directory) {
      try {
        // Some OpenCode API versions require directory as query param
        const query = directory && typeof directory === 'string' && directory.length > 0
          ? `?directory=${encodeURIComponent(directory)}`
          : '';
        const r = await opencodeFetch(`/session/${encodeURIComponent(sessionId)}/abort${query}`, {
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
    async listSkills(projectPath) {
      if (typeof listSkills !== 'function') return [];
      try {
        const skills = await listSkills({ projectPath: projectPath ?? null });
        return Array.isArray(skills) ? skills : [];
      } catch {
        return [];
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
    return { ok: false, error: `Unsupported messenger type: ${type}` };
  }

  function startTypingPulse(ctx) {
    if (ctx.typingTimer) return;
    const pulse = async () => {
      if (!sessionContexts.has(ctx.sessionId)) return;
      if (ctx.type === 'discord') {
        await discordTyping({ token: ctx.token, channelId: ctx.threadId ?? ctx.channelId });
      }
      ctx.typingTimer = setTimeout(pulse, TYPING_PULSE_DISCORD_MS);
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

  async function ensureDefaultSessionContext(sessionId, { projectPath = null, threadName = null } = {}) {
    if (!sessionId) return null;
    const existing = sessionContexts.get(sessionId);
    if (existing) return existing;
    if (typeof getDefaultMessengerTarget !== 'function') return null;

    // Coalesce concurrent creations for the same session so the user part and
    // the first assistant part don't each spawn their own Discord thread.
    const inflight = pendingContextCreations.get(sessionId);
    if (inflight) return inflight;

    const creation = (async () => {
      let target = null;
      try {
        target = await getDefaultMessengerTarget({ sessionId, projectPath });
      } catch {
        return null;
      }
      if (!target?.type || !target?.token || !target?.channelId) return null;

      const type = target.type;
      const token = target.token;
      const channelId = String(target.channelId);
      const effectiveProjectPath = target.projectPath ?? projectPath ?? null;
      let threadId = target.threadId ? String(target.threadId) : null;

      // For Discord, give each web conversation its own thread inside the
      // project channel. Reuse a thread already bound to this session (so a
      // continued conversation keeps the same thread), otherwise create one.
      if (type === 'discord' && !threadId) {
        const hash = tokenHash(token);
        try {
          const bound = bridgeStore
            .lookupBySessionId(sessionId)
            .find((b) => b.type === 'discord' && b.targetKey);
          if (bound?.targetKey) threadId = String(bound.targetKey);
        } catch {
          // best-effort — fall through to creating a fresh thread
        }
        if (!threadId) {
          const name = threadName || target.threadName || `Otto · ${target.projectLabel ?? 'web'}`;
          const created = await startStandaloneDiscordThread({
            token,
            channelId,
            name,
            // Add the configured Discord owner(s) so the thread is visible to
            // them under the channel right away (issue: UI-created threads were
            // invisible because the bot was the only member).
            userIds: target.userIds ?? target.userId ?? null,
          });
          if (created.ok && created.threadId) {
            threadId = created.threadId;
            try {
              bridgeStore.bind({
                type: 'discord',
                botTokenHash: hash,
                targetKey: threadId,
                sessionId,
                projectPath: effectiveProjectPath,
                projectLabel: target.projectLabel ?? null,
              });
            } catch {
              // binding is an optimization (continue-existing across restarts)
            }
          }
          // If thread creation failed, threadId stays null and we post into
          // the channel directly — degraded but functional.
        }
      }

      const ctx = {
        sessionId,
        type,
        token,
        channelId,
        threadId: threadId ? String(threadId) : null,
        projectPath: effectiveProjectPath,
        sentPartIds: new Set(),
        startedAt: Date.now(),
        lastError: null,
        verbosity: DEFAULT_VERBOSITY,
        from: null,
        webMirror: true,
        source: 'web',
      };
      ctx.verbosity = resolveVerbosity({
        type: ctx.type,
        token: ctx.token,
        channelId: ctx.channelId,
        threadId: ctx.threadId,
      });
      sessionContexts.set(sessionId, ctx);
      broadcastEvent?.('messenger.bridge.web_session_bound', {
        type: ctx.type,
        channelId: ctx.channelId,
        threadId: ctx.threadId,
        sessionId,
        projectPath: ctx.projectPath,
      });
      return ctx;
    })();

    pendingContextCreations.set(sessionId, creation);
    try {
      return await creation;
    } finally {
      pendingContextCreations.delete(sessionId);
    }
  }

  async function emitWebUserPart(sessionId, part, { projectPath = null } = {}) {
    const text = typeof part?.text === 'string' ? part.text.trim() : '';
    // Never mirror a prompt that originated from a messenger surface back to the
    // same surface. This stops the "I reply from Discord and my own message
    // bounces straight back to me" duplication on web-created threads that are
    // later continued from Discord.
    if (consumeMessengerInbound(sessionId, text)) return;
    // Name the thread (when one is created) after the user's first line so the
    // Discord thread list is meaningful instead of a wall of "Otto · web".
    const threadName = text ? clipBlock(text.split('\n')[0], 80) : null;
    const ctx = await ensureDefaultSessionContext(sessionId, { projectPath, threadName });
    if (!ctx?.webMirror) return;
    if (!text) return;
    const dedupKey = part?.id ? `${part.id}:user` : null;
    if (dedupKey && ctx.sentPartIds.has(dedupKey)) return;
    const safe = clipBlock(text.replace(/```/g, "'''"), 1500);
    const sent = await postToSurface(ctx, `**Web**\n\`\`\`\n${safe}\n\`\`\``);
    if (!sent.ok) {
      ctx.lastError = sent.error;
      return;
    }
    if (dedupKey) ctx.sentPartIds.add(dedupKey);
  }

  async function emitPart(sessionId, part) {
    const ctx = sessionContexts.get(sessionId);
    if (!ctx) return;
    const partId = part?.id;
    const partType = part?.type;
    const verbosity = normalizeVerbosity(ctx.verbosity);

    // Skip duplicates we've already posted (parts get many updates as they
    // stream — we only want one Discord message per logical part).
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
      // Wait until the reasoning text is non-empty before posting.
      // The first update often arrives with empty text while the model
      // is still generating — posting then creates an empty code block.
      if (!part?.text || !String(part.text).trim()) return;
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

  async function handleGlobalEvent(normalized) {
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
      const sessionId = getPartSessionId(part, props);
      if (!sessionId) return;
      const role = resolvePartRole(part, props);
      const partMessageId = getPartMessageId(part);
      if (!role) {
        if (partMessageId) rememberPendingPart(part, envelopeDirectory);
        return;
      }
      if (role === 'user') {
        // Mirror the user's own prompt into the messenger as a **Web** block.
        // Only for web-originated sessions: a session already bound to a
        // Discord surface had its prompt typed there already, so
        // echoing it back would duplicate it.
        const ctx = sessionContexts.get(sessionId);
        if (!ctx) {
          // Check the bridge store: if this session has a Discord
          // binding, the user's prompt came from a messenger, not the web.
          // This handles edge cases where the in-memory context was lost
          // (e.g. server restart while a session was actively streaming).
          const messengerBindings = bridgeStore
            .lookupBySessionId(sessionId)
            .filter((b) => b.type === 'discord');
          if (messengerBindings.length === 0) {
            await emitWebUserPart(sessionId, part, { projectPath: envelopeDirectory });
          }
        } else if (ctx.source === 'web' || ctx.webMirror) {
          await emitWebUserPart(sessionId, part, { projectPath: envelopeDirectory });
        }
        return;
      }
      if (!sessionContexts.has(sessionId)) {
        const ctx = await ensureDefaultSessionContext(sessionId, { projectPath: envelopeDirectory });
        if (ctx) await emitPart(sessionId, part);
        return;
      }
      await emitPart(sessionId, part);
      return;
    }
    if (type === 'message.updated') {
      // Cache the message role so the part handler (whose events don't carry a
      // role) can tell user prompts apart from assistant output. If the part
      // arrived first, replay it now that the role is known.
      const info = props?.info ?? props?.message ?? null;
      const messageId = getMessageId(info);
      const role = info?.role ?? info?.message?.role ?? props?.role ?? props?.message?.role ?? null;
      if (messageId && role) {
        rememberMessageRole(messageId, role);
        const pending = pendingPartsByMessageId.get(messageId);
        if (pending) {
          pendingPartsByMessageId.delete(messageId);
          await handleGlobalEvent({
            ...normalized,
            directory: pending.projectPath ?? envelopeDirectory ?? normalized?.directory,
            payload: {
              type: 'message.part.updated',
              properties: { part: pending.part },
            },
          });
        }
      }
      return;
    }
    if (type === 'session.idle') {
      const sessionId = props?.sessionID ?? props?.sessionId ?? null;
      const ctx = sessionId ? sessionContexts.get(sessionId) : null;
      if (!ctx) {
        const defaultCtx = await ensureDefaultSessionContext(sessionId, { projectPath: envelopeDirectory });
        if (defaultCtx) await handleGlobalEvent(normalized);
        return;
      }
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
      if (!ctx) {
        const defaultCtx = await ensureDefaultSessionContext(sessionId, { projectPath: envelopeDirectory });
        if (defaultCtx) await handleGlobalEvent(normalized);
        return;
      }
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
        ctx = await ensureDefaultSessionContext(sessionId, { projectPath: envelopeDirectory });
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

  /**
   * Run a parsed slash command against a messenger surface and return the
   * command handler's result (`{ reply }` or `null` for "not a command").
   *
   * This is the single source of truth for wiring the bridge store (bindings,
   * project defaults, global defaults) and the OpenCode adapter into
   * {@link executeMessengerCommand}. Both the inbound text pipeline
   * (`routeInbound` step 0) and the native slash-command pipeline
   * (`runCommand`) delegate here so the two can never drift apart.
   */
  async function executeSurfaceCommand({
    command,
    type,
    token,
    channelId,
    threadId = null,
    sourceMessageId = null,
  }) {
    const hash = tokenHash(token);
    const stableKey = targetKey({ type, channelId, threadId: threadId ?? null });
    const stored = bridgeStore.lookup({ type, botTokenHash: hash, targetKey: stableKey });
    const projectDefaults = stored?.projectPath
      ? bridgeStore.getProjectDefaults?.(stored.projectPath) ?? null
      : null;
    const globals = await resolveGlobalDefaults();
    const surface = { type, token, channelId, threadId: threadId ?? null };

    return executeMessengerCommand({
      command,
      ctx: sourceMessageId ? { ...surface, sourceMessageId } : surface,
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
          bridgeStore.setProjectDefaults({
            projectPath: stored.projectPath,
            projectLabel: stored.projectLabel,
            ...changes,
          });
        },
      },
    });
  }

  // --- Inbound: bridge a messenger message into OpenCode -----------------
  /**
   * @param {object} args
   * @param {'discord'} args.type
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
      const surface = { type, token, channelId, threadId: threadId ?? null };
      const result = await executeSurfaceCommand({
        command: parsedCmd,
        type,
        token,
        channelId,
        threadId: threadId ?? null,
        sourceMessageId,
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
        userId: from?.id,
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

    // Remember this prompt so OpenCode's `user` part echo isn't mirrored back
    // into the originating messenger surface (see consumeMessengerInbound).
    rememberMessengerInbound(sessionId, text);

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
        // Mark origin surface so we never echo user parts back to the
        // same messenger they came from (prevents duplication).
        source: type,
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
    //      OpenChamber UI; applies to every Discord surface
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
  /**
   * List the skills available to the agent for a messenger surface. Resolves
   * the surface's bound project path (so project-scoped skills show up) and
   * delegates to the injected `listSkills` accessor. Returns `[]` when no
   * accessor is wired or discovery fails.
   */
  async function listSurfaceSkills({ type, token, channelId, threadId = null }) {
    if (typeof listSkills !== 'function') return [];
    let projectPath = null;
    try {
      const hash = tokenHash(token);
      const stableKey = targetKey({ type, channelId, threadId: threadId ?? null });
      const stored = bridgeStore.lookup({ type, botTokenHash: hash, targetKey: stableKey });
      projectPath = stored?.projectPath ?? null;
      if (!projectPath && stableKey !== String(channelId)) {
        const parent = bridgeStore.lookup({ type, botTokenHash: hash, targetKey: String(channelId) });
        projectPath = parent?.projectPath ?? null;
      }
    } catch {
      // best-effort — fall back to project-less (user-level) skill discovery
    }
    try {
      const skills = await listSkills({ projectPath });
      return Array.isArray(skills) ? skills : [];
    } catch {
      return [];
    }
  }

  async function runCommand({ type, token, channelId, threadId, commandName, args = '' }) {
    const text = `/${commandName}${args ? ' ' + args : ''}`;
    const parsedCmd = parseLeadingCommand(text);
    if (!parsedCmd) return null;
    const result = await executeSurfaceCommand({
      command: parsedCmd,
      type,
      token,
      channelId,
      threadId: threadId ?? null,
    });
    return result ?? null;
  }

  /**
   * Wire up the bridge to listen for approval button clicks from the
   * Discord listener and respond to OpenCode.
   *
   * @param {Function} respondToOpenCode - async ({ sessionID, requestID, reply, directory }) => void
   */
  /**
   * Direct handler for approval decisions from Discord button clicks.
   * Bypasses the global event hub to avoid routing issues.
   * Called by the Discord listener directly or via initApprovalListener.
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
      if (type !== 'messenger.discord.approval') return;
      handleApprovalDecision(payload.approvalId, payload.decision);
    };
    const unsub = globalEventHub.subscribeEvent?.(handler);
    if (unsub) approvalContexts._cleanup = unsub;
  }

  /**
   * Clean up bridge state when a Discord thread is deleted (or archived).
   * Removes the in-memory session context, deletes the store binding, and
   * optionally aborts the OpenCode session so it doesn't stay alive on the
   * server. Called from the Discord listener on THREAD_DELETE / THREAD_UPDATE
   * (archived) gateway events.
   */
  function handleThreadDeleted({ type, threadId, token }) {
    const bindings = bridgeStore.findByTargetKey({ type, targetKey: threadId });

    for (const b of bindings) {
      // Clean up in-memory session context (stop typing pulse, remove)
      const ctx = b.sessionId ? sessionContexts.get(b.sessionId) : null;
      if (ctx) {
        stopTypingPulse(ctx);
        sessionContexts.delete(b.sessionId);
        broadcastEvent?.('messenger.bridge.thread_cleaned', {
          type,
          threadId,
          sessionId: b.sessionId,
        });
      }

      // Remove the store binding using the original binding's hash.
      // This is correct even when multiple bot tokens share the same
      // targetKey — each binding is removed independently.
      bridgeStore.unbind({ type, botTokenHash: b.botTokenHash, targetKey: threadId });
    }
  }

  return {
    routeInbound,
    runCommand,
    listSurfaceSkills,
    /** List configured OpenCode agents (for the Discord `/agent` picker). */
    listAgents: () => opencodeAdapter.listAgents(),
    fetchProviders,
    statusSnapshot,
    isEnabled,
    ensureSubscribed,
    initApprovalListener,
    handleApprovalDecision,
    handleThreadDeleted,
    /** Test seam — exposed so tests can drive events without an SSE stream. */
    _handleGlobalEvent: handleGlobalEvent,
    store: bridgeStore,
    /** Shared approval context map — exposed so listeners can inspect it */
    approvalContexts,
  };
}
