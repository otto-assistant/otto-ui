import crypto from 'node:crypto';
import { MessengerBridgeStore } from './messenger-bridge-store.js';

/**
 * Bidirectional bridge between Discord/Telegram and OpenCode chat sessions.
 *
 * What this turns the messenger settings card into:
 *   - User posts in a Discord channel  →  it reaches OpenCode like a chat
 *     message from the web UI does. OpenCode's streaming response is mirrored
 *     back into the same channel via Discord message edits.
 *   - Same flow for Telegram chats / topics.
 *   - The session is shared with the web UI, so the same conversation history
 *     is visible in both surfaces.
 *
 * Implementation outline:
 *   - For each inbound message, resolve the target's bound session id (or
 *     create a new session in the project's working directory the first time
 *     a channel is used).
 *   - Post a placeholder "Otto is thinking..." message in the messenger and
 *     remember its id.
 *   - POST /session/:id/prompt_async to OpenCode.
 *   - Subscribe once to the global OpenCode SSE stream. For each assistant
 *     part update against a session we have an in-flight messenger message
 *     for, throttle-edit the messenger message to extend the text. On
 *     session.idle, finalize.
 */

const STARTER_TEXT = '⏳ Otto is thinking…';
const EDIT_THROTTLE_MS = 1500;
const DISCORD_LIMIT = 2000;
const TELEGRAM_LIMIT = 4096;
// Reserve some chars so the throttled "tail" indicator fits.
const TAIL = ' …'; // indicates "more incoming"

function tokenHash(token) {
  if (!token) return '';
  return crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 12);
}

function targetKey({ channelId, threadId }) {
  return threadId ? `${channelId}:${threadId}` : `${channelId}`;
}

function maxLenFor(type) {
  return type === 'discord' ? DISCORD_LIMIT : TELEGRAM_LIMIT;
}

function clampForMessenger(text, type, withTail = false) {
  const limit = maxLenFor(type) - (withTail ? TAIL.length : 0);
  if (text.length <= limit) return text + (withTail ? TAIL : '');
  return text.slice(0, limit) + (withTail ? TAIL : '…');
}

/**
 * Pull readable text out of an OpenCode message part. The SDK's part shapes:
 *   - { type: 'text', text }
 *   - { type: 'tool', tool, state: { status, input, output, ... } }
 *   - { type: 'reasoning', text }    (skipped — too noisy for chat surfaces)
 */
function renderPart(part) {
  if (!part || typeof part !== 'object') return '';
  if (part.type === 'text') {
    return typeof part.text === 'string' ? part.text : '';
  }
  if (part.type === 'tool') {
    const status = part.state?.status ?? 'running';
    const toolName = part.tool ?? 'tool';
    const symbol = status === 'completed' ? '✓' : status === 'error' ? '✗' : '⋯';
    return `\n[${symbol} ${toolName}${status === 'error' ? ` — ${(part.state?.error ?? '').slice(0, 200)}` : ''}]\n`;
  }
  return '';
}

function slugify(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Best-effort channel→project resolution for cases where the listener
 * didn't pre-resolve. We slug-match the messenger surface's name against
 * each project's label and path-leaf.
 */
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
  // Looser: prefix or substring match (handles "my-project-discord-channel").
  for (const p of projects) {
    const candidates = [
      slugify(p.label ?? ''),
      slugify((p.path ?? '').split('/').pop() ?? ''),
    ].filter(Boolean);
    if (candidates.some((c) => wanted.includes(c) || c.includes(wanted))) return p;
  }
  return null;
}

export function createMessengerOpencodeBridge({
  globalEventHub,
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  broadcastEvent,
  store,
  listProjects,
}) {
  const bridgeStore = store ?? new MessengerBridgeStore();

  // sessionId → { type, token, channelId, threadId, messageId, content, lastFlushAt, scheduled, finalized }
  const inflight = new Map();
  // Cache resolved names (channel/topic) → ttl so we don't hit the messenger
  // API for every inbound message in a long conversation.
  const nameCache = new Map(); // key: "discord:channelId" | "telegram:chatId" → { name, expiresAt }
  const NAME_TTL_MS = 5 * 60_000;

  // sessionId → buffer of part renderings keyed by partId so a single tool's
  // status transitions update in place rather than appending duplicates.
  const partBuffersBySession = new Map();

  // Telegram + Discord REST adapters ---------------------------------------
  async function postMessengerMessage({ type, token, channelId, threadId, text }) {
    if (type === 'telegram') {
      const body = { chat_id: channelId, text: clampForMessenger(text, 'telegram') };
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
    if (type === 'discord') {
      // Discord: a "thread" is itself a channel — its id IS the parent channel
      // id for send purposes. So if threadId is set, send there instead.
      const channel = threadId ?? channelId;
      const r = await fetch(
        `https://discord.com/api/v10/channels/${encodeURIComponent(channel)}/messages`,
        {
          method: 'POST',
          headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: clampForMessenger(text, 'discord') }),
        },
      );
      if (!r.ok) {
        const errText = await r.text();
        return { ok: false, error: `Discord ${r.status}: ${errText.slice(0, 200)}` };
      }
      const d = await r.json();
      return { ok: true, id: d.id };
    }
    return { ok: false, error: `Unknown messenger type ${type}` };
  }

  async function editMessengerMessage({ type, token, channelId, threadId, messageId, text, withTail }) {
    const clamped = clampForMessenger(text, type, withTail);
    if (type === 'telegram') {
      const r = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: channelId, message_id: messageId, text: clamped }),
      });
      const d = await r.json();
      // "message is not modified" → silently ok (Telegram returns 400 in that case)
      if (!d.ok && !/not modified/i.test(d.description ?? '')) {
        return { ok: false, error: d.description ?? `Telegram ${r.status}` };
      }
      return { ok: true };
    }
    if (type === 'discord') {
      const channel = threadId ?? channelId;
      const r = await fetch(
        `https://discord.com/api/v10/channels/${encodeURIComponent(channel)}/messages/${encodeURIComponent(messageId)}`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: clamped }),
        },
      );
      if (!r.ok) {
        const errText = await r.text();
        return { ok: false, error: `Discord ${r.status}: ${errText.slice(0, 200)}` };
      }
      return { ok: true };
    }
    return { ok: false, error: `Unknown messenger type ${type}` };
  }

  // OpenCode REST ----------------------------------------------------------
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

  async function sendOpencodePrompt({ sessionId, projectPath, text }) {
    const params = projectPath ? `?directory=${encodeURIComponent(projectPath)}` : '';
    const r = await opencodeFetch(
      `/session/${encodeURIComponent(sessionId)}/prompt_async${params}`,
      {
        method: 'POST',
        body: JSON.stringify({ parts: [{ type: 'text', text }] }),
      },
    );
    if (!r.ok) {
      const errText = await r.text();
      throw new Error(`OpenCode prompt ${r.status}: ${errText.slice(0, 300)}`);
    }
    return true;
  }

  // Best-effort fetch of a channel/topic's human name, used for slug-matching
  // against project labels when the listener didn't pre-resolve a project.
  async function lookupTargetName({ type, token, channelId, threadId }) {
    const key = `${type}:${channelId}${threadId ? `:${threadId}` : ''}`;
    const cached = nameCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.name;
    let name = null;
    try {
      if (type === 'discord') {
        // Threads are channels in Discord, so getChannel works for both.
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
        // No forum-topic name endpoint in Bot API. Best we get is the
        // supergroup title via getChat. For non-forum chats that's the
        // chat title; for forum chats the user's topic-channel mapping is
        // what slug-matches anyway, so fall back to the chat title.
        const r = await fetch(`https://api.telegram.org/bot${token}/getChat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: channelId }),
        });
        const data = await r.json();
        if (data.ok) {
          name = data.result?.title ?? data.result?.username ?? null;
        }
      }
    } catch {
      // Network/REST failures here are not fatal — we'll just fall back to
      // the first project.
    }
    nameCache.set(key, { name, expiresAt: Date.now() + NAME_TTL_MS });
    return name;
  }

  /**
   * Automatic project resolution — used when the listener didn't pre-resolve.
   * Strategy:
   *   1. Fetch the channel/topic name via the messenger REST API.
   *   2. Slug-match against the user's project list.
   *   3. If still no match, fall back to the first project (single-project
   *      installs are the common case).
   * Returns `{ projectPath, projectLabel }` or null.
   */
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

  // Session resolution -----------------------------------------------------
  async function resolveOrCreateSession({ type, token, channelId, threadId, projectPath, projectLabel }) {
    const hash = tokenHash(token);
    const key = targetKey({ channelId, threadId });
    const existing = bridgeStore.lookup({ type, botTokenHash: hash, targetKey: key });
    if (existing?.sessionId) {
      bridgeStore.touch({ type, botTokenHash: hash, targetKey: key });
      return { sessionId: existing.sessionId, projectPath: existing.projectPath, autoResolved: 'cached' };
    }

    // Auto-resolve project from channel/topic name when the listener didn't
    // supply one — the user shouldn't have to wire up channel mappings by hand.
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

  // Outbound (OpenCode → messenger) ---------------------------------------
  function scheduleEdit(sessionId) {
    const ctx = inflight.get(sessionId);
    if (!ctx || ctx.scheduled) return;
    ctx.scheduled = true;
    const wait = Math.max(0, EDIT_THROTTLE_MS - (Date.now() - ctx.lastFlushAt));
    setTimeout(() => {
      ctx.scheduled = false;
      void flushEdit(sessionId, /* final */ false);
    }, wait);
  }

  async function flushEdit(sessionId, isFinal) {
    const ctx = inflight.get(sessionId);
    if (!ctx) return;
    const parts = partBuffersBySession.get(sessionId);
    if (!parts) return;

    // Re-render the full body from the ordered list of parts.
    const body = parts.body.map((p) => p.text).join('');
    if (!body && !isFinal) return;

    ctx.lastFlushAt = Date.now();
    const text = body.trim().length === 0 && isFinal ? '_(no response)_' : body;
    const editRes = await editMessengerMessage({
      type: ctx.type,
      token: ctx.token,
      channelId: ctx.channelId,
      threadId: ctx.threadId,
      messageId: ctx.messageId,
      text,
      withTail: !isFinal,
    });
    if (!editRes.ok) {
      ctx.lastError = editRes.error;
    }
    if (isFinal) {
      ctx.finalized = true;
      broadcastEvent?.('messenger.bridge.session_idle', {
        type: ctx.type,
        sessionId,
        channelId: ctx.channelId,
        threadId: ctx.threadId,
        messageId: ctx.messageId,
      });
      inflight.delete(sessionId);
    }
  }

  function ensureParts(sessionId) {
    let bucket = partBuffersBySession.get(sessionId);
    if (!bucket) {
      bucket = { byPartId: new Map(), body: [] };
      partBuffersBySession.set(sessionId, bucket);
    }
    return bucket;
  }

  function applyPart(sessionId, part) {
    const text = renderPart(part);
    if (!text && part?.type !== 'tool') return;
    const bucket = ensureParts(sessionId);
    const partId = part?.id ?? `${part?.type}-${bucket.body.length}`;
    const existing = bucket.byPartId.get(partId);
    if (existing) {
      // Update in place — tool status transitions etc.
      existing.text = text;
    } else {
      const entry = { id: partId, text };
      bucket.byPartId.set(partId, entry);
      bucket.body.push(entry);
    }
    scheduleEdit(sessionId);
  }

  function handleGlobalEvent(normalized) {
    const payload = normalized.payload ?? normalized;
    if (!payload || typeof payload !== 'object') return;
    const type = payload.type ?? payload.event ?? null;
    const props = payload.properties ?? payload.props ?? payload;

    let sessionId = null;
    let part = null;

    if (type === 'message.part.updated') {
      part = props?.part;
      sessionId = part?.sessionID ?? part?.sessionId ?? props?.sessionID ?? null;
    } else if (type === 'message.updated') {
      const info = props?.info ?? props?.message;
      sessionId = info?.sessionID ?? info?.sessionId ?? null;
    } else if (type === 'session.idle') {
      sessionId = props?.sessionID ?? props?.sessionId ?? null;
      if (sessionId && inflight.has(sessionId)) {
        void flushEdit(sessionId, true);
      }
      return;
    } else if (type === 'session.error') {
      sessionId = props?.sessionID ?? props?.sessionId ?? null;
      const ctx = sessionId ? inflight.get(sessionId) : null;
      if (ctx) {
        ctx.lastError = props?.error?.message ?? props?.error ?? 'OpenCode session error';
        void flushEdit(sessionId, true);
      }
      return;
    } else {
      return;
    }

    if (!sessionId || !inflight.has(sessionId)) return;
    if (!part) return;
    // Only mirror assistant-side parts — skip the user's own echo.
    if (part?.role === 'user') return;
    applyPart(sessionId, part);
  }

  let unsubscribe = null;
  function ensureSubscribed() {
    if (unsubscribe) return;
    if (!globalEventHub) return;
    unsubscribe = globalEventHub.subscribeEvent(handleGlobalEvent);
  }

  // Inbound (messenger → OpenCode) ----------------------------------------
  /**
   * @returns {{ ok: boolean, sessionId?: string, messageId?: string|number, error?: string }}
   */
  async function routeInbound({
    type,
    token,
    channelId,
    threadId,
    text,
    projectPath,
    projectLabel,
    from,
  }) {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return { ok: false, error: 'empty text' };
    }
    ensureSubscribed();

    let sessionId;
    let effectiveProjectPath = projectPath ?? null;
    try {
      const resolved = await resolveOrCreateSession({
        type,
        token,
        channelId,
        threadId,
        projectPath,
        projectLabel,
      });
      sessionId = resolved.sessionId;
      effectiveProjectPath = resolved.projectPath ?? effectiveProjectPath;
    } catch (err) {
      return { ok: false, error: err?.message ?? 'session resolve failed' };
    }

    // Optimistic placeholder so the user sees something happen even before
    // OpenCode emits its first part.
    const starter = await postMessengerMessage({
      type,
      token,
      channelId,
      threadId,
      text: STARTER_TEXT,
    });
    if (!starter.ok) {
      return { ok: false, sessionId, error: `placeholder send failed: ${starter.error}` };
    }

    // Reset any leftover state from a previous interaction on the same
    // session (multi-turn conversations are common).
    partBuffersBySession.delete(sessionId);
    inflight.set(sessionId, {
      type,
      token,
      channelId,
      threadId,
      messageId: starter.id,
      lastFlushAt: 0,
      scheduled: false,
      finalized: false,
      lastError: null,
      startedAt: Date.now(),
      from,
    });

    try {
      await sendOpencodePrompt({ sessionId, projectPath: effectiveProjectPath, text });
    } catch (err) {
      const errMsg = err?.message ?? 'prompt failed';
      // Surface the failure in the same starter message so the user sees it.
      await editMessengerMessage({
        type,
        token,
        channelId,
        threadId,
        messageId: starter.id,
        text: `⚠ Otto could not reach OpenCode: ${errMsg}`,
        withTail: false,
      });
      inflight.delete(sessionId);
      return { ok: false, sessionId, error: errMsg };
    }

    broadcastEvent?.('messenger.bridge.inbound', {
      type,
      channelId,
      threadId,
      sessionId,
      text,
    });

    return { ok: true, sessionId, messageId: starter.id };
  }

  // Public API ------------------------------------------------------------
  function statusSnapshot({ type, token } = {}) {
    const hash = token ? tokenHash(token) : undefined;
    const bindings = bridgeStore.list({ type, botTokenHash: hash });
    const active = [...inflight.values()].map((ctx) => ({
      type: ctx.type,
      channelId: ctx.channelId,
      threadId: ctx.threadId,
      messageId: ctx.messageId,
      startedAt: ctx.startedAt,
      lastError: ctx.lastError,
    }));
    return { bindings, active };
  }

  function isEnabled() {
    return true;
  }

  return {
    routeInbound,
    statusSnapshot,
    isEnabled,
    ensureSubscribed,
    /** Test seam — exposed so tests can drive events without an SSE stream. */
    _handleGlobalEvent: handleGlobalEvent,
    store: bridgeStore,
  };
}
