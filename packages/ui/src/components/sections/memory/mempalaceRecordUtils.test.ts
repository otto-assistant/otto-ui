import { describe, expect, test } from 'bun:test';
import {
  filterMempalaceRecords,
  groupByWing,
  sortMempalaceRecords,
  splitContentLines,
} from './mempalaceRecordUtils';
import type { MemoryRecord } from '@/stores/useMemoryStore';

const sample = (overrides: Partial<MemoryRecord>): MemoryRecord => ({
  id: '1',
  content: 'hello',
  tags: [],
  ...overrides,
});

describe('mempalaceRecordUtils', () => {
  test('splits pipe-separated AAAK lines', () => {
    expect(splitContentLines('SESSION:2026|otto|publish')).toEqual([
      'SESSION:2026',
      'otto',
      'publish',
    ]);
  });

  test('filters by wing, room, and query', () => {
    const records = [
      sample({ id: 'a', wing: 'otto', room: 'diary', content: 'publish done' }),
      sample({ id: 'b', wing: 'infra', room: 'deploy', content: 'vpn setup' }),
    ];
    expect(filterMempalaceRecords(records, { wing: 'otto' })).toHaveLength(1);
    expect(filterMempalaceRecords(records, { query: 'vpn' })).toHaveLength(1);
  });

  test('groups records by wing', () => {
    const groups = groupByWing([
      sample({ id: 'a', wing: 'otto', room: 'diary' }),
      sample({ id: 'b', wing: 'infra', room: 'deploy' }),
      sample({ id: 'c', wing: 'otto', room: 'snapshot' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.wing === 'otto')?.records).toHaveLength(2);
  });

  test('sorts newest first', () => {
    const sorted = sortMempalaceRecords([
      sample({ id: 'old', createdAt: '2026-01-01T00:00:00Z' }),
      sample({ id: 'new', createdAt: '2026-06-01T00:00:00Z' }),
    ], 'newest');
    expect(sorted[0].id).toBe('new');
  });
});
