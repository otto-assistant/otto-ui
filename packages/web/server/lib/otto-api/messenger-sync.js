import express, { Router } from 'express';

/**
 * Unified messenger sync routes for Discord and Telegram.
 * Handles project↔channel/topic mapping, message format adaptation, and onboarding.
 */
/** Map a Discord HTTP failure into a short, human-friendly message. */
function friendlyDiscordError(status, rawText) {
  const trimmed = (rawText ?? '').slice(0, 300);
  if (status === 401) return 'Invalid bot token.';
  if (status === 403) {
    return 'Bot has no access — invite it to the server and grant View Channel + Send Messages permission.';
  }
  if (status === 404) return 'Not found. Double-check the ID (right-click → Copy ID in Discord).';
  if (status === 429) return 'Rate-limited by Discord. Wait a few seconds and retry.';
  return trimmed || `HTTP ${status}`;
}

export function createMessengerSyncRouter({ broadcastEvent }) {
  const router = Router();

  router.use(express.json({ limit: '256kb' }));

  // Messenger configuration
  router.get('/config', (_req, res) => {
    res.json({
      supportedMessengers: ['discord', 'telegram'],
      discord: {
        features: ['channels', 'threads', 'embeds', 'reactions', 'files'],
        maxMessageLength: 2000,
        formatting: 'markdown-discord',
      },
      telegram: {
        features: ['groups', 'topics', 'markdown', 'buttons', 'files'],
        maxMessageLength: 4096,
        formatting: 'markdown-telegram',
      },
    });
  });

  // Test connection endpoint
  router.post('/test', async (req, res) => {
    const { type, token } = req.body ?? {};

    if (!type || !token) {
      return res.status(400).json({ error: 'type and token required' });
    }

    try {
      if (type === 'discord') {
        const headers = { Authorization: `Bot ${token}` };
        const resp = await fetch('https://discord.com/api/v10/users/@me', { headers });
        if (!resp.ok) {
          const text = await resp.text();
          return res.json({
            ok: false,
            error: `Discord: ${resp.status} — ${friendlyDiscordError(resp.status, text)}`,
          });
        }
        const data = await resp.json();

        // Fetch guilds the bot belongs to so the UI can show server context.
        // Failure here should not break verify — keep the response best-effort.
        let guilds = [];
        try {
          const gResp = await fetch('https://discord.com/api/v10/users/@me/guilds', { headers });
          if (gResp.ok) {
            const list = await gResp.json();
            guilds = Array.isArray(list)
              ? list.slice(0, 25).map((g) => ({ id: g.id, name: g.name }))
              : [];
          }
        } catch {
          // ignore — guilds is optional
        }

        return res.json({
          ok: true,
          id: data.id,
          username: data.username,
          discriminator: data.discriminator,
          guilds,
        });
      }

      if (type === 'telegram') {
        const resp = await fetch(`https://api.telegram.org/bot${token}/getMe`);
        const data = await resp.json();
        if (!data.ok) {
          return res.json({ ok: false, error: data.description ?? 'Invalid token' });
        }
        return res.json({ ok: true, username: data.result?.username, firstName: data.result?.first_name });
      }

      return res.status(400).json({ error: `Unknown messenger type: ${type}` });
    } catch (err) {
      return res.json({ ok: false, error: err.message ?? 'Connection failed' });
    }
  });

  /**
   * Send a real message to a Telegram chat or Discord channel.
   * Body: { type: 'telegram' | 'discord', token, target, text, parseMode? }
   *   - target: chat_id for Telegram, channel_id for Discord
   *   - parseMode: Telegram only (e.g. 'Markdown', 'MarkdownV2', 'HTML')
   */
  router.post('/send', async (req, res) => {
    const { type, token, target, text, parseMode } = req.body ?? {};

    if (!type || !token || !target || !text) {
      return res.status(400).json({ error: 'type, token, target and text are required' });
    }

    try {
      if (type === 'telegram') {
        const body = {
          chat_id: target,
          text: String(text).slice(0, 4096),
        };
        if (parseMode) body.parse_mode = parseMode;

        const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await resp.json();
        if (!data.ok) {
          return res.json({ ok: false, error: data.description ?? `Telegram error ${resp.status}` });
        }
        broadcastEvent?.('messenger.telegram.sent', { target, messageId: data.result?.message_id });
        return res.json({ ok: true, messageId: data.result?.message_id, sentAt: new Date().toISOString() });
      }

      if (type === 'discord') {
        const resp = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(target)}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bot ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: String(text).slice(0, 2000) }),
        });
        if (!resp.ok) {
          const errText = await resp.text();
          return res.json({
            ok: false,
            error: `Discord: ${resp.status} — ${friendlyDiscordError(resp.status, errText)}`,
          });
        }
        const data = await resp.json();
        broadcastEvent?.('messenger.discord.sent', { target, messageId: data.id });
        return res.json({ ok: true, messageId: data.id, sentAt: new Date().toISOString() });
      }

      return res.status(400).json({ error: `Unknown messenger type: ${type}` });
    } catch (err) {
      return res.json({ ok: false, error: err?.message ?? 'Send failed' });
    }
  });

  /**
   * Resolve a Discord channel by id and (best-effort) its guild name.
   * Body: { token, channelId }
   * Returns: { ok, channelId, channelName, channelType, guildId, guildName, parentId, canSend }
   *
   * channelType numeric mapping (Discord): 0=text, 5=announcement, 11=public_thread,
   * 12=private_thread, 15=forum, 16=media, 2=voice — we just expose the raw int + a label.
   */
  router.post('/discord/resolve-channel', async (req, res) => {
    const { token, channelId } = req.body ?? {};
    if (!token || !channelId) {
      return res.status(400).json({ error: 'token and channelId required' });
    }
    const headers = { Authorization: `Bot ${token}` };
    try {
      const chResp = await fetch(
        `https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}`,
        { headers },
      );
      if (!chResp.ok) {
        const text = await chResp.text();
        return res.json({
          ok: false,
          error: `Discord: ${chResp.status} — ${friendlyDiscordError(chResp.status, text)}`,
        });
      }
      const ch = await chResp.json();

      // Best-effort fetch of guild name for nicer UX. The bot only sees guilds it joined.
      let guildName = null;
      if (ch.guild_id) {
        try {
          const gResp = await fetch(
            `https://discord.com/api/v10/guilds/${encodeURIComponent(ch.guild_id)}`,
            { headers },
          );
          if (gResp.ok) {
            const g = await gResp.json();
            guildName = g?.name ?? null;
          }
        } catch {
          // ignore
        }
      }

      const typeLabels = {
        0: 'text',
        2: 'voice',
        4: 'category',
        5: 'announcement',
        10: 'announcement-thread',
        11: 'public-thread',
        12: 'private-thread',
        13: 'stage',
        15: 'forum',
        16: 'media',
      };

      return res.json({
        ok: true,
        channelId: ch.id,
        channelName: ch.name ?? null,
        channelType: ch.type,
        channelTypeLabel: typeLabels[ch.type] ?? `type-${ch.type}`,
        guildId: ch.guild_id ?? null,
        guildName,
        parentId: ch.parent_id ?? null,
      });
    } catch (err) {
      return res.json({ ok: false, error: err?.message ?? 'resolve-channel failed' });
    }
  });

  /**
   * Build a Discord bot invite URL the user can click to add the bot to a server.
   * Body: { clientId, permissions? }
   *   - clientId: the bot/application id (returned by /test for discord)
   *   - permissions: integer bitfield; defaults to a conservative "Send Messages, Embed Links,
   *     Read Message History, View Channel" set so messenger sync can actually post.
   */
  router.post('/discord/invite-url', (req, res) => {
    const { clientId, permissions } = req.body ?? {};
    if (!clientId || typeof clientId !== 'string') {
      return res.status(400).json({ error: 'clientId required' });
    }
    // Default perms: View Channel (1<<10) | Send Messages (1<<11) | Embed Links (1<<14)
    //              | Read Message History (1<<16) = 117760
    const perms = typeof permissions === 'string' || typeof permissions === 'number'
      ? String(permissions)
      : '117760';
    const url =
      `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}` +
      `&permissions=${encodeURIComponent(perms)}&scope=bot%20applications.commands`;
    return res.json({ ok: true, url });
  });

  /**
   * Resolve a Telegram chat by id (helpful confirmation after the user pastes a chat id).
   * Body: { token, chatId }
   */
  router.post('/telegram/resolve-chat', async (req, res) => {
    const { token, chatId } = req.body ?? {};
    if (!token || !chatId) {
      return res.status(400).json({ error: 'token and chatId required' });
    }
    try {
      const resp = await fetch(`https://api.telegram.org/bot${token}/getChat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId }),
      });
      const data = await resp.json();
      if (!data.ok) {
        return res.json({ ok: false, error: data.description ?? 'getChat failed' });
      }
      const c = data.result || {};
      return res.json({
        ok: true,
        chatId: c.id,
        title: c.title ?? c.username ?? c.first_name ?? null,
        type: c.type ?? null,
        isForum: Boolean(c.is_forum),
      });
    } catch (err) {
      return res.json({ ok: false, error: err?.message ?? 'resolve-chat failed' });
    }
  });

  // Webhook for incoming messages from messengers
  router.post('/webhook/:type', (req, res) => {
    const { type } = req.params;
    const payload = req.body;

    if (!payload) {
      return res.status(400).json({ error: 'Empty payload' });
    }

    broadcastEvent(`messenger.${type}.message`, {
      type,
      ...payload,
      receivedAt: new Date().toISOString(),
    });

    res.json({ ok: true });
  });

  // Format adapter - converts between internal format and messenger-specific format
  router.post('/format', (req, res) => {
    const { target, content, format } = req.body ?? {};

    if (!target || !content) {
      return res.status(400).json({ error: 'target and content required' });
    }

    const formatted = adaptMessageFormat(content, format ?? 'markdown', target);
    res.json({ formatted, target });
  });

  return router;
}

/**
 * Adapts message content between different formatting standards.
 */
function adaptMessageFormat(content, sourceFormat, targetMessenger) {
  if (targetMessenger === 'discord') {
    return adaptToDiscord(content, sourceFormat);
  }
  if (targetMessenger === 'telegram') {
    return adaptToTelegram(content, sourceFormat);
  }
  return content;
}

function adaptToDiscord(content, _sourceFormat) {
  let text = content;
  // Truncate to Discord's 2000 char limit
  if (text.length > 2000) {
    text = text.slice(0, 1950) + '\n\n_…truncated_';
  }
  return text;
}

function adaptToTelegram(content, _sourceFormat) {
  let text = content;
  // Convert Discord-style code blocks to Telegram MarkdownV2
  // Telegram uses same ``` syntax but some differences in inline formatting
  // Escape special chars for MarkdownV2: _ * [ ] ( ) ~ ` > # + - = | { } . !
  // Keep code blocks as-is
  if (text.length > 4096) {
    text = text.slice(0, 4050) + '\n\n…truncated';
  }
  return text;
}
