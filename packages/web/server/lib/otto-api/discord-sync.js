import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import { SqliteDiscordSyncStore, tenantFromGuild } from './discord-sync-store.js';

/**
 * Discord ↔ Web UI message sync HTTP surface for Otto relay / gateway integration.
 *
 * Mounted at `/api/otto/discord` by the Web UI server.
 *
 * ## Tenant / guild scope (gateway-safe patterns)
 *
 * Aligns with bridge gateway-proxy auth: tenants are partitioned by Discord guild id
 * (see https://github.com/otto-assistant/bridge OTTO_AGENTS.md — gateway_clients keyed by client_id + guild_id).
 *
 * This API namespaces threads and messages by `tenant_id = guild:${guildId}` when `guildId` is present
 * (JSON body field `guildId`, query `guildId`, or header `x-otto-guild-id`). Without `guildId`, data uses
 * tenant `_unscoped` for single-tenant/dev; production relays should send `guildId` so thread ids cannot
 * collide across guilds.
 *
 * ## Webhook authentication
 *
 * If `OTTO_DISCORD_WEBHOOK_SECRET` is set, inbound `POST .../webhook` must supply the same value via
 * header `x-otto-discord-webhook-secret` or JSON field `webhookSecret`. This closes unauthenticated ingress
 * from arbitrary networks toward the Otto UI inbox (relay is a privileged hop, like gateway `client_secret`).
 *
 * Env var names only; never commit secret values:
 * - `OTTO_DISCORD_WEB_SYNC_DB_PATH`
 * - `OTTO_DISCORD_WEBHOOK_SECRET`
 * - `OPENCHAMBER_DATA_DIR` (defaults store path under ~/.openchamber when unset)
 */

/**
 * @typedef {{ broadcastEvent?: (type: string, data: unknown) => void; persistence?: import('./discord-sync-store.js').DiscordSyncPersistence; dbPath?: string }} DiscordSyncRouterOptions
 */

function resolvedDefaultDbPath() {
  const root =
    typeof process.env.OPENCHAMBER_DATA_DIR === 'string' && process.env.OPENCHAMBER_DATA_DIR.trim().length > 0
      ? path.resolve(process.env.OPENCHAMBER_DATA_DIR.trim())
      : path.join(os.homedir(), '.openchamber');
  fs.mkdirSync(root, { recursive: true });
  return path.join(root, 'discord-web-sync.sqlite');
}

/**
 * @param {string | undefined} configured
 */
function resolveDbPath(configured) {
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return path.resolve(configured.trim());
  }
  const env = process.env.OTTO_DISCORD_WEB_SYNC_DB_PATH;
  if (typeof env === 'string' && env.trim().length > 0) {
    return path.resolve(env.trim());
  }
  return resolvedDefaultDbPath();
}

function webhookSecretConfigured() {
  const s = process.env.OTTO_DISCORD_WEBHOOK_SECRET;
  return typeof s === 'string' && s.length > 0 ? s : null;
}

/**
 * @param {string | undefined} headerVal
 * @param {string | undefined} bodyVal
 */
function webhookSecretMatches(headerVal, bodyVal) {
  const expected = webhookSecretConfigured();
  if (!expected) {
    return true;
  }
  const candidates = [];
  if (typeof headerVal === 'string') {
    candidates.push(headerVal);
  }
  if (typeof bodyVal === 'string') {
    candidates.push(bodyVal);
  }
  const decoded = Buffer.from(expected, 'utf8');
  return candidates.some((c) => {
    try {
      const p = Buffer.from(c, 'utf8');
      if (decoded.length !== p.length) {
        return false;
      }
      return crypto.timingSafeEqual(decoded, p);
    } catch {
      return false;
    }
  });
}

/**
 * @param {express.Request} req
 * @param {{ guildId?: string }} [bodyLike]
 */
function resolveTenantId(req, bodyLike) {
  const headerGuild = req.headers['x-otto-guild-id'];
  const fromHeader =
    typeof headerGuild === 'string' ? headerGuild.trim() : Array.isArray(headerGuild) ? String(headerGuild[0]).trim() : '';

  const fromQuery =
    typeof req.query?.guildId === 'string' ? req.query.guildId.trim() : '';

  const fromBodyGuild =
    bodyLike && typeof bodyLike.guildId === 'string' ? bodyLike.guildId.trim() : '';

  const gid = fromBodyGuild || fromHeader || fromQuery;
  if (gid && gid.length > 0) {
    return tenantFromGuild(gid);
  }
  return '_unscoped';
}

/**
 * @param {DiscordSyncRouterOptions} [opts]
 */
const createDiscordSyncRouter = (opts = {}) => {
  const broadcastEvent = opts.broadcastEvent;
  /** @type {import('./discord-sync-store.js').DiscordSyncPersistence} */
  const persistence =
    opts.persistence ?? new SqliteDiscordSyncStore({ dbPath: resolveDbPath(opts.dbPath) });

  const router = express.Router();

  router.use(express.json({ limit: '512kb' }));

  router.get('/threads', (req, res) => {
    const tenantId = resolveTenantId(req, {});
    const threads = persistence.listThreads(tenantId);
    res.json({ threads, tenantId });
  });

  router.get('/threads/:threadId/messages', (req, res) => {
    const tenantId = resolveTenantId(req, {});
    const { threadId } = req.params;
    const messages = persistence.getMessages(tenantId, threadId);
    res.json({ messages });
  });

  router.post('/send', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const tenantId = resolveTenantId(req, body);

    const threadId =
      typeof body.threadId === 'string' ? body.threadId.trim() : undefined;
    const text =
      typeof body.text === 'string' ? body.text : typeof body.prompt === 'string' ? body.prompt : undefined;

    if (!threadId || !text || text.trim().length === 0) {
      return res.status(400).json({ error: 'threadId and non-empty text (or prompt) are required' });
    }

    const threadMeta = persistence.listThreads(tenantId).find((t) => t.id === threadId);
    const now = new Date().toISOString();
    const effectiveChannel =
      typeof body.channelId === 'string' ? body.channelId : threadMeta?.channelId ?? null;

    persistence.upsertThread(tenantId, {
      id: threadId,
      name: threadMeta?.name || (typeof body.threadName === 'string' ? body.threadName : `Thread ${threadId}`),
      channelId: effectiveChannel,
      createdAt: threadMeta?.createdAt || now,
    });

    const username =
      typeof body.author?.username === 'string'
        ? body.author.username.trim()
        : typeof body.username === 'string'
          ? body.username.trim()
          : 'Web User';

    const message = {
      id: crypto.randomUUID(),
      threadId,
      text: text.trim(),
      source: /** @type {const} */ ('web'),
      author: {
        username,
        avatar: typeof body.author?.avatar === 'string' ? body.author.avatar : null,
      },
      createdAt: now,
      channelId: effectiveChannel,
    };

    persistence.appendMessage(tenantId, message);

    if (broadcastEvent) {
      broadcastEvent('discord:message', message);
    }

    res.json({ ok: true, message });
  });

  router.post('/webhook', (req, res) => {
    const headerSecretRaw = req.headers['x-otto-discord-webhook-secret'];
    const headerStr =
      typeof headerSecretRaw === 'string'
        ? headerSecretRaw
        : Array.isArray(headerSecretRaw)
          ? headerSecretRaw[0]
          : undefined;

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const bodySecret = typeof body.webhookSecret === 'string' ? body.webhookSecret : undefined;

    if (webhookSecretConfigured() && !webhookSecretMatches(headerStr, bodySecret)) {
      return res.status(401).json({ error: 'invalid or missing webhook secret' });
    }

    const tenantId = resolveTenantId(req, body);

    const threadId =
      typeof body.threadId === 'string'
        ? body.threadId.trim()
        : typeof body.thread_id === 'string'
          ? body.thread_id.trim()
          : '';
    const text =
      typeof body.text === 'string'
        ? body.text
        : typeof body.content === 'string'
          ? body.content
          : undefined;

    const authorUsername =
      body.author &&
      typeof body.author === 'object' &&
      typeof body.author.username === 'string'
        ? body.author.username
        : typeof body.username === 'string'
          ? body.username
          : 'Unknown';

    const authorAvatar =
      body.author &&
      typeof body.author === 'object' &&
      typeof body.author.avatar === 'string'
        ? body.author.avatar
        : typeof body.avatar === 'string'
          ? body.avatar
          : null;

    if (!threadId || !text || String(text).trim().length === 0) {
      return res.status(400).json({ error: 'threadId and non-empty text (or content) are required' });
    }

    const channelIdRaw =
      typeof body.channelId === 'string'
        ? body.channelId
        : typeof body.channel_id === 'string'
          ? body.channel_id
          : null;

    const threadName =
      typeof body.threadName === 'string'
        ? body.threadName
        : typeof body.thread_name === 'string'
          ? body.thread_name
          : `Thread ${threadId}`;

    const now = new Date().toISOString();
    const existing = persistence.listThreads(tenantId).find((t) => t.id === threadId);

    persistence.upsertThread(tenantId, {
      id: threadId,
      name: threadName,
      channelId: channelIdRaw ?? existing?.channelId ?? null,
      createdAt: existing?.createdAt || now,
    });

    const discordMsgId =
      typeof body.discordMessageId === 'string'
        ? body.discordMessageId
        : typeof body.messageId === 'string'
          ? body.messageId
          : typeof body.discord_message_id === 'string'
            ? body.discord_message_id
            : null;

    const message = {
      id: crypto.randomUUID(),
      threadId,
      text: String(text).trim(),
      source: /** @type {const} */ ('discord'),
      author: {
        username: authorUsername,
        avatar: authorAvatar,
      },
      createdAt: now,
      discordMessageId: discordMsgId,
      channelId: channelIdRaw,
    };

    persistence.appendMessage(tenantId, message);

    if (broadcastEvent) {
      broadcastEvent('discord:message', message);
    }

    res.json({ ok: true, message });
  });

  return router;
};

export { createDiscordSyncRouter, resolveDbPath };
