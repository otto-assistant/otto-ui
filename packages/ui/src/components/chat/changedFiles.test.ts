import { describe, test, expect } from 'bun:test';
import {
  extractGitChangedFiles,
  hasAnyGitChangedFiles,
  EXTRACT_GIT_CHANGED_FILES_LIMIT,
} from './changedFiles';

const file = (path: string, code = 'M') => ({ path, index: ' ', working_dir: code });

describe('hasAnyGitChangedFiles', () => {
  test('returns false for empty list', () => {
    expect(hasAnyGitChangedFiles([])).toBe(false);
  });

  test('returns false when all files are ignored or unchanged', () => {
    expect(hasAnyGitChangedFiles([file('a', ' '), file('b', '!')])).toBe(false);
  });

  test('returns true on first real change without walking the rest', () => {
    expect(hasAnyGitChangedFiles([file('a', ' '), file('b', 'M'), file('c', '?')])).toBe(true);
  });

  test('handles a synthetic huge list cheaply (no allocation per entry)', () => {
    const files = new Array(671_903).fill(0).map((_, i) => file(`f${i}`));
    const start = Date.now();
    expect(hasAnyGitChangedFiles(files)).toBe(true);
    expect(Date.now() - start).toBeLessThan(100);
  });
});

describe('extractGitChangedFiles', () => {
  test('caps result length to EXTRACT_GIT_CHANGED_FILES_LIMIT by default', () => {
    const files = new Array(EXTRACT_GIT_CHANGED_FILES_LIMIT + 1234).fill(0).map((_, i) => file(`f${i}`));
    const result = extractGitChangedFiles(files, undefined, '/repo');
    expect(result.length).toBe(EXTRACT_GIT_CHANGED_FILES_LIMIT);
  });

  test('honors override limit', () => {
    const files = new Array(100).fill(0).map((_, i) => file(`f${i}`));
    const result = extractGitChangedFiles(files, undefined, '/repo', { limit: 10 });
    expect(result.length).toBe(10);
  });

  test('skips ignored and unchanged files', () => {
    const result = extractGitChangedFiles(
      [file('a', ' '), file('b', '!'), file('c', 'M')],
      undefined,
      '/repo',
    );
    expect(result.map((r) => r.relativePath)).toEqual(['c']);
  });
});
