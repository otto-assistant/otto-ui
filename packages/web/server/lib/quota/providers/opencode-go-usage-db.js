import path from 'path';
import os from 'os';
import { createRequire } from 'module';

import { toUsageWindow, toNumber } from '../utils/index.js';

const OPENCODE_DB_PATH = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');

/**
 * Open the OpenCode SQLite database read-only. The web server runs under Bun
 * (which ships `bun:sqlite` and does not support `better-sqlite3`), while the
 * desktop/VS Code hosts run under Node (which uses `better-sqlite3`). Pick the
 * right driver at runtime and expose a tiny `{ all, close }` shim.
 *
 * @returns {Promise<{ all: () => Array<{ data: string }>, close: () => void } | null>}
 */
const openOpenCodeDatabase = async () => {
  if (typeof Bun !== 'undefined') {
    // Variable specifier keeps bundlers from statically resolving the Bun-only module.
    const moduleName = 'bun:sqlite';
    const { Database } = await import(moduleName);
    const db = new Database(OPENCODE_DB_PATH, { readonly: true });
    return {
      all: () => db.query('SELECT data FROM message').all(),
      close: () => db.close()
    };
  }

  const require = createRequire(import.meta.url);
  const Database = require('better-sqlite3');
  const db = new Database(OPENCODE_DB_PATH, { readonly: true, fileMustExist: true });
  return {
    all: () => db.prepare('SELECT data FROM message').all(),
    close: () => db.close()
  };
};

const formatModelSpend = (cost) => {
  const value = toNumber(cost);
  if (value === null || value <= 0) {
    return '0.00';
  }
  if (value < 1) {
    return value.toFixed(4);
  }
  return value.toFixed(2);
};

const formatTokenCount = (tokens) => {
  const value = toNumber(tokens);
  if (value === null || value <= 0) {
    return null;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}K`;
  }
  return `${Math.round(value)}`;
};

/**
 * Aggregate per-model spend from OpenCode assistant messages.
 *
 * @param {Array<Record<string, unknown>>} messages Parsed message `data` objects.
 * @param {string[]} providerAliases Provider IDs that map to OpenCode Go.
 * @returns {Array<{modelID: string, cost: number, requests: number, tokens: number, lastUsed: number}>}
 *   Models ordered by spend (desc), then request count (desc).
 */
export const aggregateModelUsage = (messages, providerAliases) => {
  const aliases = new Set(providerAliases);
  const byModel = new Map();

  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || message.role !== 'assistant') {
      continue;
    }
    if (!aliases.has(message.providerID)) {
      continue;
    }
    const modelID = typeof message.modelID === 'string' ? message.modelID : null;
    if (!modelID) {
      continue;
    }

    const cost = toNumber(message.cost) ?? 0;
    const totalTokens = toNumber(message.tokens?.total) ?? 0;
    const created = toNumber(message.time?.created) ?? 0;

    const existing = byModel.get(modelID) ?? { modelID, cost: 0, requests: 0, tokens: 0, lastUsed: 0 };
    existing.cost += cost;
    existing.requests += 1;
    existing.tokens += totalTokens;
    existing.lastUsed = Math.max(existing.lastUsed, created);
    byModel.set(modelID, existing);
  }

  return [...byModel.values()].sort((a, b) => {
    if (b.cost !== a.cost) {
      return b.cost - a.cost;
    }
    return b.requests - a.requests;
  });
};

/**
 * Convert aggregated per-model usage into the `usage.models` map consumed by the
 * UI (one `spend` window per model, carrying a dollar + request/token label).
 *
 * @param {ReturnType<typeof aggregateModelUsage>} aggregated
 * @returns {Record<string, { windows: Record<string, ReturnType<typeof toUsageWindow>> }>}
 */
export const buildModelUsageWindows = (aggregated) => {
  const models = {};
  for (const entry of aggregated) {
    const parts = [`$${formatModelSpend(entry.cost)}`, `${entry.requests} req`];
    const tokenLabel = formatTokenCount(entry.tokens);
    if (tokenLabel) {
      parts.push(`${tokenLabel} tok`);
    }
    models[entry.modelID] = {
      windows: {
        spend: toUsageWindow({
          usedPercent: null,
          windowSeconds: null,
          resetAt: null,
          valueLabel: parts.join(' · ')
        })
      }
    };
  }
  return models;
};

/**
 * Read per-model OpenCode Go usage from the local OpenCode SQLite database.
 * Display-only enrichment: returns null when the database is unavailable or
 * unreadable so the caller can still report the usage windows.
 *
 * @param {string[]} providerAliases Provider IDs that map to OpenCode Go.
 * @returns {Promise<Record<string, { windows: Record<string, ReturnType<typeof toUsageWindow>> }> | null>}
 */
export const readOpenCodeModelUsage = async (providerAliases) => {
  let db = null;
  try {
    db = await openOpenCodeDatabase();
    if (!db) {
      return null;
    }
    const rows = db.all();
    const messages = [];
    for (const row of rows) {
      try {
        messages.push(JSON.parse(row.data));
      } catch {
        // Skip malformed rows.
      }
    }
    const aggregated = aggregateModelUsage(messages, providerAliases);
    if (aggregated.length === 0) {
      return null;
    }
    return buildModelUsageWindows(aggregated);
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // Ignore close errors.
    }
  }
};
