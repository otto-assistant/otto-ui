import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../opencode/auth.js', () => ({
  readAuthFile: vi.fn()
}));

import { readAuthFile } from '../../opencode/auth.js';
import { fetchQuota, isConfigured, providerId, providerName } from './opencode-go.js';

const originalFetch = globalThis.fetch;

describe('opencode-go quota provider', () => {
  beforeEach(() => {
    vi.mocked(readAuthFile).mockReset();
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

  it('returns a not-configured result without calling the API', async () => {
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

  it('transforms the official endpoint usage into windows with dollar labels', async () => {
    vi.mocked(readAuthFile).mockReturnValue({ 'opencode-go': { key: 'sk-test' } });
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

    const windows = result.usage.windows;
    expect(Object.keys(windows)).toEqual(['5h', 'weekly', 'monthly']);

    expect(windows['5h'].usedPercent).toBe(65);
    expect(windows['5h'].remainingPercent).toBe(35);
    expect(windows['5h'].valueLabel).toBe('$7.80 / $12.00');
    expect(windows['5h'].resetAfterSeconds).toBeGreaterThan(0);

    expect(windows.weekly.usedPercent).toBe(30);
    expect(windows.weekly.valueLabel).toBe('$9.00 / $30.00');

    expect(windows.monthly.usedPercent).toBe(12);
    expect(windows.monthly.valueLabel).toBe('$7.20 / $60.00');
  });

  it('flags rate-limited windows in the value label', async () => {
    vi.mocked(readAuthFile).mockReturnValue({ 'opencode-go': { key: 'sk-test' } });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        rollingUsage: { status: 'rate-limited', resetInSec: 600, usagePercent: 100 }
      })
    });

    const result = await fetchQuota();

    expect(result.ok).toBe(true);
    expect(Object.keys(result.usage.windows)).toEqual(['5h']);
    expect(result.usage.windows['5h'].usedPercent).toBe(100);
    expect(result.usage.windows['5h'].valueLabel).toBe('$12.00 / $12.00 · limit reached');
  });

  it('falls back to a setup message when the official endpoint is unavailable and no dashboard config exists', async () => {
    vi.mocked(readAuthFile).mockReturnValue({ 'opencode-go': { key: 'sk-test' } });
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });

    const result = await fetchQuota();

    expect(result.ok).toBe(false);
    expect(result.configured).toBe(true);
    expect(result.error).toMatch(/no usage API yet/i);
    expect(result.error).toMatch(/OPENCODE_GO_WORKSPACE_ID/);
  });

  it('reads usage windows from the dashboard when configured via env (no api key)', async () => {
    vi.mocked(readAuthFile).mockReturnValue({});
    process.env.OPENCODE_GO_WORKSPACE_ID = 'wrk_test';
    process.env.OPENCODE_GO_AUTH_COOKIE = 'Fe26.2**cookie';
    const html =
      'noise rollingUsage:$R[1]={status:"ok",resetInSec:2520,usagePercent:65} ' +
      'weeklyUsage:$R[2]={resetInSec:259200,usagePercent:30,status:"ok"} ' +
      'monthlyUsage:$R[3]={status:"rate-limited",usagePercent:100,resetInSec:600} noise';
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => html });

    const result = await fetchQuota();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://opencode.ai/workspace/wrk_test/go',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Cookie: 'auth=Fe26.2**cookie' })
      })
    );
    expect(result.ok).toBe(true);
    expect(Object.keys(result.usage.windows)).toEqual(['5h', 'weekly', 'monthly']);
    expect(result.usage.windows['5h'].usedPercent).toBe(65);
    expect(result.usage.windows['5h'].valueLabel).toBe('$7.80 / $12.00');
    expect(result.usage.windows.weekly.usedPercent).toBe(30);
    expect(result.usage.windows.monthly.valueLabel).toBe('$60.00 / $60.00 · limit reached');
  });

  it('detects configuration when any provider has auth (not only opencode-go keys)', () => {
    vi.mocked(readAuthFile).mockReturnValue({ zhipuai: { type: 'api', key: 'sk-test' } });
    expect(isConfigured()).toBe(true);
  });

  it('is configured when only dashboard env vars are present', () => {
    vi.mocked(readAuthFile).mockReturnValue({});
    process.env.OPENCODE_GO_WORKSPACE_ID = 'wrk_test';
    process.env.OPENCODE_GO_AUTH_COOKIE = 'cookie';
    expect(isConfigured()).toBe(true);
  });
});
