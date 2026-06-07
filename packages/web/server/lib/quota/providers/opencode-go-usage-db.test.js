import { describe, expect, it } from 'vitest';

import { aggregateModelUsage, buildModelUsageWindows } from './opencode-go-usage-db.js';

const aliases = ['opencode-go', 'opencode', 'opencode-zen'];

describe('aggregateModelUsage', () => {
  it('groups assistant messages by model and sums cost, requests, and tokens', () => {
    const messages = [
      {
        role: 'assistant',
        providerID: 'opencode-go',
        modelID: 'glm-5',
        cost: 0.02,
        tokens: { total: 1000 },
        time: { created: 100 }
      },
      {
        role: 'assistant',
        providerID: 'opencode-go',
        modelID: 'glm-5',
        cost: 0.03,
        tokens: { total: 2000 },
        time: { created: 300 }
      },
      {
        role: 'assistant',
        providerID: 'opencode',
        modelID: 'big-pickle',
        cost: 0,
        tokens: { total: 8000 },
        time: { created: 200 }
      }
    ];

    const result = aggregateModelUsage(messages, aliases);

    expect(result).toHaveLength(2);
    // glm-5 has the higher cost, so it sorts first.
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
      { role: 'user', providerID: 'opencode-go', modelID: 'glm-5', cost: 5 },
      { role: 'assistant', providerID: 'anthropic', modelID: 'claude', cost: 5 },
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
