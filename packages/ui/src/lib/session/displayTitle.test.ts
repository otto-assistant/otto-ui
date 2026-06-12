import { describe, test, expect } from 'bun:test';
import { isPlaceholderSessionTitle, getSessionDisplayTitle } from './displayTitle';

describe('isPlaceholderSessionTitle', () => {
  test('detects OpenCode parent/child placeholders (with and without milliseconds)', () => {
    expect(isPlaceholderSessionTitle('New session - 2026-06-12T07:08:41.381Z')).toBe(true);
    expect(isPlaceholderSessionTitle('New session - 2026-06-12T07:08:41Z')).toBe(true);
    expect(isPlaceholderSessionTitle('Child session - 2026-06-12T07:08:41.381Z')).toBe(true);
    expect(isPlaceholderSessionTitle('  New session - 2026-06-12T07:08:41.381Z  ')).toBe(true);
  });

  test('does not flag real titles', () => {
    expect(isPlaceholderSessionTitle('Roadmap planning session')).toBe(false);
    expect(isPlaceholderSessionTitle('New session about the roadmap')).toBe(false);
    expect(isPlaceholderSessionTitle('Fix login bug')).toBe(false);
    expect(isPlaceholderSessionTitle('')).toBe(false);
    expect(isPlaceholderSessionTitle(null)).toBe(false);
    expect(isPlaceholderSessionTitle(undefined)).toBe(false);
  });
});

describe('getSessionDisplayTitle', () => {
  test('returns a real title trimmed', () => {
    expect(getSessionDisplayTitle('  Roadmap planning session  ', 'Untitled')).toBe('Roadmap planning session');
  });

  test('falls back for placeholders and empty titles', () => {
    expect(getSessionDisplayTitle('New session - 2026-06-12T07:08:41.381Z', 'Untitled')).toBe('Untitled');
    expect(getSessionDisplayTitle('', 'Untitled')).toBe('Untitled');
    expect(getSessionDisplayTitle(null, 'Untitled')).toBe('Untitled');
    expect(getSessionDisplayTitle(undefined, 'Untitled')).toBe('Untitled');
  });
});
