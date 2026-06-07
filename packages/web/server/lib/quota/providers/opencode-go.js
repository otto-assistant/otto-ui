import { readAuthFile } from '../../opencode/auth.js';
import {
  getAuthEntry,
  normalizeAuthEntry,
  buildResult,
  toUsageWindow,
  toNumber,
  formatMoney
} from '../utils/index.js';

export const providerId = 'opencode-go';
export const providerName = 'OpenCode Go';
export const aliases = ['opencode-go', 'opencode', 'opencode-zen'];

const USAGE_ENDPOINT = 'https://opencode.ai/zen/go/v1/usage';

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

export const isConfigured = () => {
  const auth = readAuthFile();
  const entry = normalizeAuthEntry(getAuthEntry(auth, aliases));
  return Boolean(entry?.key || entry?.token);
};

export const fetchQuota = async () => {
  const auth = readAuthFile();
  const entry = normalizeAuthEntry(getAuthEntry(auth, aliases));
  const apiKey = entry?.key ?? entry?.token;

  if (!apiKey) {
    return buildResult({
      providerId,
      providerName,
      ok: false,
      configured: false,
      error: 'Not configured'
    });
  }

  try {
    const response = await fetch(USAGE_ENDPOINT, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      return buildResult({
        providerId,
        providerName,
        ok: false,
        configured: true,
        error: `API error: ${response.status}`
      });
    }

    const payload = await response.json();
    const windows = {};

    const fiveHour = buildWindow('5h', payload?.rollingUsage);
    if (fiveHour) {
      windows['5h'] = fiveHour;
    }
    const weekly = buildWindow('weekly', payload?.weeklyUsage);
    if (weekly) {
      windows['weekly'] = weekly;
    }
    const monthly = buildWindow('monthly', payload?.monthlyUsage);
    if (monthly) {
      windows['monthly'] = monthly;
    }

    return buildResult({
      providerId,
      providerName,
      ok: true,
      configured: true,
      usage: { windows }
    });
  } catch (error) {
    return buildResult({
      providerId,
      providerName,
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : 'Request failed'
    });
  }
};
