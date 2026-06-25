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

// ── Window computation helpers (used as local DB fallback) ──

export const WINDOW_LIMITS_USD = {
  '5h': 12,
  weekly: 30,
  monthly: 60
};

const WINDOW_ORDER = ['5h', 'weekly', 'monthly'];
const ROLLING_5H_SECONDS = 5 * 3600;
const DAY_MS = 86400000;

/**
 * Calendar-week bounds anchored to Monday 00:00 UTC (matches OpenCode's weekly
 * reset, e.g. "resets in 6 days 17 hours" on a Monday morning).
 */
const utcWeekBounds = (now) => {
  const d = new Date(now);
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysSinceMonday);
  return { start, end: start + 7 * DAY_MS };
};

/**
 * Next monthly reset on the anchor day-of-month at 00:00 UTC.
 * Uses this month when the day is still ahead; otherwise next month.
 */
export const computeNextMonthlyResetAt = (anchorTimestamp, now = Date.now()) => {
  const anchorDate = new Date(anchorTimestamp);
  const day = anchorDate.getUTCDate();
  const nowDate = new Date(now);
  let year = nowDate.getUTCFullYear();
  let month = nowDate.getUTCMonth();
  let resetAt = Date.UTC(year, month, day);
  if (resetAt <= now) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
    resetAt = Date.UTC(year, month, day);
  }
  return resetAt;
};

/** Start of the current monthly billing period ending at resetAt. */
export const computeMonthlyPeriodStart = (resetAt, anchorTimestamp) => {
  const day = new Date(anchorTimestamp).getUTCDate();
  const resetDate = new Date(resetAt);
  let year = resetDate.getUTCFullYear();
  let month = resetDate.getUTCMonth() - 1;
  if (month < 0) {
    month = 11;
    year -= 1;
  }
  return Date.UTC(year, month, day);
};

/**
 * Detect the subscription anchor timestamp by scanning cost-bearing messages
 * from earliest to latest. When cumulative spend passes the monthly limit we
 * assume a billing-cycle rollover; the timestamp of the message that pushes
 * over the limit becomes the anchor for the new period.
 */
const detectMonthlyAnchor = (sortedCosts, monthlyLimitUsd) => {
  if (!Array.isArray(sortedCosts) || sortedCosts.length === 0) {
    return null;
  }
  let cumulative = 0;
  let anchor = sortedCosts[0].created;
  for (const entry of sortedCosts) {
    cumulative += entry.cost;
    if (cumulative > monthlyLimitUsd) {
      anchor = entry.created;
      cumulative = entry.cost;
    }
  }
  return anchor;
};

/**
 * Aggregate OpenCode Go spend into the three usage windows from local DB data.
 *
 * Note: this only counts messages on the local machine, so the numbers will be
 * lower than account-wide usage. Treat as an approximation.
 */
const aggregateWindowSpend = (messages, providerAliases, now = Date.now()) => {
  const aliases = new Set(providerAliases);
  const week = utcWeekBounds(now);
  const rollingCutoff = now - ROLLING_5H_SECONDS * 1000;

  const costEntries = [];
  let rollingOldest = null;
  let weeklySpend = 0;
  let monthlySpend = 0;
  let rollingSpend = 0;

  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || message.role !== 'assistant') continue;
    if (!aliases.has(message.providerID)) continue;
    const created = toNumber(message.time?.created);
    if (created === null) continue;
    const cost = toNumber(message.cost) ?? 0;

    if (cost > 0) {
      costEntries.push({ created, cost });
    }
    if (created >= rollingCutoff) {
      rollingSpend += cost;
      rollingOldest = rollingOldest === null ? created : Math.min(rollingOldest, created);
    }
    if (created >= week.start) {
      weeklySpend += cost;
    }
  }

  costEntries.sort((a, b) => a.created - b.created);
  const monthlyAnchor = detectMonthlyAnchor(costEntries, WINDOW_LIMITS_USD.monthly);

  if (monthlyAnchor !== null) {
    monthlySpend = 0;
    for (const entry of costEntries) {
      if (entry.created >= monthlyAnchor) {
        monthlySpend += entry.cost;
      }
    }
  }

  const monthlyResetAt = monthlyAnchor === null ? null : computeNextMonthlyResetAt(monthlyAnchor, now);
  const monthlyPeriodStart = monthlyResetAt === null
    ? null
    : computeMonthlyPeriodStart(monthlyResetAt, monthlyAnchor);

  return {
    '5h': {
      spend: rollingSpend,
      resetAt: rollingOldest === null ? null : rollingOldest + ROLLING_5H_SECONDS * 1000,
      windowSeconds: ROLLING_5H_SECONDS
    },
    weekly: {
      spend: weeklySpend,
      resetAt: week.end,
      windowSeconds: Math.round((week.end - week.start) / 1000)
    },
    monthly: {
      spend: monthlySpend,
      resetAt: monthlyResetAt,
      windowSeconds: monthlyResetAt === null || monthlyPeriodStart === null
        ? null
        : Math.round((monthlyResetAt - monthlyPeriodStart) / 1000)
    }
  };
};

/**
 * Build `usage.windows` from DB-derived windowed spend. Each window shows
 * percentage as the primary label (matching OpenCode Go dashboard style).
 */
const buildLimitWindows = (windowSpend) => {
  const windows = {};
  for (const key of WINDOW_ORDER) {
    const bucket = windowSpend?.[key];
    if (!bucket) continue;
    const limitUsd = WINDOW_LIMITS_USD[key];
    const spend = toNumber(bucket.spend) ?? 0;
    const usedPercent = limitUsd > 0 ? (spend / limitUsd) * 100 : null;
    let valueLabel = null;
    if (usedPercent !== null) {
      valueLabel = `${Math.round(usedPercent)}%`;
    }
    windows[key] = toUsageWindow({
      usedPercent,
      windowSeconds: bucket.windowSeconds ?? null,
      resetAt: bucket.resetAt ?? null,
      valueLabel
    });
  }
  return windows;
};

const readMessages = async () => {
  let db = null;
  try {
    db = await openOpenCodeDatabase();
    if (!db) return null;
    const rows = db.all();
    const messages = [];
    for (const row of rows) {
      try { messages.push(JSON.parse(row.data)); } catch { /* skip */ }
    }
    return messages;
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
};

/**
 * Read usage windows derived from the local OpenCode SQLite database.
 * Returns `{ windows }` or null when the DB is unavailable.
 *
 * IMPORTANT: local DB only knows about messages sent from this machine, so
 * the spend/percentages may undercount account-wide usage.
 */
export const readOpenCodeWindows = async (providerAliases) => {
  const messages = await readMessages();
  if (!messages) return null;
  const windowSpend = aggregateWindowSpend(messages, providerAliases);
  const windows = buildLimitWindows(windowSpend);
  return Object.keys(windows).length > 0 ? { windows } : null;
};

/**
 * Read per-model OpenCode Go usage from the local OpenCode SQLite database.
 *
 * Display-only enrichment for the usage windows: the OpenCode Go API/dashboard
 * does not expose per-model spend, so this is sourced locally. Returns null
 * when the database is unavailable or unreadable so the caller can still report
 * the usage windows without per-model rows.
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
