import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../opencode/auth.js', () => ({
  readAuthFile: vi.fn()
}));

const localUsage = {
  windows: {
    '5h': {
      usedPercent: 0,
      remainingPercent: 100,
      windowSeconds: 18000,
      resetAfterSeconds: null,
      resetAt: null,
      resetAtFormatted: null,
      resetAfterFormatted: null,
      valueLabel: '$0.00 / $12.00'
    },
    weekly: {
      usedPercent: 50,
      remainingPercent: 50,
      windowSeconds: 604800,
      resetAfterSeconds: null,
      resetAt: null,
      resetAtFormatted: null,
      resetAfterFormatted: null,
      valueLabel: '$15.00 / $30.00'
    }
  },
  models: {
    'glm-5': {
      windows: {
        spend: {
          usedPercent: null,
          remainingPercent: null,
          windowSeconds: null,
          resetAfterSeconds: null,
          resetAt: null,
          resetAtFormatted: null,
          resetAfterFormatted: null,
          valueLabel: '$0.0500 · 2 req · 3K tok'
        }
      }
    }
  }
};

vi.mock('./opencode-go-usage-db.js', () => ({
  readOpenCodeUsage: vi.fn()
}));

import { readAuthFile } from '../../opencode/auth.js';
import { readOpenCodeUsage } from './opencode-go-usage-db.js';
import { fetchQuota, isConfigured, providerId, providerName } from './opencode-go.js';

describe('opencode-go quota provider', () => {
  beforeEach(() => {
    vi.mocked(readAuthFile).mockReset();
    vi.mocked(readOpenCodeUsage).mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it('returns a not-configured result without reading local usage or calling the API', async () => {
    vi.mocked(readAuthFile).mockReturnValue({});
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await fetchQuota();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(readOpenCodeUsage).not.toHaveBeenCalled();
    expect(result.providerId).toBe(providerId);
    expect(result.providerName).toBe(providerName);
    expect(result.ok).toBe(false);
    expect(result.configured).toBe(false);
    expect(result.error).toBe('Not configured');
  });

  it('returns local usage windows and models without calling the non-existent remote endpoint', async () => {
    vi.mocked(readAuthFile).mockReturnValue({ 'opencode-go': { key: 'sk-test' } });
    vi.mocked(readOpenCodeUsage).mockResolvedValue(localUsage);
    const fetchSpy = vi.fn(async () => ({ ok: false, status: 404 }));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await fetchQuota();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(readOpenCodeUsage).toHaveBeenCalledWith(['opencode-go', 'opencode', 'opencode-zen']);
    expect(result.ok).toBe(true);
    expect(result.configured).toBe(true);
    expect(result.usage).toBe(localUsage);
    expect(Object.keys(result.usage.windows)).toEqual(['5h', 'weekly']);
    expect(result.usage.models['glm-5']).toBeDefined();
  });

  it('returns empty windows and models when the local database is unavailable', async () => {
    vi.mocked(readAuthFile).mockReturnValue({ 'opencode-go': { key: 'sk-test' } });
    vi.mocked(readOpenCodeUsage).mockResolvedValue(null);

    const result = await fetchQuota();

    expect(result.ok).toBe(true);
    expect(result.configured).toBe(true);
    expect(result.usage).toEqual({ windows: {}, models: {} });
  });

  it('returns an error result when local usage cannot be read', async () => {
    vi.mocked(readAuthFile).mockReturnValue({ 'opencode-go': { key: 'sk-test' } });
    vi.mocked(readOpenCodeUsage).mockRejectedValue(new Error('db failed'));

    const result = await fetchQuota();

    expect(result.ok).toBe(false);
    expect(result.configured).toBe(true);
    expect(result.error).toBe('db failed');
  });
});
