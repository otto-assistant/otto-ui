import path from 'path';
import os from 'os';
import { createRequire } from 'module';

import { toUsageWindow, toNumber } from '../utils/index.js';

const OPENCODE_DB_PATH = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');

/**
 * Documented OpenCode Go usage limits in USD. Source: https://opencode.ai/docs/zen
 * - 5-hour: rolling window (spend ages out 5h after it happened).
 * - weekly: calendar week, resets Monday 00:00 UTC.
 * - monthly: subscription-anchored cycle, resets on the day-of-month the
 *   subscription started (detected from cost data).
 */
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
 *
 * @param {number} now Current time in ms.
 * @returns {{ start: number, end: number }}
 */
const utcWeekBounds = (now) => {
  const d = new Date(now);
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysSinceMonday);
  return { start, end: start + 7 * DAY_MS };
};

/**
 * Detect the subscription anchor timestamp by scanning cost-bearing messages
 * from earliest to latest. When cumulative spend passes the monthly limit we
 * assume a billing-cycle rollover; the timestamp of the message that pushes
 * over the limit becomes the anchor for the new period.
 *
 * If no rollover is found (spend never exceeds the limit), the anchor defaults
 * to the earliest message timestamp in the database or, if none exist, `null`.
 *
 * @param {Array<{ created: number, cost: number }>} sortedCosts
 *   Messages with cost > 0, sorted by `created` ascending.
 * @param {number} monthlyLimitUsd
 * @returns {number | null} Timestamp (ms) of the last detected rollover, or
 *   the earliest message if no rollover, or `null` if no data.
 */
export const detectMonthlyAnchor = (sortedCosts, monthlyLimitUsd) => {
  if (!Array.isArray(sortedCosts) || sortedCosts.length === 0) {
    return null;
  }

  let cumulative = 0;
  let anchor = sortedCosts[0].created;

  for (const entry of sortedCosts) {
    cumulative += entry.cost;
    if (cumulative > monthlyLimitUsd) {
      // Billing-cycle rollover detected — the new period starts at the
      // message that pushed us over the limit.
      anchor = entry.created;
      cumulative = entry.cost; // Start counting fresh for the new period.
    }
  }

  return anchor;
};

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
 * Aggregate OpenCode Go spend into the three usage windows, matching how
 * OpenCode anchors each one:
 * - `5h`: rolling window — spend in the trailing 5 hours; reset is when the
 *   oldest contributing spend ages out (oldest + 5h).
 * - `weekly`: calendar week since Monday 00:00 UTC; reset is next Monday 00:00 UTC.
 * - `monthly`: subscription-anchored cycle; the period start is detected from
 *   the cost data via {@link detectMonthlyAnchor}.
 *
 * @param {Array<Record<string, unknown>>} messages Parsed message `data` objects.
 * @param {string[]} providerAliases Provider IDs that map to OpenCode Go.
 * @param {number} [now] Current time in ms (injectable for tests).
 * @returns {Record<'5h'|'weekly'|'monthly', { spend: number, resetAt: number | null, windowSeconds: number }>}
 */
export const aggregateWindowSpend = (messages, providerAliases, now = Date.now()) => {
  const aliases = new Set(providerAliases);
  const week = utcWeekBounds(now);
  const rollingCutoff = now - ROLLING_5H_SECONDS * 1000;

  // Collect cost-bearing entries for monthly-anchor detection.
  const costEntries = [];
  let rollingOldest = null;
  let weeklySpend = 0;
  let monthlySpend = 0;
  let rollingSpend = 0;

  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || message.role !== 'assistant') {
      continue;
    }
    if (!aliases.has(message.providerID)) {
      continue;
    }
    const created = toNumber(message.time?.created);
    if (created === null) {
      continue;
    }
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

  // Detect monthly anchor from cost entries (sorted ascending).
  costEntries.sort((a, b) => a.created - b.created);
  const monthlyAnchor = detectMonthlyAnchor(costEntries, WINDOW_LIMITS_USD.monthly);

  // Compute monthly spend from the detected anchor.
  if (monthlyAnchor !== null) {
    for (const entry of costEntries) {
      if (entry.created >= monthlyAnchor) {
        monthlySpend += entry.cost;
      }
    }
  }

  const windows = {
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
      resetAt: monthlyAnchor === null
        ? null
        : new Date(
            Date.UTC(
              new Date(now).getUTCFullYear(),
              new Date(now).getUTCMonth() + 1,
              new Date(monthlyAnchor).getUTCDate()
            )
          ).getTime(),
      windowSeconds: Math.round(
        (new Date(
          Date.UTC(
            new Date(now).getUTCFullYear(),
            new Date(now).getUTCMonth() + 1,
            new Date(monthlyAnchor).getUTCDate()
          )
        ).getTime() -
          new Date(
            Date.UTC(
              new Date(now).getUTCFullYear(),
              new Date(now).getUTCMonth(),
              new Date(monthlyAnchor).getUTCDate()
            )
          ).getTime()) / 1000
      )
    }
  };

  return windows;
};

/**
 * Convert windowed spend into the `usage.windows` map consumed by the UI. Each
 * window carries the spent/limit dollar label plus a usage percentage that
 * drives the progress bar fill and tone color. The reset timestamp comes from
 * the window itself (rolling age-out for 5h, Monday boundary for weekly,
 * subscription-anchor for monthly).
 *
 * @param {ReturnType<typeof aggregateWindowSpend>} windowSpend
 * @returns {Record<string, ReturnType<typeof toUsageWindow>>}
 */
export const buildLimitWindows = (windowSpend) => {
  const windows = {};
  for (const key of WINDOW_ORDER) {
    const bucket = windowSpend?.[key];
    if (!bucket) {
      continue;
    }
    const limitUsd = WINDOW_LIMITS_USD[key];
    const spend = toNumber(bucket.spend) ?? 0;
    const usedPercent = limitUsd > 0 ? (spend / limitUsd) * 100 : null;

    windows[key] = toUsageWindow({
      usedPercent,
      windowSeconds: bucket.windowSeconds ?? null,
      resetAt: bucket.resetAt ?? null,
      valueLabel: `$${spend.toFixed(2)} / $${limitUsd.toFixed(2)}`
    });
  }
  return windows;
};

/**
 * Read all messages from the local OpenCode SQLite database and parse the JSON
 * `data` column. Returns `null` when the database is unavailable.
 *
 * @returns {Promise<Array<Record<string, unknown>> | null>}
 */
const readOpenCodeMessages = async () => {
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
    return messages;
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

/**
 * Read OpenCode Go usage windows and per-model spend from the local database.
 * Returns `{ windows, models }` or `null` when the DB cannot be read.
 *
 * @param {string[]} providerAliases
 * @returns {Promise<{ windows: Record<string, ReturnType<typeof toUsageWindow>>, models: Record<string, { windows: Record<string, ReturnType<typeof toUsageWindow>> }> } | null>}
 */
export const readOpenCodeUsage = async (providerAliases) => {
  const messages = await readOpenCodeMessages();
  if (!messages) {
    return null;
  }

  const windowSpend = aggregateWindowSpend(messages, providerAliases);
  const windows = buildLimitWindows(windowSpend);

  const aggregated = aggregateModelUsage(messages, providerAliases);
  const models = aggregated.length > 0 ? buildModelUsageWindows(aggregated) : {};

  return { windows, models };
};
