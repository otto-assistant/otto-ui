import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Database } from 'bun:sqlite';

/**
 * SQLite-backed mapping between a messenger conversation surface
 * (Discord channel + optional thread, Telegram chat + optional topic)
 * and the OpenCode session id that owns the conversation on that surface.
 *
 * This is what turns Discord and Telegram into real OpenChamber chat
 * interfaces: when a message arrives we look up (or create) a session
 * scoped to the project's working directory, forward the text as a
 * prompt, and route OpenCode's streaming response back to the same
 * messenger thread.
 *
 * Schema:
 *   messenger_session_bindings(
 *     id INTEGER PRIMARY KEY,
 *     type TEXT,         -- 'telegram' | 'discord'
 *     target_key TEXT,   -- "channelId" or "channelId:threadId"
 *     session_id TEXT,
 *     project_path TEXT,
 *     project_label TEXT,
 *     bot_token_hash TEXT, -- so multiple bot tokens don't collide
 *     created_at TEXT,
 *     last_used_at TEXT,
 *     UNIQUE (type, bot_token_hash, target_key)
 *   )
 */

function resolveDefaultDbPath() {
  const root =
    typeof process.env.OPENCHAMBER_DATA_DIR === 'string' &&
    process.env.OPENCHAMBER_DATA_DIR.trim().length > 0
      ? path.resolve(process.env.OPENCHAMBER_DATA_DIR.trim())
      : path.join(os.homedir(), '.openchamber');
  fs.mkdirSync(root, { recursive: true });
  return path.join(root, 'messenger-bridge.sqlite');
}

export class MessengerBridgeStore {
  constructor({ dbPath } = {}) {
    const resolved = dbPath ? path.resolve(dbPath) : resolveDefaultDbPath();
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    this.db = new Database(resolved);
    this.db.run('PRAGMA journal_mode = WAL;');
    this.db.run('PRAGMA synchronous = NORMAL;');
    this.db.run(`
      CREATE TABLE IF NOT EXISTS messenger_session_bindings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        target_key TEXT NOT NULL,
        session_id TEXT NOT NULL,
        project_path TEXT,
        project_label TEXT,
        bot_token_hash TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        last_used_at TEXT NOT NULL,
        UNIQUE (type, bot_token_hash, target_key)
      );
      CREATE INDEX IF NOT EXISTS idx_messenger_session_session
        ON messenger_session_bindings (session_id);
    `);
  }

  /**
   * @param {string} type 'telegram' | 'discord'
   * @param {string} botTokenHash short stable hash of the bot token (so identical chatIds
   *                  under different bot accounts don't collide).
   * @param {string} targetKey 'channelId' or 'channelId:threadId'
   */
  lookup({ type, botTokenHash, targetKey }) {
    const row = this.db
      .prepare(
        `SELECT session_id AS sessionId, project_path AS projectPath,
                project_label AS projectLabel, created_at AS createdAt,
                last_used_at AS lastUsedAt
           FROM messenger_session_bindings
          WHERE type = ? AND bot_token_hash = ? AND target_key = ?`,
      )
      .get(type, botTokenHash, targetKey);
    return row ?? null;
  }

  bind({ type, botTokenHash, targetKey, sessionId, projectPath, projectLabel }) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO messenger_session_bindings
           (type, target_key, session_id, project_path, project_label, bot_token_hash, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(type, bot_token_hash, target_key)
         DO UPDATE SET session_id = excluded.session_id,
                       project_path = excluded.project_path,
                       project_label = excluded.project_label,
                       last_used_at = excluded.last_used_at`,
      )
      .run(
        type,
        targetKey,
        sessionId,
        projectPath ?? null,
        projectLabel ?? null,
        botTokenHash,
        now,
        now,
      );
  }

  touch({ type, botTokenHash, targetKey }) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE messenger_session_bindings
            SET last_used_at = ?
          WHERE type = ? AND bot_token_hash = ? AND target_key = ?`,
      )
      .run(now, type, botTokenHash, targetKey);
  }

  /**
   * Lookup every messenger target bound to a given OpenCode session, so the
   * outbound fan-out can mirror assistant deltas to all of them (e.g. one
   * channel + one DM both subscribed to the same session).
   */
  lookupBySessionId(sessionId) {
    return this.db
      .prepare(
        `SELECT type, target_key AS targetKey, project_path AS projectPath,
                project_label AS projectLabel
           FROM messenger_session_bindings
          WHERE session_id = ?`,
      )
      .all(sessionId);
  }

  list({ type, botTokenHash } = {}) {
    let sql = `SELECT type, target_key AS targetKey, session_id AS sessionId,
                      project_path AS projectPath, project_label AS projectLabel,
                      created_at AS createdAt, last_used_at AS lastUsedAt
                 FROM messenger_session_bindings`;
    const params = [];
    const where = [];
    if (type) {
      where.push('type = ?');
      params.push(type);
    }
    if (botTokenHash !== undefined) {
      where.push('bot_token_hash = ?');
      params.push(botTokenHash);
    }
    if (where.length > 0) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY last_used_at DESC';
    return this.db.prepare(sql).all(...params);
  }

  unbind({ type, botTokenHash, targetKey }) {
    this.db
      .prepare(
        `DELETE FROM messenger_session_bindings
          WHERE type = ? AND bot_token_hash = ? AND target_key = ?`,
      )
      .run(type, botTokenHash, targetKey);
  }
}
