import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createDiscordSyncRouter } from './discord-sync.js';

/**
 * @typedef {import('./discord-sync-store.js').DiscordSyncPersistence} DiscordSyncPersistence
 */

/** @implements {DiscordSyncPersistence} */
class InMemoryDiscordPersistence {
  constructor() {
    /** @type {Map<string, import('./discord-sync-store.js').DiscordThreadRow[]>} */
    this.threadRows = new Map();
    /** @type {Map<string, import('./discord-sync-store.js').DiscordMessageRow[]>} */
    this.messageRows = new Map();
  }

  keyMsgs(tenantId, threadId) {
    return `${tenantId}:${threadId}`;
  }

  listThreads(tenantId) {
    return this.threadRows.get(tenantId) ?? [];
  }

  getMessages(tenantId, threadId) {
    return this.messageRows.get(this.keyMsgs(tenantId, threadId)) ?? [];
  }

  upsertThread(tenantId, thread) {
    const prev = this.listThreads(tenantId);
    const merged = [...prev.filter((t) => t.id !== thread.id), { ...thread }];
    this.threadRows.set(tenantId, merged);
  }

  appendMessage(tenantId, message) {
    const k = this.keyMsgs(tenantId, message.threadId);
    const list = this.messageRows.get(k) ?? [];
    this.messageRows.set(k, [...list, message]);
  }
}

describe('discord-sync HTTP', () => {
  let persistence;
  let broadcastMock;

  beforeEach(() => {
    persistence = new InMemoryDiscordPersistence();
    broadcastMock = vi.fn();
  });

  afterEach(() => {
    delete process.env.OTTO_DISCORD_WEBHOOK_SECRET;
    vi.restoreAllMocks();
  });

  it('POST /send persists and echoes message for tenant _unscoped', async () => {
    const app = express();
    app.use('/', createDiscordSyncRouter({ persistence, broadcastEvent: broadcastMock }));

    const res = await request(app)
      .post('/send')
      .send({ threadId: 'th1', text: 'hello ui' })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.message.threadId).toBe('th1');
    expect(res.body.message.source).toBe('web');
    expect(typeof res.body.message.id).toBe('string');
    expect(broadcastMock).toHaveBeenCalledWith('discord:message', expect.objectContaining({ text: 'hello ui' }));

    const listRes = await request(app).get('/threads').expect(200);
    expect(listRes.body.tenantId).toBe('_unscoped');
    expect(listRes.body.threads.some((t) => t.id === 'th1')).toBe(true);
  });

  it('guild-scopes threads via query guildId (separate from _unscoped)', async () => {
    const app = express();
    app.use('/', createDiscordSyncRouter({ persistence }));

    await request(app)
      .post('/send?guildId=111')
      .send({ threadId: 'th2', text: 'a' })
      .expect(200);

    await request(app).post('/send').send({ threadId: 'th2', text: 'b' }).expect(200);

    const g = await request(app).get('/threads?guildId=111').expect(200);
    expect(g.body.threads.some((t) => t.id === 'th2')).toBe(true);
    expect(g.body.threads.length).toBe(1);

    const u = await request(app).get('/threads').expect(200);
    expect(u.body.tenantId).toBe('_unscoped');
    expect(u.body.threads.some((t) => t.id === 'th2')).toBe(true);
  });

  it('POST /webhook requires secret when OTTO_DISCORD_WEBHOOK_SECRET is set', async () => {
    process.env.OTTO_DISCORD_WEBHOOK_SECRET = crypto.randomBytes(24).toString('hex');

    const app = express();
    app.use('/', createDiscordSyncRouter({ persistence }));

    await request(app)
      .post('/webhook')
      .send({ threadId: 'w1', text: 'relay' })
      .expect(401);

    await request(app)
      .post('/webhook')
      .set(
        'x-otto-discord-webhook-secret',
        /** @type {string} */ (process.env.OTTO_DISCORD_WEBHOOK_SECRET),
      )
      .send({ threadId: 'w1', text: 'relay', guildId: '777' })
      .expect(200);

    const g = await request(app).get('/threads?guildId=777').expect(200);
    expect(g.body.threads.some((t) => t.id === 'w1')).toBe(true);
  });

  it('SQLite store roundtrip when db path passed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'otto-disc-sync-'));
    const dbPath = path.join(dir, 'test.sqlite');

    const appFirst = express();
    appFirst.use('/', createDiscordSyncRouter({ broadcastEvent: () => {}, dbPath }));

    await request(appFirst).post('/send').send({ threadId: 'persist1', text: 'one' }).expect(200);

    const appSecond = express();
    appSecond.use('/', createDiscordSyncRouter({ broadcastEvent: () => {}, dbPath }));

    const r = await request(appSecond).get('/threads').expect(200);
    expect(r.body.threads.some((t) => t.id === 'persist1')).toBe(true);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
