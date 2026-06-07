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

  it('transforms rolling/weekly/monthly usage into windows with dollar labels', async () => {
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

  it('returns an error result when the API responds with a non-ok status', async () => {
    vi.mocked(readAuthFile).mockReturnValue({ 'opencode-go': { key: 'sk-test' } });
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });

    const result = await fetchQuota();

    expect(result.ok).toBe(false);
    expect(result.configured).toBe(true);
    expect(result.error).toBe('API error: 401');
  });
});
