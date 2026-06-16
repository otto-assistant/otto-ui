import { describe, test, expect } from 'bun:test';
import { stripAnsi } from './toolHelpers';

describe('stripAnsi', () => {
  test('removes SGR colour codes (the eza/ls --color noise)', () => {
    const colored = '\u001B[1;33mmap_cmn.bin\u001B[0m \u001B[34m15 чер 11:07\u001B[0m';
    expect(stripAnsi(colored)).toBe('map_cmn.bin 15 чер 11:07');
  });

  test('removes orphaned SGR codes whose ESC byte was already dropped', () => {
    const orphaned = '.[1;33mr[31mw[90m-[0m[33mr[1;90m--[0m  [1;32m22k[0m [1;33mdeck[0m map_cmn.bin';
    expect(stripAnsi(orphaned)).toBe('.rw-r--  22k deck map_cmn.bin');
  });

  test('removes the directory-listing header garble from the report', () => {
    const line = '[1;34md[33mr[31mw[32mx[0m[33mr[31mw[32mx[33mr[1;90m-[0m[32mx[0m    [1;90m-[0m [1;33mdeck[0m [34m24 жов  2025[0m [1;34m.[0m';
    expect(stripAnsi(line)).toBe('drwxrwxr-x    - deck 24 жов  2025 .');
  });

  test('removes OSC hyperlinks and cursor-control sequences', () => {
    const osc = '\u001B]8;;https://x\u0007link\u001B]8;;\u0007\u001B[2K done';
    expect(stripAnsi(osc)).toBe('link done');
  });

  test('leaves plain text and lone brackets untouched', () => {
    expect(stripAnsi('arr[1,2,3] = foo[bar]')).toBe('arr[1,2,3] = foo[bar]');
    expect(stripAnsi('')).toBe('');
    expect(stripAnsi(null)).toBe('');
    expect(stripAnsi(undefined)).toBe('');
  });
});
