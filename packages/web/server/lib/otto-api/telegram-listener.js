/**
 * Server-side Telegram long-poll listener registry.
 *
 * The user pastes a bot token in the UI and starts a listener. We keep one
 * long-poll loop per token in memory:
 *  - calls `getUpdates` with the current offset and a 25s server-side timeout,
 *  - emits each incoming message via `broadcastEvent` so the UI / other
 *    subscribers can react,
 *  - auto-replies to each non-bot message with a short acknowledgement so the
 *    end-user immediately sees the bot is "alive",
 *  - exposes a small ring-buffer of recent inbound messages for the settings
 *    UI to display.
 *
 * State is in-memory only and reset on server restart; the UI re-starts the
 * listener after reload by calling /start again.
 */

const RECENT_BUFFER_SIZE = 25;
const LONG_POLL_TIMEOUT = 25;

const listeners = new Map();

function tokenKey(token) {
  return String(token);
}

async function tg(token, method, body) {
  const init =
    body === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        };
  const resp = await fetch(`https://api.telegram.org/bot${token}/${method}`, init);
  return resp.json();
}

function isAckRequested(text) {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim().toLowerCase();
  if (trimmed.startsWith('/start') || trimmed.startsWith('/ping') || trimmed.startsWith('/status')) {
    return true;
  }
  return false;
}

function buildAutoReply(update) {
  const msg = update.message ?? update.edited_message ?? update.channel_post;
  if (!msg) return null;
  const fromName =
    msg.from?.first_name ||
    msg.from?.username ||
    msg.chat?.title ||
    'there';
  const text = typeof msg.text === 'string' ? msg.text.trim() : '';

  if (text.startsWith('/start')) {
    return `Hi ${fromName}, Otto is connected ✓\n\nI'll relay project / task / schedule updates here. Send me a message any time — I'll log it in the Otto UI.`;
  }
  if (text.startsWith('/ping')) {
    return `pong (Otto is listening — last update at ${new Date().toISOString()})`;
  }
  if (text.startsWith('/status')) {
    return `Otto listener is online. Reply received from ${fromName}.`;
  }
  if (text.startsWith('/help')) {
    return [
      'Otto commands:',
      '/start — confirm the bot is connected',
      '/ping — health check',
      '/status — listener status',
      '/help — this message',
    ].join('\n');
  }
  // Default: short ack so the user sees something happens
  const preview = text.length > 80 ? text.slice(0, 80) + '…' : text || '(non-text message)';
  return `📥 Otto received: "${preview}"`;
}

async function processCallbackQuery(state, cb, broadcastEvent) {
  const data = typeof cb.data === 'string' ? cb.data : '';
  // Parse: otto-approve:{id} (once), otto-approve-always:{id}, otto-deny:{id}
  const decision =
    data.startsWith('otto-approve-always:') ? 'approve-always' :
    data.startsWith('otto-approve:') ? 'approve' :
    data.startsWith('otto-deny:') ? 'deny' :
    null;
  if (!decision) {
    // ack so the spinner stops, then ignore
    try {
      await tg(state.token, 'answerCallbackQuery', { callback_query_id: cb.id });
    } catch {}
    return;
  }
  const approvalId = data.split(':')[1];
  const userName =
    cb.from?.first_name || cb.from?.username || `user ${cb.from?.id ?? ''}`.trim();
  const isApprove = decision === 'approve' || decision === 'approve-always';
  const ackText = isApprove
    ? (decision === 'approve-always' ? `Approved always by ${userName}` : `Approved by ${userName}`)
    : `Denied by ${userName}`;
  try {
    await tg(state.token, 'answerCallbackQuery', {
      callback_query_id: cb.id,
      text: ackText,
      show_alert: false,
    });
  } catch {}
  // Edit the original message so the buttons disappear and the outcome is permanent in chat.
  if (cb.message?.chat?.id && cb.message?.message_id) {
    const original = cb.message.text ?? '';
    const decoration = isApprove
      ? (decision === 'approve-always' ? '\n\n♻️ ' + ackText : '\n\n✅ ' + ackText)
      : '\n\n❌ ' + ackText;
    try {
      await tg(state.token, 'editMessageText', {
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        text: (original + decoration).slice(0, 4096),
      });
    } catch {}
  }
  try {
    broadcastEvent?.('messenger.telegram.approval', {
      approvalId,
      decision,
      by: {
        id: cb.from?.id,
        username: cb.from?.username ?? null,
        firstName: cb.from?.first_name ?? null,
      },
      chatId: cb.message?.chat?.id ?? null,
      messageId: cb.message?.message_id ?? null,
      decidedAt: new Date().toISOString(),
    });
  } catch {}
}

async function processUpdate(state, update, broadcastEvent, bridge) {
  if (update.callback_query) {
    await processCallbackQuery(state, update.callback_query, broadcastEvent);
    return;
  }
  const msg = update.message ?? update.edited_message ?? update.channel_post;
  if (!msg) return;

  // Record into ring buffer
  const inboundSummary = {
    updateId: update.update_id,
    chatId: msg.chat?.id,
    chatTitle: msg.chat?.title ?? msg.chat?.username ?? null,
    chatType: msg.chat?.type ?? null,
    threadId: msg.message_thread_id ?? null,
    from: msg.from
      ? {
          id: msg.from.id,
          username: msg.from.username ?? null,
          firstName: msg.from.first_name ?? null,
          isBot: Boolean(msg.from.is_bot),
        }
      : null,
    text: typeof msg.text === 'string' ? msg.text : null,
    receivedAt: new Date().toISOString(),
  };
  state.recent.push(inboundSummary);
  if (state.recent.length > RECENT_BUFFER_SIZE) {
    state.recent.splice(0, state.recent.length - RECENT_BUFFER_SIZE);
  }
  state.totalReceived += 1;
  state.lastUpdateAt = Date.now();

  try {
    broadcastEvent?.('messenger.telegram.message_received', inboundSummary);
  } catch {
    // ignore broadcast failures
  }

  // Skip bot-to-bot to avoid feedback loops.
  if (msg.from?.is_bot) return;

  const text = typeof msg.text === 'string' ? msg.text.trim() : '';

  // OpenCode bridge — every non-command, non-empty text message is forwarded
  // to OpenCode and the streaming response is mirrored back into the same
  // chat/topic. This is what makes Telegram a real OpenChamber chat surface.
  if (bridge && state.bridgeEnabled !== false && text.length > 0 && !text.startsWith('/')) {
    try {
      // Project resolution from the caller-supplied registry (chat → project).
      const project = state.resolveProject?.({
        chatId: String(msg.chat.id),
        threadId: msg.message_thread_id ? String(msg.message_thread_id) : null,
      });
      const bridged = await bridge.routeInbound({
        type: 'telegram',
        token: state.token,
        channelId: String(msg.chat.id),
        threadId: msg.message_thread_id ? String(msg.message_thread_id) : null,
        text,
        projectPath: project?.path ?? null,
        projectLabel: project?.label ?? null,
        from: {
          id: msg.from?.id,
          username: msg.from?.username,
          firstName: msg.from?.first_name,
        },
      });
      if (bridged.ok) {
        state.totalReplied += 1;
        state.lastError = null;
        return;
      }
      state.lastError = bridged.error ?? 'bridge failed';
      // Fall through to the auto-reply path so the user at least sees that
      // something tried to happen.
    } catch (err) {
      state.lastError = err?.message ?? 'bridge failed';
    }
  }

  // Auto-reply fallback — runs when the bridge is off, the message is a
  // shorthand command (`/start`, `/ping`, …) or the bridge threw.
  if (!state.autoReply) return;

  const reply = buildAutoReply(update);
  if (!reply) return;

  try {
    const body = {
      chat_id: msg.chat.id,
      text: reply,
      reply_parameters: { message_id: msg.message_id },
    };
    if (msg.message_thread_id) body.message_thread_id = msg.message_thread_id;
    const sent = await tg(state.token, 'sendMessage', body);
    if (sent.ok) {
      state.totalReplied += 1;
      broadcastEvent?.('messenger.telegram.auto_reply', {
        chatId: msg.chat.id,
        threadId: msg.message_thread_id ?? null,
        text: reply,
        messageId: sent.result?.message_id,
      });
    } else {
      state.lastError = sent.description ?? 'sendMessage failed';
    }
  } catch (err) {
    state.lastError = err?.message ?? 'auto-reply failed';
  }
}

async function pollLoop(state, broadcastEvent, bridge) {
  // Clear any stale webhook so getUpdates doesn't 409.
  try {
    await tg(state.token, 'deleteWebhook', { drop_pending_updates: false });
  } catch {
    // ignore — best effort
  }

  while (!state.stopRequested) {
    let updates;
    try {
      const data = await tg(state.token, 'getUpdates', {
        offset: state.offset,
        timeout: LONG_POLL_TIMEOUT,
        allowed_updates: ['message', 'edited_message', 'channel_post', 'callback_query'],
      });
      if (!data.ok) {
        state.lastError = data.description ?? 'getUpdates failed';
        state.consecutiveErrors += 1;
        // Back off so we don't hammer the API on persistent errors.
        await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * state.consecutiveErrors)));
        continue;
      }
      updates = data.result;
      state.consecutiveErrors = 0;
      state.lastError = null;
    } catch (err) {
      state.lastError = err?.message ?? 'network error';
      state.consecutiveErrors += 1;
      await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * state.consecutiveErrors)));
      continue;
    }

    if (Array.isArray(updates) && updates.length > 0) {
      for (const upd of updates) {
        await processUpdate(state, upd, broadcastEvent, bridge);
        if (typeof upd.update_id === 'number') {
          state.offset = upd.update_id + 1;
        }
      }
    }
  }

  state.running = false;
}

export function createTelegramListenerRegistry({ broadcastEvent, bridge = null } = {}) {
  function getState(token) {
    return listeners.get(tokenKey(token));
  }

  function start(token, opts = {}) {
    const key = tokenKey(token);
    const existing = listeners.get(key);
    if (existing && existing.running) {
      return { ok: true, alreadyRunning: true, ...statusSnapshot(existing) };
    }
    const state = {
      token,
      offset: 0,
      running: true,
      stopRequested: false,
      autoReply: opts.autoReply !== false,
      bridgeEnabled: opts.bridgeEnabled !== false,
      resolveProject: opts.resolveProject ?? null,
      startedAt: Date.now(),
      lastUpdateAt: null,
      lastError: null,
      consecutiveErrors: 0,
      totalReceived: 0,
      totalReplied: 0,
      recent: [],
    };
    listeners.set(key, state);
    // Fire-and-forget; loop manages its own lifecycle.
    pollLoop(state, broadcastEvent, bridge).catch((err) => {
      state.lastError = err?.message ?? 'poll loop crashed';
      state.running = false;
    });
    return { ok: true, alreadyRunning: false, ...statusSnapshot(state) };
  }

  function stop(token) {
    const key = tokenKey(token);
    const state = listeners.get(key);
    if (!state) return { ok: true, running: false };
    state.stopRequested = true;
    state.running = false;
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
      messages: state.recent.slice(-n).reverse(),
    };
  }

  function statusSnapshot(state) {
    return {
      running: state.running,
      autoReply: state.autoReply,
      bridgeEnabled: state.bridgeEnabled,
      startedAt: state.startedAt,
      lastUpdateAt: state.lastUpdateAt,
      lastError: state.lastError,
      totalReceived: state.totalReceived,
      totalReplied: state.totalReplied,
      offset: state.offset,
      recentCount: state.recent.length,
    };
  }

  return { start, stop, status, recent, getState };
}

export { RECENT_BUFFER_SIZE };
