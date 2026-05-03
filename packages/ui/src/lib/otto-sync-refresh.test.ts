import { describe, expect, test } from 'bun:test';
import type { SyncEvent } from './otto-sync';
import {
  extractPersonaAgentHint,
  pickPersonaTargetAgent,
  refreshMemoryForRemoteEvent,
  refreshPersonaForRemoteEvent,
} from './otto-sync-refresh';

describe('extractPersonaAgentHint', () => {
  test('returns null for non-objects', () => {
    expect(extractPersonaAgentHint(null)).toBeNull();
    expect(extractPersonaAgentHint(undefined)).toBeNull();
    expect(extractPersonaAgentHint('x')).toBeNull();
    expect(extractPersonaAgentHint(1)).toBeNull();
  });

  test('reads common keys', () => {
    expect(extractPersonaAgentHint({ agent: 'otto' })).toBe('otto');
    expect(extractPersonaAgentHint({ agentId: 'bff ' })).toBe('bff');
    expect(extractPersonaAgentHint({ agentName: 'research' })).toBe('research');
    expect(extractPersonaAgentHint({ name: 'ops' })).toBe('ops');
    expect(extractPersonaAgentHint({ id: 'agent-1' })).toBe('agent-1');
  });

  test('prefers first matching key in stable order', () => {
    expect(extractPersonaAgentHint({ agent: 'a', name: 'b' })).toBe('a');
  });

  test('ignores blank strings', () => {
    expect(extractPersonaAgentHint({ agent: '   ' })).toBeNull();
  });
});

describe('pickPersonaTargetAgent', () => {
  test('returns null when no agents', () => {
    expect(
      pickPersonaTargetAgent({ agents: [], previousSelection: 'otto', hint: 'otto' }),
    ).toBeNull();
  });

  test('prefers hint when valid', () => {
    expect(
      pickPersonaTargetAgent({
        agents: ['otto', 'bff'],
        previousSelection: 'otto',
        hint: 'bff',
      }),
    ).toBe('bff');
  });

  test('falls back to previous selection', () => {
    expect(
      pickPersonaTargetAgent({
        agents: ['otto', 'bff'],
        previousSelection: 'bff',
        hint: 'missing',
      }),
    ).toBe('bff');
  });

  test('falls back to first agent', () => {
    expect(
      pickPersonaTargetAgent({
        agents: ['otto', 'bff'],
        previousSelection: 'missing',
        hint: null,
      }),
    ).toBe('otto');
  });
});

describe('refreshPersonaForRemoteEvent', () => {
  test('refetches list then selects hinted agent', async () => {
    let agents = ['otto'];
    const log: string[] = [];
    const persona = {
      getAgents: () => agents,
      getSelectedAgent: () => 'otto',
      fetchAgents: async () => {
        log.push('fetchAgents');
        agents = ['otto', 'bff'];
      },
      selectAgent: async (name: string) => {
        log.push(`select:${name}`);
      },
    };

    const event: SyncEvent = {
      id: '1',
      type: 'persona.updated',
      payload: { agent: 'bff' },
      timestamp: 1,
    };

    await refreshPersonaForRemoteEvent(event, persona);
    expect(log).toEqual(['fetchAgents', 'select:bff']);
  });
});

describe('refreshMemoryForRemoteEvent', () => {
  test('refreshes graph, diary when tab active, and repeats search when query set', async () => {
    const log: string[] = [];
    const memory = {
      getSnapshot: () => ({ activeTab: 'diary' as const, searchQuery: 'otto' }),
      fetchGraph: async () => {
        log.push('graph');
      },
      fetchDiary: async () => {
        log.push('diary');
      },
      searchMemory: async (q: string) => {
        log.push(`search:${q}`);
      },
    };

    await refreshMemoryForRemoteEvent(memory);
    expect(log).toEqual(['graph', 'diary', 'search:otto']);
  });

  test('skips diary and search when not needed', async () => {
    const log: string[] = [];
    const memory = {
      getSnapshot: () => ({ activeTab: 'graph' as const, searchQuery: '   ' }),
      fetchGraph: async () => {
        log.push('graph');
      },
      fetchDiary: async () => {
        log.push('diary');
      },
      searchMemory: async () => {
        log.push('search');
      },
    };

    await refreshMemoryForRemoteEvent(memory);
    expect(log).toEqual(['graph']);
  });
});
