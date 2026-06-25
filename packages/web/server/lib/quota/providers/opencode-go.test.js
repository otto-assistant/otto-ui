import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../opencode/auth.js', () => ({
  readAuthFile: vi.fn()
}));

vi.mock('./opencode-go-dashboard.js', () => ({
  resolveDashboardConfig: vi.fn(),
  resolveAnchorConfig: vi.fn(),
  resolveConfigMode: vi.fn(),
  fetchDashboardUsage: vi.fn(),
  clearDashboardConfig: vi.fn()
}));

vi.mock('./opencode-go-usage-db.js', () => ({
  readOpenCodeModelUsage: vi.fn().mockResolvedValue(null),
  readOpenCodeWindows: vi.fn().mockResolvedValue(null)
}));

import { readAuthFile } from '../../opencode/auth.js';
import { resolveDashboardConfig, resolveAnchorConfig, resolveConfigMode, fetchDashboardUsage } from './opencode-go-dashboard.js';
import { readOpenCodeWindows, readOpenCodeModelUsage } from './opencode-go-usage-db.js';
import { fetchQuota, isConfigured, providerId, providerName } from './opencode-go.js';

const originalFetch = globalThis.fetch;

describe('opencode-go quota provider', () => {
  beforeEach(() => {
    vi.mocked(readAuthFile).mockReset();
    vi.mocked(resolveDashboardConfig).mockReturnValue(null);
    vi.mocked(resolveAnchorConfig).mockReturnValue(null);
    vi.mocked(resolveConfigMode).mockReturnValue(null);
    vi.mocked(fetchDashboardUsage).mockReset();
    vi.mocked(readOpenCodeWindows).mockResolvedValue(null);
    vi.mocked(readOpenCodeModelUsage).mockResolvedValue(null);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.OPENCODE_GO_WORKSPACE_ID;
    delete process.env.OPENCODE_GO_AUTH_COOKIE;
    delete process.env.OPENCODE_GO_QUOTA_CONFIG;
    vi.restoreAllMocks();
  });

  it('reports not configured when no auth entry exists', () => {
    vi.mocked(readAuthFile).mockReturnValue({});
    expect(isConfigured()).toBe(false);
  });

  it('detects configuration from the opencode-go api key', () => {
    vi.mocked(readAuthFile).mockReturnValue({ 'opencode-go': { type: 'api', key: 'sk-test' } });
    expect(isConfigured()).toBe(true);
  });

  it('detects configuration from the opencode alias', () => {
    vi.mocked(readAuthFile).mockReturnValue({ opencode: { token: 'sk-alias' } });
    expect(isConfigured()).toBe(true);
  });

  it('returns not-configured when no data source is available', async () => {
    vi.mocked(readAuthFile).mockReturnValue({});
    globalThis.fetch = vi.fn();

    const result = await fetchQuota();

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.providerId).toBe(providerId);
    expect(result.providerName).toBe(providerName);
    expect(result.ok).toBe(false);
    expect(result.configured).toBe(false);
    expect(result.error).toBe('Not configured');
  });

  it('transforms the official endpoint usage into windows with percentage labels', async () => {
    vi.mocked(readAuthFile).mockReturnValue({ 'opencode-go': { key: 'sk-test' } });
    vi.mocked(resolveDashboardConfig).mockReturnValue({ workspaceId: 'wrk_test', authCookie: 'cookie', source: 'env' });
    vi.mocked(resolveConfigMode).mockReturnValue('cookie');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        useBalance: false,
        rollingUsage: { status: 'ok', resetInSec: 2520, usagePercent: 65 },
        weeklyUsage: { status: 'ok', resetInSec: 259200, usagePercent: 30 },
        monthlyUsage: { status: 'ok', resetInSec: 1728000, usagePercent: 12 }
      })
    });

    const result = await fetchQuota();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://opencode.ai/zen/go/v1/usage',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' })
      })
    );
    expect(result.ok).toBe(true);
    expect(result.configured).toBe(true);
    expect(result.usageSource).toBe('api');

    const windows = result.usage.windows;
    expect(Object.keys(windows)).toEqual(['5h', 'weekly', 'monthly']);

    expect(windows['5h'].usedPercent).toBe(65);
    expect(windows['5h'].remainingPercent).toBe(35);
    expect(windows['5h'].valueLabel).toBe('65%');
    expect(windows['5h'].resetAfterSeconds).toBeGreaterThan(0);

    expect(windows.weekly.usedPercent).toBe(30);
    expect(windows.weekly.valueLabel).toBe('30%');

    expect(windows.monthly.usedPercent).toBe(12);
    expect(windows.monthly.valueLabel).toBe('12%');
  });

  it('flags rate-limited windows in the value label', async () => {
    vi.mocked(readAuthFile).mockReturnValue({ 'opencode-go': { key: 'sk-test' } });
    vi.mocked(resolveDashboardConfig).mockReturnValue({ workspaceId: 'wrk_test', authCookie: 'cookie', source: 'env' });
    vi.mocked(resolveConfigMode).mockReturnValue('cookie');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        rollingUsage: { status: 'rate-limited', resetInSec: 600, usagePercent: 100 }
      })
    });

    const result = await fetchQuota();

    expect(result.ok).toBe(true);
    expect(result.usageSource).toBe('api');
    expect(Object.keys(result.usage.windows)).toEqual(['5h']);
    expect(result.usage.windows['5h'].usedPercent).toBe(100);
    expect(result.usage.windows['5h'].valueLabel).toBe('100% · limit reached');
  });

  it('uses local db when official endpoint fails and no dashboard config exists', async () => {
    vi.mocked(readAuthFile).mockReturnValue({ 'opencode-go': { key: 'sk-test' } });
    vi.mocked(readOpenCodeWindows).mockResolvedValue({
      windows: {
        '5h': { usedPercent: 10, remainingPercent: 90, windowSeconds: 18000, resetAt: Date.now() + 10000, resetAtFormatted: null, resetAfterFormatted: null },
        weekly: { usedPercent: 20, remainingPercent: 80, windowSeconds: 604800, resetAt: Date.now() + 86400, resetAtFormatted: null, resetAfterFormatted: null },
        monthly: { usedPercent: 30, remainingPercent: 70, windowSeconds: 2592000, resetAt: Date.now() + 864000, resetAtFormatted: null, resetAfterFormatted: null }
      }
    });
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });

    const result = await fetchQuota();

    expect(result.ok).toBe(true);
    expect(result.configured).toBe(true);
    expect(result.usageSource).toBe('local');
  });

  it('returns error when dashboard is configured but fetch fails (no local fallback)', async () => {
    vi.mocked(readAuthFile).mockReturnValue({});
    vi.mocked(resolveDashboardConfig).mockReturnValue({ workspaceId: 'wrk_test', authCookie: 'cookie', source: 'env' });
    vi.mocked(resolveConfigMode).mockReturnValue('cookie');
    vi.mocked(fetchDashboardUsage).mockRejectedValue(new Error('Dashboard fetch failed'));
    globalThis.fetch = vi.fn();

    const result = await fetchQuota();

    expect(result.ok).toBe(false);
    expect(result.configured).toBe(true);
    expect(result.error).toMatch(/Dashboard fetch failed/);
  });

  it('fills missing windows from local db when dashboard data is partial', async () => {
    vi.mocked(readAuthFile).mockReturnValue({ 'opencode-go': { key: 'sk-test' } });
    vi.mocked(resolveDashboardConfig).mockReturnValue({ workspaceId: 'wrk_test', authCookie: 'cookie', source: 'env' });
    vi.mocked(resolveConfigMode).mockReturnValue('cookie');
    // Dashboard returns only rolling + weekly (no monthly)
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        rollingUsage: { status: 'ok', resetInSec: 2520, usagePercent: 10 },
        weeklyUsage: { status: 'ok', resetInSec: 259200, usagePercent: 20 }
      })
    });
    // Local DB has monthly
    vi.mocked(readOpenCodeWindows).mockResolvedValue({
      windows: {
        monthly: { usedPercent: 30, remainingPercent: 70, windowSeconds: 2592000, resetAt: Date.now() + 864000, resetAtFormatted: null, resetAfterFormatted: null }
      }
    });

    const result = await fetchQuota();

    expect(result.ok).toBe(true);
    expect(result.usageSource).toBe('api');
    // All three windows should be present (monthly filled from local DB)
    const keys = Object.keys(result.usage.windows);
    expect(keys).toContain('5h');
    expect(keys).toContain('weekly');
    expect(keys).toContain('monthly');
  });

  it('reads usage windows from the dashboard when configured via env (no api key)', async () => {
    vi.mocked(readAuthFile).mockReturnValue({});
    vi.mocked(resolveDashboardConfig).mockReturnValue({ workspaceId: 'wrk_test', authCookie: 'Fe26.2**cookie', source: 'env' });
    vi.mocked(resolveConfigMode).mockReturnValue('cookie');
    vi.mocked(fetchDashboardUsage).mockResolvedValue({
      rolling: { usagePercent: 65, resetInSec: 2520, status: 'ok' },
      weekly: { usagePercent: 30, resetInSec: 259200, status: 'ok' },
      monthly: { usagePercent: 100, resetInSec: 600, status: 'rate-limited' }
    });

    const result = await fetchQuota();

    expect(result.ok).toBe(true);
    expect(result.usageSource).toBe('dashboard');
    expect(Object.keys(result.usage.windows)).toEqual(['5h', 'weekly', 'monthly']);
    expect(result.usage.windows['5h'].usedPercent).toBe(65);
    expect(result.usage.windows['5h'].valueLabel).toBe('65%');
    expect(result.usage.windows.weekly.usedPercent).toBe(30);
    expect(result.usage.windows.monthly.valueLabel).toBe('100% · limit reached');
  });

  it('detects configuration when any opencode-go auth exists', () => {
    vi.mocked(readAuthFile).mockReturnValue({ 'opencode-go': { type: 'api', key: 'sk-test' } });
    expect(isConfigured()).toBe(true);
  });

  it('uses the official API when only an api key is configured (no mode)', async () => {
    vi.mocked(readAuthFile).mockReturnValue({ 'opencode-go': { key: 'sk-test' } });
    vi.mocked(resolveConfigMode).mockReturnValue(null);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        rollingUsage: { status: 'ok', resetInSec: 1200, usagePercent: 42 }
      })
    });

    const result = await fetchQuota();

    expect(result.ok).toBe(true);
    expect(result.configured).toBe(true);
    expect(result.usageSource).toBe('api');
    expect(result.usage.windows['5h'].usedPercent).toBe(42);
  });

  it('uses persisted anchor resetAt without recomputing from seconds each fetch', async () => {
    vi.mocked(readAuthFile).mockReturnValue({});
    vi.mocked(resolveConfigMode).mockReturnValue('anchor');
    const resetAt = Date.now() + 3600 * 1000;
    vi.mocked(resolveAnchorConfig).mockReturnValue({ rolling: resetAt });
    vi.mocked(readOpenCodeWindows).mockResolvedValue({
      windows: {
        '5h': { usedPercent: 10, remainingPercent: 90, windowSeconds: null, resetAt: null, resetAtFormatted: null, resetAfterFormatted: null }
      }
    });

    const result = await fetchQuota();

    expect(result.ok).toBe(true);
    expect(result.usageSource).toBe('anchor');
    expect(result.usage.windows['5h'].resetAt).toBe(resetAt);
    expect(result.usage.windows['5h'].resetAfterSeconds).toBeGreaterThan(3500);
    expect(result.usage.windows['5h'].resetAfterSeconds).toBeLessThanOrEqual(3600);
  });

  it('is configured when only dashboard env vars are present', () => {
    vi.mocked(readAuthFile).mockReturnValue({});
    vi.mocked(resolveDashboardConfig).mockReturnValue({ workspaceId: 'wrk_test', authCookie: 'cookie', source: 'env' });
    expect(isConfigured()).toBe(true);
  });
});
