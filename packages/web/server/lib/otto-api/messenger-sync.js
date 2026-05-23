import { Router } from 'express';

/**
 * Unified messenger sync routes for Discord and Telegram.
 * Handles project↔channel/topic mapping, message format adaptation, and onboarding.
 */
export function createMessengerSyncRouter({ broadcastEvent }) {
  const router = Router();

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
        const resp = await fetch('https://discord.com/api/v10/users/@me', {
          headers: { Authorization: `Bot ${token}` },
        });
        if (!resp.ok) {
          const text = await resp.text();
          return res.json({ ok: false, error: `Discord: ${resp.status} ${text.slice(0, 200)}` });
        }
        const data = await resp.json();
        return res.json({ ok: true, username: data.username, discriminator: data.discriminator });
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
