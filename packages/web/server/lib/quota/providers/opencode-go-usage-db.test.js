import { describe, expect, it } from 'vitest';

import { aggregateModelUsage, buildModelUsageWindows, aggregateWindowSpend, buildLimitWindows, detectMonthlyAnchor, WINDOW_LIMITS_USD } from './opencode-go-usage-db.js';

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

describe('detectMonthlyAnchor', () => {
  it('returns null for empty input', () => {
    expect(detectMonthlyAnchor([], 60)).toBeNull();
    expect(detectMonthlyAnchor(null, 60)).toBeNull();
  });

  it('returns the first entry timestamp when spend never exceeds the limit', () => {
    const costs = [
      { created: 1000, cost: 10 },
      { created: 2000, cost: 10 },
      { created: 3000, cost: 10 }
    ];
    expect(detectMonthlyAnchor(costs, 60)).toBe(1000);
  });

  it('rolls over when cumulative spend exceeds the monthly limit', () => {
    const costs = [
      { created: 1000, cost: 40 },
      { created: 2000, cost: 30 },  // cumulative = 70 > 60 → rollover here
      { created: 3000, cost: 10 },
      { created: 4000, cost: 15 }   // cumulative = 25, no rollover
    ];
    // The rollover anchor is the timestamp of the message that pushed over the limit.
    expect(detectMonthlyAnchor(costs, 60)).toBe(2000);
  });

  it('handles multiple rollovers', () => {
    const costs = [
      { created: 1000, cost: 50 },
      { created: 2000, cost: 20 },  // cum 70 > 60 → anchor = 2000, reset to 20
      { created: 3000, cost: 30 },  // cum 50, ok
      { created: 4000, cost: 20 },  // cum 70 > 60 → anchor = 4000, reset to 20
      { created: 5000, cost: 10 }   // cum 30, ok
    ];
    expect(detectMonthlyAnchor(costs, 60)).toBe(4000);
  });

  it('handles exact-limit crossing', () => {
    const costs = [
      { created: 1000, cost: 60 },
      { created: 2000, cost: 5 }  // cum = 65 > 60 → anchor = 2000
    ];
    expect(detectMonthlyAnchor(costs, 60)).toBe(2000);
  });
});

describe('aggregateWindowSpend', () => {
  const now = Date.UTC(2026, 5, 8, 12, 0, 0); // Mon Jun 8 12:00 UTC

  // Week bounds: Mon Jun 8 00:00 UTC → Mon Jun 15 00:00 UTC
  // 5h cutoff: Jun 8 07:00 UTC

  it('builds three windows with correct keys and shapes', () => {
    const result = aggregateWindowSpend([msg('assistant', 'opencode-go', 'glm-5', 1, now - 3600000)], aliases, now);
    expect(Object.keys(result)).toEqual(['5h', 'weekly', 'monthly']);
    for (const key of ['5h', 'weekly', 'monthly']) {
      expect(result[key]).toHaveProperty('spend');
      expect(result[key]).toHaveProperty('resetAt');
      expect(result[key]).toHaveProperty('windowSeconds');
    }
  });

  it('counts spend in the 5-hour rolling window', () => {
    const messages = [
      msg('assistant', 'opencode-go', 'glm-5', 2, now - 3600000),  // 1h ago → in 5h
      msg('assistant', 'opencode-go', 'glm-5', 3, now - 6 * 3600000) // 6h ago → outside 5h
    ];
    const result = aggregateWindowSpend(messages, aliases, now);
    expect(result['5h'].spend).toBe(2);
    expect(result['5h'].resetAt).toBe(now - 3600000 + 5 * 3600 * 1000);
  });

  it('counts spend in the weekly window (Mon 00:00 UTC forward)', () => {
    // Jan 5 2026 is a Monday
    const monday = Date.UTC(2026, 0, 5, 0, 0, 0);
    const now2 = Date.UTC(2026, 0, 7, 12, 0, 0); // Wed
    const messages = [
      msg('assistant', 'opencode-go', 'glm-5', 5, Date.UTC(2026, 0, 4, 23, 0, 0)), // Sun 23:00 → BEFORE week
      msg('assistant', 'opencode-go', 'glm-5', 7, Date.UTC(2026, 0, 5, 1, 0, 0)),  // Mon 01:00 → in week
      msg('assistant', 'opencode-go', 'glm-5', 3, Date.UTC(2026, 0, 6, 12, 0, 0))  // Tue 12:00 → in week
    ];
    const result = aggregateWindowSpend(messages, aliases, now2);
    expect(result.weekly.spend).toBe(10);
    // Next Monday
    expect(result.weekly.resetAt).toBe(Date.UTC(2026, 0, 12, 0, 0, 0));
  });

  it('counts 0 weekly spend on Monday morning before any usage', () => {
    const monMorning = Date.UTC(2026, 5, 8, 6, 0, 0); // Mon Jun 8 06:00 UTC
    const messages = [
      msg('assistant', 'opencode-go', 'glm-5', 10, Date.UTC(2026, 5, 7, 23, 0, 0)) // Sun 23:00 → last week
    ];
    const result = aggregateWindowSpend(messages, aliases, monMorning);
    expect(result.weekly.spend).toBe(0);
  });

  it('counts monthly spend from the detected subscription anchor', () => {
    // Simulate a typical subscription: first month spent $45, second message pushes over $60
    const messages = [
      // "Previous month" spend — total $50, below limit
      msg('assistant', 'opencode-go', 'glm-5', 50, Date.UTC(2026, 4, 20, 10, 0, 0)),
      // This pushes cumulative to $55, still under $60
      msg('assistant', 'opencode-go', 'glm-5', 5, Date.UTC(2026, 5, 1, 10, 0, 0)),
      // This pushes cumulative to $65 > $60 → rollover at this timestamp
      msg('assistant', 'opencode-go', 'glm-5', 10, Date.UTC(2026, 5, 5, 18, 30, 0)),
      // Current period spend
      msg('assistant', 'opencode-go', 'glm-5', 8, Date.UTC(2026, 5, 6, 12, 0, 0)),
      msg('assistant', 'opencode-go', 'glm-5', 4, Date.UTC(2026, 5, 7, 8, 0, 0))
    ];
    // now is Jun 8
    const nowM = Date.UTC(2026, 5, 8, 12, 0, 0);
    const result = aggregateWindowSpend(messages, aliases, nowM);
    // Current period starts from the rollover (Jun 5 18:30)
    // Spend: 10 + 8 + 4 = 22? No — the message at Jun 5 18:30 itself had cost 10 which
    // pushed over the limit. Since detectMonthlyAnchor uses the message that pushed over,
    // that message counts toward the NEW period.
    // So current period: cost 10 (the rollover msg) + 8 + 4 = 22
    expect(result.monthly.spend).toBe(22);
    // Reset at: next month's anchor day (5th) in next month (July 5)
    expect(result.monthly.resetAt).toBe(Date.UTC(2026, 6, 5, 0, 0, 0));
  });

  it('returns zero monthly spend when there are no costs', () => {
    const result = aggregateWindowSpend([], aliases, now);
    expect(result.monthly.spend).toBe(0);
    expect(result.monthly.resetAt).toBeNull();
  });

  it('ignores non-matching providers and user messages', () => {
    const messages = [
      msg('user', 'opencode-go', 'glm-5', 50, now - 1000),
      msg('assistant', 'anthropic', 'claude', 50, now - 1000)
    ];
    const result = aggregateWindowSpend(messages, aliases, now);
    expect(result['5h'].spend).toBe(0);
    expect(result.weekly.spend).toBe(0);
    expect(result.monthly.spend).toBe(0);
  });
});

describe('buildLimitWindows', () => {
  it('converts windowed spend to usage window objects with percentages and labels', () => {
    const now = Date.UTC(2026, 5, 8, 12, 0, 0);
    const weekEnd = Date.UTC(2026, 5, 15, 0, 0, 0);
    const monthEnd = Date.UTC(2026, 6, 5, 0, 0, 0);

    const windows = buildLimitWindows({
      '5h': { spend: 3, resetAt: now + 7200000, windowSeconds: 18000 },
      weekly: { spend: 15, resetAt: weekEnd, windowSeconds: 604800 },
      monthly: { spend: 10.8, resetAt: monthEnd, windowSeconds: 2592000 }
    });

    expect(windows['5h'].usedPercent).toBeCloseTo(25, 1);
    expect(windows['5h'].valueLabel).toBe('$3.00 / $12.00');
    expect(windows['5h'].windowSeconds).toBe(18000);
    expect(windows.weekly.usedPercent).toBeCloseTo(50, 1);
    expect(windows.weekly.valueLabel).toBe('$15.00 / $30.00');
    expect(windows.monthly.usedPercent).toBeCloseTo(18, 1);
    expect(windows.monthly.valueLabel).toBe('$10.80 / $60.00');
  });

  it('returns empty for missing input', () => {
    expect(buildLimitWindows(null)).toEqual({});
    expect(buildLimitWindows({})).toEqual({});
  });

  it('returns zero percent for zero spend', () => {
    const windows = buildLimitWindows({
      '5h': { spend: 0, resetAt: null, windowSeconds: 18000 }
    });
    expect(windows['5h'].usedPercent).toBe(0);
    expect(windows['5h'].valueLabel).toBe('$0.00 / $12.00');
  });
});
