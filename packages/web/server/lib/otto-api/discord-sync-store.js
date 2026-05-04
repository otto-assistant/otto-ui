import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Persistent Discord ↔ Web UI sync store (SQLite).
 *
 * Uses `better-sqlite3` in Node production. Falls back to `bun:sqlite` when Bun runs the
 * process without a working native better-sqlite3 build (e.g. Vitest under Bun).
 *
 * Multi-tenant / gateway-safe scope: tenant_id = `guild:${guildId}`.
 */

/**
 * @typedef {Object} DiscordThreadRow
 * @property {string} id
 * @property {string} name
 * @property {string | null} channelId
 * @property {string} createdAt
 * @property {string} [guildId]
 */

/**
 * @typedef {Object} DiscordMessageRow
 * @property {string} id
 * @property {string} threadId
 * @property {string} text
 * @property {'discord' | 'web'} source
 * @property {{ username: string; avatar: string | null }} author
 * @property {string} createdAt
 * @property {string | null} [discordMessageId]
 * @property {string} [guildId]
 */

/**
 * @typedef {{
 *   listThreads: (tenantId: string) => DiscordThreadRow[];
 *   getMessages: (tenantId: string, threadId: string) => DiscordMessageRow[];
 *   upsertThread: (tenantId: string, thread: { id: string; name: string; channelId: string | null; createdAt: string }) => void;
 *   appendMessage: (tenantId: string, message: DiscordMessageRow & { channelId?: string | null }) => void;
 * }} DiscordSyncPersistence
 */

/** @typedef {{ exec: (sql: string) => void; allThreads: (tenantId: string) => Record<string, unknown>[]; allMessages: (tenantId: string, threadId: string) => Record<string, unknown>[]; upsertThread: (args: unknown[]) => void; insertMessage: (args: unknown[]) => void; close: () => void }} SqlBackend */

function tenantFromGuild(guildId) {
  return `guild:${guildId}`;
}

const migrateSql = `
      CREATE TABLE IF NOT EXISTS otto_discord_threads (
        tenant_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        name TEXT NOT NULL,
        channel_id TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, thread_id)
      );
      CREATE TABLE IF NOT EXISTS otto_discord_messages (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        text TEXT NOT NULL,
        source TEXT NOT NULL,
        author_username TEXT NOT NULL,
        author_avatar TEXT,
        discord_message_id TEXT,
        channel_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_otto_discord_messages_tenant_thread
        ON otto_discord_messages (tenant_id, thread_id, created_at);
`;

const sqlThreads = `SELECT thread_id, name, channel_id, created_at FROM otto_discord_threads
         WHERE tenant_id = ? ORDER BY created_at DESC`;

const sqlMessages = `SELECT id, thread_id, text, source, author_username, author_avatar, discord_message_id, channel_id, created_at
         FROM otto_discord_messages
         WHERE tenant_id = ? AND thread_id = ?
         ORDER BY created_at ASC`;

const sqlUpsertThread = `INSERT INTO otto_discord_threads (tenant_id, thread_id, name, channel_id, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, thread_id) DO UPDATE SET
           name = excluded.name,
           channel_id = COALESCE(excluded.channel_id, otto_discord_threads.channel_id)`;

const sqlInsertMessage = `INSERT INTO otto_discord_messages (
           id, tenant_id, thread_id, text, source, author_username, author_avatar,
           discord_message_id, channel_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * @param {string} dbPath
 * @returns {SqlBackend}
 */
function openSqlBackend(dbPath) {
  const req = createRequire(import.meta.url);

  try {
    const BetterSqlite = req('better-sqlite3');
    const db = new BetterSqlite(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(migrateSql);
    return {
      exec(sql) {
        db.exec(sql);
      },
      allThreads(tenantId) {
        return db.prepare(sqlThreads).all(tenantId);
      },
      allMessages(tenantId, threadId) {
        return db.prepare(sqlMessages).all(tenantId, threadId);
      },
      upsertThread(params) {
        db.prepare(sqlUpsertThread).run(...params);
      },
      insertMessage(params) {
        db.prepare(sqlInsertMessage).run(...params);
      },
      close() {
        db.close();
      },
    };
  } catch {
    /** Bun test/runtime path */
  }

  try {
    /** @type {{ Database: new (path: string) => import('bun:sqlite').Database }} */
    const { Database } = req('bun:sqlite');
    const db = new Database(dbPath);
    db.run(migrateSql);
    db.run('PRAGMA journal_mode = WAL;');
    const qThreads = db.query(sqlThreads);
    const qMsgs = db.query(sqlMessages);
    const qUpsert = db.query(sqlUpsertThread);
    const qIns = db.query(sqlInsertMessage);
    return {
      exec(sql) {
        db.run(sql);
      },
      allThreads(tenantId) {
        return /** @type {Record<string, unknown>[]} */ (qThreads.all(tenantId));
      },
      allMessages(tenantId, threadId) {
        return /** @type {Record<string, unknown>[]} */ (qMsgs.all(tenantId, threadId));
      },
      upsertThread(params) {
        qUpsert.run(...params);
      },
      insertMessage(params) {
        qIns.run(...params);
      },
      close() {
        db.close(false);
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Discord sync SQLite: could not open database (${msg})`);
  }
}

export class SqliteDiscordSyncStore {
  /** @param {{ dbPath: string }} opts */
  constructor(opts) {
    const dir = path.dirname(opts.dbPath);
    fs.mkdirSync(dir, { recursive: true });
    this.backend = openSqlBackend(opts.dbPath);
  }

  /**
   * @param {string} tenantId
   * @returns {DiscordThreadRow[]}
   */
  listThreads(tenantId) {
    const rows = this.backend.allThreads(tenantId);
    const guildId = tenantId.startsWith('guild:') ? tenantId.slice('guild:'.length) : '';
    return rows.map((r) => ({
      id: String(r.thread_id),
      name: String(r.name),
      channelId: r.channel_id == null ? null : String(r.channel_id),
      createdAt: String(r.created_at),
      ...(guildId ? { guildId } : {}),
    }));
  }

  /**
   * @param {string} tenantId
   * @param {string} threadId
   * @returns {DiscordMessageRow[]}
   */
  getMessages(tenantId, threadId) {
    const rows = this.backend.allMessages(tenantId, threadId);
    const guildId = tenantId.startsWith('guild:') ? tenantId.slice('guild:'.length) : '';
    return rows.map((r) => ({
      id: String(r.id),
      threadId: String(r.thread_id),
      text: String(r.text),
      source: r.source === 'web' ? 'web' : 'discord',
      author: {
        username: String(r.author_username),
        avatar: r.author_avatar == null ? null : String(r.author_avatar),
      },
      createdAt: String(r.created_at),
      discordMessageId: r.discord_message_id == null ? null : String(r.discord_message_id),
      ...(guildId ? { guildId } : {}),
    }));
  }

  /**
   * @param {string} tenantId
   * @param {{ id: string; name: string; channelId: string | null; createdAt: string }} thread
   */
  upsertThread(tenantId, thread) {
    this.backend.upsertThread([
      tenantId,
      thread.id,
      thread.name,
      thread.channelId,
      thread.createdAt,
    ]);
  }

  /**
   * @param {string} tenantId
   * @param {DiscordMessageRow & { channelId?: string | null }} message
   */
  appendMessage(tenantId, message) {
    this.backend.insertMessage([
      message.id,
      tenantId,
      message.threadId,
      message.text,
      message.source,
      message.author.username,
      message.author.avatar,
      message.discordMessageId ?? null,
      message.channelId ?? null,
      message.createdAt,
    ]);
  }

  close() {
    this.backend.close();
  }
}

export { tenantFromGuild };
