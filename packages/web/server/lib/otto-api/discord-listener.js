import WebSocket from 'ws';
import crypto from 'node:crypto';

/**
 * Discord Gateway listener registry, keyed by bot token.
 *
 * Talks Discord Gateway v10 over WebSocket directly using `ws` (no discord.js)
 * so we don't pull a megabyte-sized lib into the web server. We implement the
 * minimal subset needed for messenger-sync:
 *  - HELLO + heartbeat with the server-supplied interval
 *  - IDENTIFY with intents = GUILDS | GUILD_MESSAGES | DIRECT_MESSAGES |
 *    MESSAGE_CONTENT  (and we receive INTERACTION_CREATE without any intent)
 *  - DISPATCH events:
 *      READY        — capture session_id + resume_gateway_url
 *      MESSAGE_CREATE — broadcast over /ws/otto/events + push into ring buffer
 *                      + (optional) auto-reply via REST
 *      INTERACTION_CREATE — for button clicks on approval messages: broadcast
 *                      a structured event + ACK the interaction
 *
 * The mapping from inbound message → store is identical in shape to the
 * Telegram listener so the UI can render a single 'recent messages' list.
 *
 * State is in-memory only; UI re-starts the listener after reload.
 */

const RECENT_BUFFER_SIZE = 25;
const GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';

const INTENT_GUILDS = 1 << 0;
const INTENT_GUILD_MESSAGES = 1 << 9;
const INTENT_DIRECT_MESSAGES = 1 << 12;
const INTENT_MESSAGE_CONTENT = 1 << 15;
const DEFAULT_INTENTS =
  INTENT_GUILDS | INTENT_GUILD_MESSAGES | INTENT_DIRECT_MESSAGES | INTENT_MESSAGE_CONTENT;

const OP_DISPATCH = 0;
const OP_HEARTBEAT = 1;
const OP_IDENTIFY = 2;
const OP_RESUME = 6;
const OP_RECONNECT = 7;
const OP_INVALID_SESSION = 9;
const OP_HELLO = 10;
const OP_HEARTBEAT_ACK = 11;

const listeners = new Map();

function tokenKey(token) {
  return String(token);
}

async function restCall(token, method, path, body) {
  const url = `https://discord.com/api/v10${path}`;
  const init = {
    method,
    headers: { Authorization: `Bot ${token}` },
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const r = await fetch(url, init);
  return { ok: r.ok, status: r.status, body: r.ok ? await r.json().catch(() => null) : await r.text() };
}

function buildAutoReply(message) {
  const text = typeof message.content === 'string' ? message.content.trim() : '';
  const fromName =
    message.author?.global_name ||
    message.author?.username ||
    'there';

  if (text.startsWith('/start') || text.toLowerCase().startsWith('!ping')) {
    return `pong — Otto is listening (last update at ${new Date().toISOString()})`;
  }
  if (text.toLowerCase().startsWith('!help')) {
    return [
      'Otto commands:',
      '`!ping` — health check',
      '`!status` — listener status',
      '`!help` — this message',
    ].join('\n');
  }
  if (text.toLowerCase().startsWith('!status')) {
    return `Otto listener is online. Reply received from ${fromName}.`;
  }
  const preview = text.length > 80 ? text.slice(0, 80) + '…' : text || '(non-text message)';
  return `Otto received: "${preview}"`;
}

function inboundFromMessage(message) {
  return {
    updateId: message.id,
    chatId: message.channel_id,
    chatTitle: null,
    chatType: message.guild_id ? 'guild' : 'dm',
    threadId: null,
    from: {
      id: message.author?.id ? Number(message.author.id) || message.author.id : null,
      username: message.author?.username ?? null,
      firstName: message.author?.global_name ?? null,
      isBot: Boolean(message.author?.bot),
    },
    text: message.content ?? null,
    receivedAt: new Date().toISOString(),
    // Extra discord-only fields:
    discord: {
      guildId: message.guild_id ?? null,
      messageId: message.id,
      authorId: message.author?.id ?? null,
    },
  };
}

async function dispatchMessageCreate(state, message, broadcastEvent) {
  // Filter: only act when the message is in a guild we care about, or a DM.
  // If state.guildId is set, scope to that guild.
  if (state.guildId && message.guild_id && message.guild_id !== state.guildId) return;

  const inbound = inboundFromMessage(message);
  state.recent.push(inbound);
  if (state.recent.length > RECENT_BUFFER_SIZE) {
    state.recent.splice(0, state.recent.length - RECENT_BUFFER_SIZE);
  }
  state.totalReceived += 1;
  state.lastUpdateAt = Date.now();

  try {
    broadcastEvent?.('messenger.discord.message_received', inbound);
  } catch {
    // ignore
  }

  if (!state.autoReply) return;
  if (message.author?.bot) return;
  // Don't reply to ourselves
  if (state.botId && message.author?.id === state.botId) return;

  const replyText = buildAutoReply(message);
  if (!replyText) return;

  try {
    const r = await restCall(state.token, 'POST', `/channels/${encodeURIComponent(message.channel_id)}/messages`, {
      content: replyText.slice(0, 2000),
      message_reference: {
        message_id: message.id,
        channel_id: message.channel_id,
        guild_id: message.guild_id,
        fail_if_not_exists: false,
      },
    });
    if (r.ok) {
      state.totalReplied += 1;
      broadcastEvent?.('messenger.discord.auto_reply', {
        chatId: message.channel_id,
        text: replyText,
        messageId: r.body?.id,
      });
    } else {
      state.lastError = `auto-reply failed: ${r.status} ${typeof r.body === 'string' ? r.body.slice(0, 200) : ''}`;
    }
  } catch (err) {
    state.lastError = err?.message ?? 'auto-reply failed';
  }
}

async function dispatchInteractionCreate(state, interaction, broadcastEvent) {
  // We only care about MESSAGE_COMPONENT (type 3) interactions for approval buttons.
  // Type 1 = PING (auto-acked), 2 = APPLICATION_COMMAND (slash), 3 = MESSAGE_COMPONENT, 5 = MODAL_SUBMIT.
  if (interaction.type !== 3) return;

  const customId = interaction.data?.custom_id ?? '';
  const value =
    customId.startsWith('otto-approve:') ? 'approve' :
    customId.startsWith('otto-deny:') ? 'deny' :
    null;
  if (!value) return;

  const approvalId = customId.split(':')[1];
  const responseText = value === 'approve' ? '✅ Approved by ' : '❌ Denied by ';
  const user = interaction.member?.user ?? interaction.user;
  const userName = user?.global_name || user?.username || 'user';

  // Ack so the user sees Discord stop spinning.
  try {
    await restCall(state.token, 'POST', `/interactions/${interaction.id}/${interaction.token}/callback`, {
      type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
      data: {
        content: `${responseText}${userName}`,
        flags: 64, // EPHEMERAL — only the clicker sees it
      },
    });
  } catch {
    // ignore — best effort
  }

  broadcastEvent?.('messenger.discord.approval', {
    approvalId,
    decision: value,
    by: { id: user?.id, username: user?.username, displayName: user?.global_name ?? null },
    messageId: interaction.message?.id ?? null,
    channelId: interaction.channel_id ?? null,
    guildId: interaction.guild_id ?? null,
    decidedAt: new Date().toISOString(),
  });
}

function send(ws, payload) {
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    // ignore — WS may be closing
  }
}

function startSession(state, broadcastEvent) {
  if (state.stopRequested) return;
  let ws;
  try {
    ws = new WebSocket(GATEWAY_URL);
  } catch (err) {
    state.lastError = err?.message ?? 'gateway connect failed';
    return scheduleReconnect(state, broadcastEvent);
  }
  state.ws = ws;
  state.heartbeatAcked = true;

  ws.on('open', () => {
    state.consecutiveErrors = 0;
  });

  ws.on('message', (raw) => {
    let payload;
    try {
      payload = JSON.parse(raw.toString('utf-8'));
    } catch {
      return;
    }
    if (typeof payload.s === 'number') state.sequence = payload.s;

    switch (payload.op) {
      case OP_HELLO: {
        const interval = payload.d?.heartbeat_interval ?? 41250;
        state.heartbeatTimer = setInterval(() => {
          if (!state.heartbeatAcked) {
            try {
              ws.close(4000, 'no heartbeat ack');
            } catch {}
            return;
          }
          state.heartbeatAcked = false;
          send(ws, { op: OP_HEARTBEAT, d: state.sequence });
        }, interval);
        send(ws, {
          op: OP_IDENTIFY,
          d: {
            token: state.token,
            intents: state.intents,
            properties: { os: 'linux', browser: 'otto-ui', device: 'otto-ui' },
            presence: {
              status: 'online',
              activities: [{ name: 'Otto sync', type: 0 }],
            },
          },
        });
        return;
      }
      case OP_HEARTBEAT_ACK:
        state.heartbeatAcked = true;
        return;
      case OP_HEARTBEAT:
        send(ws, { op: OP_HEARTBEAT, d: state.sequence });
        return;
      case OP_RECONNECT:
        try {
          ws.close(4000, 'reconnect requested');
        } catch {}
        return;
      case OP_INVALID_SESSION:
        state.sessionId = null;
        try {
          ws.close(4000, 'invalid session');
        } catch {}
        return;
      case OP_DISPATCH: {
        const t = payload.t;
        if (t === 'READY') {
          state.sessionId = payload.d?.session_id ?? null;
          state.botId = payload.d?.user?.id ?? null;
          state.botUsername = payload.d?.user?.username ?? null;
          state.connected = true;
          state.lastError = null;
          broadcastEvent?.('messenger.discord.listener_ready', {
            botId: state.botId,
            botUsername: state.botUsername,
          });
          return;
        }
        if (t === 'MESSAGE_CREATE') {
          void dispatchMessageCreate(state, payload.d, broadcastEvent);
          return;
        }
        if (t === 'INTERACTION_CREATE') {
          void dispatchInteractionCreate(state, payload.d, broadcastEvent);
          return;
        }
        return;
      }
      default:
        return;
    }
  });

  const cleanupAndMaybeReconnect = (codeOrErr) => {
    if (state.heartbeatTimer) {
      clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
    state.connected = false;
    state.ws = null;
    if (codeOrErr instanceof Error) state.lastError = codeOrErr.message;
    if (state.stopRequested) {
      state.running = false;
      return;
    }
    scheduleReconnect(state, broadcastEvent);
  };

  ws.on('close', (code, reason) => {
    if (code && code !== 1000) {
      state.lastError = `gateway closed ${code}${reason ? ` — ${reason.toString().slice(0, 200)}` : ''}`;
    }
    // 4014 = disallowed intent — most commonly MESSAGE_CONTENT not enabled in dev portal.
    if (code === 4014) {
      state.lastError =
        'Gateway 4014: Message Content intent is not enabled. Open the Discord Developer Portal → your app → Bot → enable "MESSAGE CONTENT INTENT", then restart the listener.';
      state.stopRequested = true;
    }
    if (code === 4004) {
      state.lastError = 'Gateway 4004: Invalid bot token.';
      state.stopRequested = true;
    }
    cleanupAndMaybeReconnect();
  });

  ws.on('error', (err) => {
    state.consecutiveErrors += 1;
    cleanupAndMaybeReconnect(err);
  });
}

function scheduleReconnect(state, broadcastEvent) {
  if (state.stopRequested) {
    state.running = false;
    return;
  }
  const delay = Math.min(30_000, 1000 * Math.max(1, state.consecutiveErrors));
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    startSession(state, broadcastEvent);
  }, delay);
}

export function createDiscordListenerRegistry({ broadcastEvent } = {}) {
  function start(token, opts = {}) {
    const key = tokenKey(token);
    const existing = listeners.get(key);
    if (existing && existing.running) {
      return { ok: true, alreadyRunning: true, ...statusSnapshot(existing) };
    }
    const state = {
      token,
      guildId: opts.guildId ?? null,
      intents: opts.intents ?? DEFAULT_INTENTS,
      autoReply: opts.autoReply !== false,
      ws: null,
      heartbeatTimer: null,
      heartbeatAcked: true,
      sequence: null,
      sessionId: null,
      botId: null,
      botUsername: null,
      connected: false,
      running: true,
      stopRequested: false,
      startedAt: Date.now(),
      lastUpdateAt: null,
      lastError: null,
      consecutiveErrors: 0,
      totalReceived: 0,
      totalReplied: 0,
      recent: [],
      reconnectTimer: null,
    };
    listeners.set(key, state);
    startSession(state, broadcastEvent);
    return { ok: true, alreadyRunning: false, ...statusSnapshot(state) };
  }

  function stop(token) {
    const key = tokenKey(token);
    const state = listeners.get(key);
    if (!state) return { ok: true, running: false };
    state.stopRequested = true;
    state.running = false;
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
    if (state.ws) {
      try {
        state.ws.close(1000, 'stop requested');
      } catch {
        // ignore
      }
    }
    listeners.delete(key);
    return { ok: true, running: false, stoppedAt: new Date().toISOString() };
  }

  function status(token) {
    const state = listeners.get(tokenKey(token));
    if (!state) return { ok: true, running: false };
    return { ok: true, ...statusSnapshot(state) };
  }

  function recent(token, limit = RECENT_BUFFER_SIZE) {
    const state = listeners.get(tokenKey(token));
    if (!state) return { ok: true, messages: [], running: false };
    const n = Math.max(1, Math.min(RECENT_BUFFER_SIZE, Number(limit) || RECENT_BUFFER_SIZE));
    return {
      ok: true,
      running: state.running,
      connected: state.connected,
      messages: state.recent.slice(-n).reverse(),
    };
  }

  function statusSnapshot(state) {
    return {
      running: state.running,
      connected: state.connected,
      autoReply: state.autoReply,
      botId: state.botId,
      botUsername: state.botUsername,
      startedAt: state.startedAt,
      lastUpdateAt: state.lastUpdateAt,
      lastError: state.lastError,
      totalReceived: state.totalReceived,
      totalReplied: state.totalReplied,
      recentCount: state.recent.length,
    };
  }

  return { start, stop, status, recent };
}

export function generateApprovalId() {
  return `appr_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

export { DEFAULT_INTENTS };
