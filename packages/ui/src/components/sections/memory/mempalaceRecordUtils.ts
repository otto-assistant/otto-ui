import type { MemoryRecord } from '@/stores/useMemoryStore';

export type MempalaceSort = 'newest' | 'oldest' | 'wing';

export const PREVIEW_LINE_LIMIT = 6;
export const PREVIEW_CHAR_LIMIT = 480;

export function recordTimestamp(record: MemoryRecord): number {
  const raw = record.createdAt;
  if (raw == null) return 0;
  const ms = typeof raw === 'number' ? raw : Date.parse(String(raw));
  return Number.isFinite(ms) ? ms : 0;
}

export function formatRecordDate(record: MemoryRecord): string | null {
  const ms = recordTimestamp(record);
  if (!ms) return null;
  return new Date(ms).toLocaleString();
}

export function splitContentLines(content: string): string[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  if (trimmed.includes('\n')) {
    return trimmed.split('\n').map((line) => line.trimEnd());
  }

  if (trimmed.includes('|') && trimmed.split('|').length >= 2) {
    return trimmed.split('|').map((part) => part.trim()).filter(Boolean);
  }

  return [trimmed];
}

export function shouldCollapseContent(content: string): boolean {
  const lines = content.split('\n');
  return content.length > PREVIEW_CHAR_LIMIT || lines.length > PREVIEW_LINE_LIMIT;
}

export function collapsedContent(content: string): string {
  const lines = content.split('\n');
  if (lines.length > PREVIEW_LINE_LIMIT) {
    return `${lines.slice(0, PREVIEW_LINE_LIMIT).join('\n')}\n…`;
  }
  if (content.length > PREVIEW_CHAR_LIMIT) {
    return `${content.slice(0, PREVIEW_CHAR_LIMIT)}…`;
  }
  return content;
}

export function filterMempalaceRecords(
  records: MemoryRecord[],
  { wing, room, query }: { wing?: string; room?: string; query?: string },
): MemoryRecord[] {
  let out = records;
  if (wing) {
    out = out.filter((record) => (record.wing || record.project || '') === wing);
  }
  if (room) {
    out = out.filter((record) => (record.room || '') === room);
  }
  const needle = query?.trim();
  if (needle) {
    const lower = needle.toLowerCase();
    out = out.filter((record) => {
      const haystack = [
        record.content,
        record.room,
        record.wing,
        record.project,
        record.kind,
        record.id,
      ].filter(Boolean).join('\n').toLowerCase();
      return haystack.includes(lower);
    });
  }
  return out;
}

export function sortMempalaceRecords(records: MemoryRecord[], sort: MempalaceSort): MemoryRecord[] {
  const sorted = [...records];
  sorted.sort((a, b) => {
    if (sort === 'wing') {
      const wingCmp = (a.wing || a.project || '').localeCompare(b.wing || b.project || '');
      if (wingCmp !== 0) return wingCmp;
      const roomCmp = (a.room || '').localeCompare(b.room || '');
      if (roomCmp !== 0) return roomCmp;
      return recordTimestamp(b) - recordTimestamp(a);
    }
    const delta = recordTimestamp(b) - recordTimestamp(a);
    return sort === 'newest' ? delta : -delta;
  });
  return sorted;
}

export function groupByWing(records: MemoryRecord[]): { wing: string; records: MemoryRecord[] }[] {
  const map = new Map<string, MemoryRecord[]>();
  for (const record of records) {
    const wing = record.wing || record.project || 'unknown';
    const bucket = map.get(wing) ?? [];
    bucket.push(record);
    map.set(wing, bucket);
  }
  return Array.from(map.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([wing, wingRecords]) => ({ wing, records: wingRecords }));
}

export function uniqueWings(records: MemoryRecord[]): string[] {
  return [...new Set(records.map((record) => record.wing || record.project || '').filter(Boolean))].sort();
}

export function uniqueRooms(records: MemoryRecord[], wing?: string): string[] {
  const source = wing
    ? records.filter((record) => (record.wing || record.project || '') === wing)
    : records;
  return [...new Set(source.map((record) => record.room || '').filter(Boolean))].sort();
}
