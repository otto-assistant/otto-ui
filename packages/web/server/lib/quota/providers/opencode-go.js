import { readAuthFile } from '../../opencode/auth.js';
import {
  getAuthEntry,
  normalizeAuthEntry,
  buildResult,
  toUsageWindow,
  toNumber
} from '../utils/index.js';
import { readOpenCodeModelUsage, readOpenCodeWindows } from './opencode-go-usage-db.js';
import { resolveDashboardConfig, resolveAnchorConfig, resolveConfigMode, fetchDashboardUsage, clearDashboardConfig } from './opencode-go-dashboard.js';

export const providerId = 'opencode-go';
export const providerName = 'OpenCode Go';
export const aliases = ['opencode-go', 'opencode', 'opencode-zen'];

const USAGE_ENDPOINT = 'https://opencode.ai/zen/go/v1/usage';

const buildWindow = (key, data) => {
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
  const fiveHour = buildWindow('5h', usageData.rolling);
  if (fiveHour) windows['5h'] = fiveHour;
  const weekly = buildWindow('weekly', usageData.weekly);
  if (weekly) windows['weekly'] = weekly;
  const monthly = buildWindow('monthly', usageData.monthly);
  if (monthly) windows['monthly'] = monthly;
  return windows;
};

/**
 * Build windows from local DB data with anchor-based reset times.
 * Anchors provide the seconds-until-reset from the dashboard, giving
 * accurate billing cycle boundaries.
 */
const buildAnchorWindows = (dbWindows, anchors) => {
  if (!dbWindows?.windows) return null;
  const windows = {};
  const WINDOW_LABELS = { '5h': '5h', weekly: 'weekly', monthly: 'monthly' };

  for (const [key, label] of Object.entries(WINDOW_LABELS)) {
    const dbWindow = dbWindows.windows[key];
    if (!dbWindow) continue;

    const usedPercent = dbWindow.usedPercent;
    const anchorSeconds = anchors[key];
    const resetAt = anchorSeconds != null ? Date.now() + anchorSeconds * 1000 : dbWindow.resetAt;

    let valueLabel = null;
    if (usedPercent !== null) {
      valueLabel = `${Math.round(usedPercent)}%`;
    }

    windows[key] = toUsageWindow({ usedPercent, windowSeconds: null, resetAt, valueLabel });
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
    if (mode === 'cookie' && dashboardConfig) {
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
        // Fill missing windows from local DB
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

      // Dashboard configured but failed
      return buildResult({
        providerId, providerName, ok: false, configured: true,
        usage: models ? withModels({}) : null,
        error: 'Could not fetch usage from the OpenCode Go dashboard.'
      });
    }

    // ── Mode 2: Anchor-based (local DB + reset times from user) ──
    if (mode === 'anchor' && anchorConfig && dbWindows) {
      const windows = buildAnchorWindows(dbWindows, anchorConfig);
      if (windows) {
        return {
          ...buildResult({ providerId, providerName, ok: true, configured: true, usage: withModels(windows) }),
          usageSource: 'anchor'
        };
      }
    }

    // ── Fallback: local DB only (approximate) ──
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
