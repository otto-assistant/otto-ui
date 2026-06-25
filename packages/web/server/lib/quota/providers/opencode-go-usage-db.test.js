import { describe, expect, it } from 'vitest';

import {
  aggregateModelUsage,
  buildModelUsageWindows,
  computeMonthlyPeriodStart,
  computeNextMonthlyResetAt,
} from './opencode-go-usage-db.js';

const aliases = ['opencode-go', 'opencode', 'opencode-zen'];

// Helper: build a message quickly.
const msg = (role, provider, model, cost, created, extra = {}) => ({
  role,
  providerID: provider,
  modelID: model,
  cost,
  tokens: { total: 100 },
  time: { created },
  ...extra
});

describe('aggregateModelUsage', () => {
  it('groups assistant messages by model and sums cost, requests, and tokens', () => {
    const messages = [
      msg('assistant', 'opencode-go', 'glm-5', 0.02, 100, { tokens: { total: 1000 } }),
      msg('assistant', 'opencode-go', 'glm-5', 0.03, 300, { tokens: { total: 2000 } }),
      msg('assistant', 'opencode', 'big-pickle', 0, 200, { tokens: { total: 8000 } })
    ];

    const result = aggregateModelUsage(messages, aliases);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      modelID: 'glm-5',
      cost: 0.05,
      requests: 2,
      tokens: 3000,
      lastUsed: 300
    });
    expect(result[1]).toEqual({
      modelID: 'big-pickle',
      cost: 0,
      requests: 1,
      tokens: 8000,
      lastUsed: 200
    });
  });

  it('ignores non-assistant messages and other providers', () => {
    const messages = [
      msg('user', 'opencode-go', 'glm-5', 5, 100),
      msg('assistant', 'anthropic', 'claude', 5, 100),
      { role: 'assistant', providerID: 'opencode-go', cost: 1 }
    ];

    expect(aggregateModelUsage(messages, aliases)).toEqual([]);
  });

  it('returns an empty list for non-array input', () => {
    expect(aggregateModelUsage(null, aliases)).toEqual([]);
    expect(aggregateModelUsage(undefined, aliases)).toEqual([]);
  });
});

describe('buildModelUsageWindows', () => {
  it('builds a spend window per model with a dollar/request/token label', () => {
    const models = buildModelUsageWindows([
      { modelID: 'glm-5', cost: 0.05, requests: 2, tokens: 3000, lastUsed: 300 },
      { modelID: 'big-pickle', cost: 0, requests: 33, tokens: 277000, lastUsed: 200 }
    ]);

    expect(Object.keys(models)).toEqual(['glm-5', 'big-pickle']);

    expect(models['glm-5'].windows.spend.usedPercent).toBeNull();
    expect(models['glm-5'].windows.spend.valueLabel).toBe('$0.0500 · 2 req · 3K tok');

    expect(models['big-pickle'].windows.spend.valueLabel).toBe('$0.00 · 33 req · 277K tok');
  });

  it('formats spend over a dollar with two decimals and omits zero token counts', () => {
    const models = buildModelUsageWindows([
      { modelID: 'glm-5', cost: 12.5, requests: 4, tokens: 0, lastUsed: 0 }
    ]);

    expect(models['glm-5'].windows.spend.valueLabel).toBe('$12.50 · 4 req');
  });
});

describe('computeNextMonthlyResetAt', () => {
  it('uses this month when the anchor day is still ahead', () => {
    const now = Date.UTC(2026, 2, 10, 12, 0, 0); // 2026-03-10
    const anchor = Date.UTC(2026, 0, 15, 8, 0, 0); // day 15
    expect(computeNextMonthlyResetAt(anchor, now)).toBe(Date.UTC(2026, 2, 15));
  });

  it('uses next month when the anchor day has already passed', () => {
    const now = Date.UTC(2026, 2, 20, 12, 0, 0); // 2026-03-20
    const anchor = Date.UTC(2026, 0, 15, 8, 0, 0); // day 15
    expect(computeNextMonthlyResetAt(anchor, now)).toBe(Date.UTC(2026, 3, 15));
  });
});

describe('computeMonthlyPeriodStart', () => {
  it('returns the previous anchor day for the current billing period', () => {
    const resetAt = Date.UTC(2026, 2, 15);
    const anchor = Date.UTC(2026, 0, 15, 8, 0, 0);
    expect(computeMonthlyPeriodStart(resetAt, anchor)).toBe(Date.UTC(2026, 1, 15));
  });
});
