import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { getStatus } from './service.js';

const REPO = path.join(os.tmpdir(), `oc-git-status-cap-${Date.now()}`);

const seedFile = (relPath, content = '') => writeFileSync(path.join(REPO, relPath), content);

beforeAll(() => {
  mkdirSync(REPO, { recursive: true });
  execSync('git init -q', { cwd: REPO });
  execSync('git config user.email "t@t"', { cwd: REPO });
  execSync('git config user.name "t"', { cwd: REPO });
  seedFile('README.md', '# r\n');
  execSync('git add README.md', { cwd: REPO });
  execSync('git commit -q -m "init"', { cwd: REPO });
});

afterAll(() => {
  if (existsSync(REPO)) rmSync(REPO, { recursive: true, force: true });
});

describe('getStatus cap', () => {
  test('returns all files when below cap, with diffStats', async () => {
    // ~10 files
    mkdirSync(path.join(REPO, 'small'), { recursive: true });
    for (let i = 0; i < 10; i++) seedFile(`small/f${i}.txt`, `${i}\n`);

    const status = await getStatus(REPO);
    expect(status.files.length).toBe(10);
    expect(status.truncated).toBe(false);
    expect(status.totalChangedFiles).toBe(10);
    expect(status.diffStats).toBeDefined();
    expect(Object.keys(status.diffStats || {}).length).toBe(10);

    rmSync(path.join(REPO, 'small'), { recursive: true, force: true });
  });

  test('caps at 5000 files with truncated flag, skips diffStats', async () => {
    // 6000 untracked files
    mkdirSync(path.join(REPO, 'big'), { recursive: true });
    for (let i = 0; i < 6000; i++) {
      if (i % 100 === 0) mkdirSync(path.join(REPO, 'big', `g${i/100}`), { recursive: true });
      seedFile(`big/g${Math.floor(i/100)}/f${i}.txt`, `${i}\n`);
    }

    const t0 = Date.now();
    const status = await getStatus(REPO);
    const elapsed = Date.now() - t0;

    expect(status.files.length).toBe(5000);
    expect(status.truncated).toBe(true);
    expect(status.totalChangedFiles).toBe(6000);
    expect(status.truncatedCount).toBe(1000);
    expect(status.diffStats).toBeUndefined();
    expect(elapsed).toBeLessThan(5000);

    rmSync(path.join(REPO, 'big'), { recursive: true, force: true });
  });

  test('light mode also respects cap', async () => {
    mkdirSync(path.join(REPO, 'lite'), { recursive: true });
    for (let i = 0; i < 7000; i++) {
      if (i % 100 === 0) mkdirSync(path.join(REPO, 'lite', `g${i/100}`), { recursive: true });
      seedFile(`lite/g${Math.floor(i/100)}/f${i}.txt`, `${i}\n`);
    }

    const status = await getStatus(REPO, { mode: 'light' });

    expect(status.files.length).toBe(5000);
    expect(status.truncated).toBe(true);
    expect(status.totalChangedFiles).toBe(7000);
    expect(status.diffStats).toBeUndefined();

    rmSync(path.join(REPO, 'lite'), { recursive: true, force: true });
  });
});
