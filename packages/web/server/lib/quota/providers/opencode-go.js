import { readAuthFile } from '../../opencode/auth.js';
import {
  getAuthEntry,
  normalizeAuthEntry,
  buildResult,
  toUsageWindow,
  toNumber
} from '../utils/index.js';
import { readOpenCodeModelUsage, readOpenCodeWindows } from './opencode-go-usage-db.js';
import { resolveDashboardConfig, resolveAnchorConfig, resolveConfigMode, fetchDashboardUsage } from './opencode-go-dashboard.js';

export const providerId = 'opencode-go';
export const providerName = 'OpenCode Go';
export const aliases = ['opencode-go', 'opencode', 'opencode-zen'];

const USAGE_ENDPOINT = 'https://opencode.ai/zen/go/v1/usage';

const buildWindow = (data) => {
  if (!data || typeof data !== 'object') return null;

  const usedPercent = toNumber(data.usagePercent);
  const resetInSeconds = toNumber(data.resetInSec);
  const resetAt = resetInSeconds !== null ? Date.now() + resetInSeconds * 1000 : null;

  let valueLabel = null;
  if (usedPercent !== null) {
    valueLabel = `${Math.round(usedPercent)}%`;
  }

  if (data.status === 'rate-limited') {
    valueLabel = valueLabel ? `${valueLabel} · limit reached` : 'limit reached';
  }

  return toUsageWindow({ usedPercent, windowSeconds: null, resetAt, valueLabel });
};

const resolveApiKey = () => {
  const auth = readAuthFile();
  const entry = normalizeAuthEntry(getAuthEntry(auth, aliases));
  return entry?.key ?? entry?.token ?? null;
};

export const isConfigured = () => {
  if (resolveDashboardConfig()) return true;
  if (resolveAnchorConfig()) return true;
  const auth = readAuthFile();
  const entry = normalizeAuthEntry(getAuthEntry(auth, aliases));
  return !!entry;
};

const fetchOfficialUsage = async (apiKey) => {
  const response = await fetch(USAGE_ENDPOINT, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) return null;
  const payload = await response.json();
  return {
    rolling: payload?.rollingUsage ?? null,
    weekly: payload?.weeklyUsage ?? null,
    monthly: payload?.monthlyUsage ?? null
  };
};

const buildWindows = (usageData) => {
  const windows = {};
  const fiveHour = buildWindow(usageData.rolling);
  if (fiveHour) windows['5h'] = fiveHour;
  const weekly = buildWindow(usageData.weekly);
  if (weekly) windows['weekly'] = weekly;
  const monthly = buildWindow(usageData.monthly);
  if (monthly) windows['monthly'] = monthly;
  return windows;
};

/**
 * Build windows from local DB data with persisted anchor reset times.
 * resetAtConfig stores absolute epoch-ms boundaries captured when the user
 * saved their "Resets in" values.
 */
const buildAnchorWindows = (dbWindows, resetAtConfig) => {
  if (!dbWindows?.windows) return null;
  const windows = {};
  const ANCHOR_TO_WINDOW = { rolling: '5h', weekly: 'weekly', monthly: 'monthly' };

  for (const [anchorKey, windowKey] of Object.entries(ANCHOR_TO_WINDOW)) {
    const dbWindow = dbWindows.windows[windowKey];
    if (!dbWindow) continue;

    const usedPercent = dbWindow.usedPercent;
    const resetAt = resetAtConfig?.[anchorKey] ?? dbWindow.resetAt;

    let valueLabel = null;
    if (usedPercent !== null) {
      valueLabel = `${Math.round(usedPercent)}%`;
    }

    windows[windowKey] = toUsageWindow({ usedPercent, windowSeconds: null, resetAt, valueLabel });
  }
  return Object.keys(windows).length > 0 ? windows : null;
};

export const fetchQuota = async () => {
  const apiKey = resolveApiKey();
  const dashboardConfig = resolveDashboardConfig();
  const anchorConfig = resolveAnchorConfig();
  const mode = resolveConfigMode();
  const dbWindows = await readOpenCodeWindows(aliases).catch(() => null);
  const models = await readOpenCodeModelUsage(aliases);

  const withModels = (windows) => {
    const usage = { windows };
    if (models) usage.models = models;
    return usage;
  };

  // If no data source is available at all, return not-configured.
  if (!apiKey && !dashboardConfig && !anchorConfig && !dbWindows) {
    return buildResult({
      providerId, providerName,
      ok: false, configured: false, error: 'Not configured'
    });
  }

  try {
    // ── Mode 1: Cookie/dashboard (most accurate) ──
    if (mode === 'cookie') {
      if (dashboardConfig) {
        let usageData = null;
        let source = null;
        if (apiKey) {
          usageData = await fetchOfficialUsage(apiKey).catch(() => null);
          if (usageData) source = 'api';
        }
        if (!usageData) {
          usageData = await fetchDashboardUsage(dashboardConfig);
          if (usageData) source = 'dashboard';
        }

        if (usageData) {
          const windows = buildWindows(usageData);
          // Fill missing windows from local DB for windows the dashboard
          // didn't return (e.g. API returns rolling+weekly but not monthly).
          if (dbWindows?.windows) {
            for (const key of ['monthly', 'weekly', '5h']) {
              if (!windows[key] && dbWindows.windows[key]) {
                windows[key] = dbWindows.windows[key];
              }
            }
          }
          return {
            ...buildResult({ providerId, providerName, ok: true, configured: true, usage: withModels(windows) }),
            usageSource: source
          };
        }
      }

      // mode === 'cookie' but no dashboardConfig found (stale/missing creds)
      return buildResult({
        providerId, providerName, ok: false, configured: true,
        usage: models ? withModels({}) : null,
        error: 'Cookie mode configured but no workspace credentials found. Re-enter your Workspace ID and Auth Cookie.'
      });
    }

    // ── Mode 2: Anchor-based (local DB + reset times from user) ──
    if (mode === 'anchor') {
      if (anchorConfig && dbWindows) {
        const windows = buildAnchorWindows(dbWindows, anchorConfig);
        if (windows) {
          return {
            ...buildResult({ providerId, providerName, ok: true, configured: true, usage: withModels(windows) }),
            usageSource: 'anchor'
          };
        }
      }
      // Anchor mode configured but anchor data or local DB missing
      return buildResult({
        providerId, providerName, ok: false, configured: true,
        usage: null,
        error: anchorConfig
          ? 'Could not compute usage windows from local data with the provided reset times.'
          : 'Anchor mode configured but no reset times found. Re-enter your "Resets in" values.'
      });
    }

    // ── API key only (official endpoint when no mode is configured) ──
    if (!mode && apiKey) {
      const usageData = await fetchOfficialUsage(apiKey).catch(() => null);
      if (usageData) {
        const windows = buildWindows(usageData);
        if (dbWindows?.windows) {
          for (const key of ['monthly', 'weekly', '5h']) {
            if (!windows[key] && dbWindows.windows[key]) {
              windows[key] = dbWindows.windows[key];
            }
          }
        }
        return {
          ...buildResult({ providerId, providerName, ok: true, configured: true, usage: withModels(windows) }),
          usageSource: 'api'
        };
      }
    }

    // ── Fallback: local DB only (approximate) — only when no mode configured ──
    if (dbWindows) {
      return {
        ...buildResult({ providerId, providerName, ok: true, configured: true, usage: withModels(dbWindows.windows) }),
        usageSource: 'local'
      };
    }

    return buildResult({
      providerId, providerName, ok: false, configured: false, error: 'Not configured'
    });
  } catch (error) {
    return buildResult({
      providerId, providerName, ok: false, configured: true,
      usage: models ? withModels({}) : null,
      error: error instanceof Error ? error.message : 'Request failed'
    });
  }
};
