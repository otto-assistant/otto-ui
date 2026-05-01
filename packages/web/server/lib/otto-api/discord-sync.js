import express from 'express';

/**
 * Discord ↔ Web UI bidirectional message sync.
 *
 * Endpoints:
 *   POST   /api/otto/discord/send                     — send message from Web UI to Discord
 *   GET    /api/otto/discord/threads                  — list thread mappings
 *   GET    /api/otto/discord/threads/:threadId/messages — messages for a thread
 *   POST   /api/otto/discord/webhook                  — receives inbound messages from discord-relay
 */

// In-memory store (production would use persistent DB)
const threadMap = new Map(); // threadId -> { id, name, channelId, createdAt }
const messageStore = new Map(); // threadId -> message[]

const createDiscordSyncRouter = ({ broadcastEvent }) => {
  const router = express.Router();

  // --- GET /threads ---
  router.get('/threads', (_req, res) => {
    const threads = [...threadMap.values()];
    res.json({ threads });
  });

  // --- GET /threads/:threadId/messages ---
  router.get('/threads/:threadId/messages', (req, res) => {
    const { threadId } = req.params;
    const messages = messageStore.get(threadId) || [];
    res.json({ messages });
  });

  // --- POST /send ---
  router.post('/send', (req, res) => {
    const { threadId, text } = req.body || {};
    if (!threadId || !text) {
      return res.status(400).json({ error: 'threadId and text are required' });
    }

    // Ensure thread exists
    if (!threadMap.has(threadId)) {
      threadMap.set(threadId, {
        id: threadId,
        name: `Thread ${threadId}`,
        channelId: null,
        createdAt: new Date().toISOString(),
      });
    }

    const message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      threadId,
      text,
      source: 'web',
      author: { username: 'Web User', avatar: null },
      createdAt: new Date().toISOString(),
    };

    if (!messageStore.has(threadId)) {
      messageStore.set(threadId, []);
    }
    messageStore.get(threadId).push(message);

    // Broadcast to WebSocket clients
    if (broadcastEvent) {
      broadcastEvent('discord:message', message);
    }

    res.json({ ok: true, message });
  });

  // --- POST /webhook --- (inbound from discord-relay)
  router.post('/webhook', (req, res) => {
    const { threadId, threadName, channelId, text, author } = req.body || {};
    if (!threadId || !text) {
      return res.status(400).json({ error: 'threadId and text are required' });
    }

    // Upsert thread
    if (!threadMap.has(threadId)) {
      threadMap.set(threadId, {
        id: threadId,
        name: threadName || `Thread ${threadId}`,
        channelId: channelId || null,
        createdAt: new Date().toISOString(),
      });
    }

    const message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      threadId,
      text,
      source: 'discord',
      author: {
        username: author?.username || 'Unknown',
        avatar: author?.avatar || null,
      },
      createdAt: new Date().toISOString(),
    };

    if (!messageStore.has(threadId)) {
      messageStore.set(threadId, []);
    }
    messageStore.get(threadId).push(message);

    // Broadcast to WebSocket clients
    if (broadcastEvent) {
      broadcastEvent('discord:message', message);
    }

    res.json({ ok: true, message });
  });

  return router;
};

export { createDiscordSyncRouter };
