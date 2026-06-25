import { describe, expect, it } from 'vitest';
import { __test } from './mempalace.js';

const {
  drawerToRecord,
  parseDrawersFromPayload,
  filterRecordsByQuery,
  parseMcpPayload,
  isMissingTableError,
} = __test;

describe('mempalace adapter helpers', () => {
  it('maps Python list_drawers rows to records', () => {
    const record = drawerToRecord({
      drawer_id: 'drawer_notes_general_abc',
      wing: 'notes',
      room: 'general',
      content_preview: 'hello world',
    });
    expect(record).toMatchObject({
      id: 'drawer_notes_general_abc',
      content: 'hello world',
      kind: 'notes/general',
      project: 'notes',
    });
  });

  it('parses list and search payloads', () => {
    const records = parseDrawersFromPayload({
      drawers: [{ drawer_id: 'a', wing: 'w', room: 'r', content_preview: 'one' }],
    });
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe('a');

    const searchRecords = parseDrawersFromPayload({
      results: [{ id: 'b', text: 'two', wing: 'w', room: 'r' }],
    });
    expect(searchRecords[0].content).toBe('two');
  });

  it('filters records by query substring', () => {
    const filtered = filterRecordsByQuery(
      [{ id: '1', content: 'otto publish' }, { id: '2', content: 'other' }],
      'otto',
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('1');
  });

  it('throws on MCP tool errors instead of returning empty', () => {
    expect(() => parseMcpPayload({
      isError: true,
      content: [{ type: 'text', text: 'Table missing' }],
    })).toThrow(/Table missing/);
  });

  it('detects missing LanceDB table errors', () => {
    expect(isMissingTableError("Table 'mempalace_drawers' was not found")).toBe(true);
    expect(isMissingTableError('network timeout')).toBe(false);
  });
});
