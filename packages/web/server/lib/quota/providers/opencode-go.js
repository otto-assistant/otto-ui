import { readAuthFile } from '../../opencode/auth.js';
import {
  getAuthEntry,
  normalizeAuthEntry,
  buildResult,
  toUsageWindow,
  toNumber,
  formatMoney
} from '../utils/index.js';
import { readOpenCodeModelUsage, readOpenCodeWindows } from './opencode-go-usage-db.js';
import { resolveDashboardConfig, fetchDashboardUsage } from './opencode-go-dashboard.js';

export const providerId = 'opencode-go';
export const providerName = 'OpenCode Go';
export const aliases = ['opencode-go', 'opencode', 'opencode-zen'];

const USAGE_ENDPOINT = 'https://opencode.ai/zen/go/v1/usage';

const NEEDS_DASHBOARD_MESSAGE =
  'OpenCode Go has no usage API yet, so usage windows are read from the console dashboard. Set OPENCODE_GO_WORKSPACE_ID and OPENCODE_GO_AUTH_COOKIE (or create ~/.config/opencode/opencode-go.json with workspaceId and authCookie). The auth cookie comes from opencode.ai DevTools → Application → Cookies.';

/**
 * Documented OpenCode Go usage limits in USD, used to surface the dollar value
 * of each window alongside the percentage the usage API returns — mirroring the
 * console dashboard. The percentages from the API stay authoritative for the
 * progress bars; the dollar labels are derived from these limits for context.
 * Source: https://opencode.ai/docs/go/#usage-limits
 */
const WINDOW_LIMITS_USD = {
  '5h': 12,
  weekly: 30,
  monthly: 60
};

const buildWindow = (key, data) => {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const usedPercent = toNumber(data.usagePercent);
  const resetInSeconds = toNumber(data.resetInSec);
  const resetAt = resetInSeconds !== null ? Date.now() + resetInSeconds * 1000 : null;

  const limitUsd = WINDOW_LIMITS_USD[key] ?? null;
  let valueLabel = null;
  if (limitUsd !== null && usedPercent !== null) {
    const spent = formatMoney((usedPercent / 100) * limitUsd);
    const limit = formatMoney(limitUsd);
    if (spent !== null && limit !== null) {
      valueLabel = `$${spent} / $${limit}`;
    }
  }

  if (data.status === 'rate-limited') {
    valueLabel = valueLabel ? `${valueLabel} · limit reached` : 'limit reached';
  }

  return toUsageWindow({
    usedPercent,
    windowSeconds: null,
    resetAt,
    valueLabel
  });
};

const resolveApiKey = () => {
  const auth = readAuthFile();
  const entry = normalizeAuthEntry(getAuthEntry(auth, aliases));
  return entry?.key ?? entry?.token ?? null;
};

export const isConfigured = () => {
  if (resolveDashboardConfig()) {
    return true;
  }
  // OpenCode Go is the runtime that manages all providers. If any provider
  // has auth configured, OpenCode Go itself is active and can report usage
  // from the local database.
  const auth = readAuthFile();
  return Object.keys(auth).length > 0;
};

/**
 * Try the official usage endpoint. It does not exist yet (opencode#16513 is
 * unmerged and returns 404), but querying it first means this provider starts
 * working automatically once OpenCode ships the API. Returns null on any
 * non-success so the caller can fall back to dashboard scraping.
 */
const fetchOfficialUsage = async (apiKey) => {
  const response = await fetch(USAGE_ENDPOINT, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) {
    return null;
  }
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
  if (fiveHour) {
    windows['5h'] = fiveHour;
  }
  const weekly = buildWindow('weekly', usageData.weekly);
  if (weekly) {
    windows['weekly'] = weekly;
  }
  const monthly = buildWindow('monthly', usageData.monthly);
  if (monthly) {
    windows['monthly'] = monthly;
  }
  return windows;
};

export const fetchQuota = async () => {
  const apiKey = resolveApiKey();
  const dashboardConfig = resolveDashboardConfig();

  if (!apiKey && !dashboardConfig) {
    return buildResult({
      providerId,
      providerName,
      ok: false,
      configured: false,
      error: 'Not configured'
    });
  }

  // Per-model spend is read from the local OpenCode DB and is independent of
  // the windows source, so surface it even when windows are unavailable.
  const models = await readOpenCodeModelUsage(aliases);
  const withModels = (windows) => {
    const usage = { windows };
    if (models) {
      usage.models = models;
    }
    return usage;
  };

  try {
    let usageData = null;
    if (apiKey) {
      usageData = await fetchOfficialUsage(apiKey).catch(() => null);
    }
    if (!usageData && dashboardConfig) {
      usageData = await fetchDashboardUsage(dashboardConfig);
    }

    if (!usageData) {
      // Fall back to local DB-computed windows. The DB only knows about
      // messages sent from this machine, so spend may undercount — but it's
      // better than showing nothing. The dashboard setup message is included
      // as a hint so the user knows they can get authoritative data.
      const dbWindows = await readOpenCodeWindows(aliases).catch(() => null);
      if (dbWindows) {
        return buildResult({
          providerId,
          providerName,
          ok: true,
          configured: true,
          usage: withModels(dbWindows.windows)
        });
      }
      // No data source available at all — help the user set one up.
      return buildResult({
        providerId,
        providerName,
        ok: false,
        configured: true,
        usage: models ? withModels({}) : null,
        error: NEEDS_DASHBOARD_MESSAGE
      });
    }

    return buildResult({
      providerId,
      providerName,
      ok: true,
      configured: true,
      usage: withModels(buildWindows(usageData))
    });
  } catch (error) {
    return buildResult({
      providerId,
      providerName,
      ok: false,
      configured: true,
      usage: models ? withModels({}) : null,
      error: error instanceof Error ? error.message : 'Request failed'
    });
  }
};
