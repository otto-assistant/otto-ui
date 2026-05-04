/**
 * Validates Electron main/preload entrypoints without executing them.
 *
 * Plain `node --check` on the TypeScript-free sources still parses
 * `import … from 'electron'`. On Linux the `electron` package resolves to the
 * CLI path, so Node fails with "Export named 'BrowserWindow' not found".
 *
 * Linux: run `bun ./scripts/bundle-main.mjs` + `bun ./scripts/bundle-preload.mjs`,
 * then `node --check` on `dist-bundle/*.mjs` (electron stays external).
 *
 * Other platforms: `node --check` on the repo sources (fast).
 *
 * Set SKIP_ELECTRON_TYPECHECK=1 to skip entirely.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

if (process.env.SKIP_ELECTRON_TYPECHECK === '1') {
  process.exit(0);
}

for (const rel of ['main.mjs', 'preload.mjs']) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    console.error(`[electron] type-check: missing ${rel}`);
    process.exit(1);
  }
}

const nodeVersionOk = (bin) => {
  const v = spawnSync(bin, ['-p', 'process.versions.node'], { encoding: 'utf-8' });
  if (v.status !== 0 || typeof v.stdout !== 'string') return false;
  const major = Number.parseInt(v.stdout.trim().split('.')[0] ?? '', 10);
  if (!Number.isFinite(major) || major < 22) return false;
  // `bun run` may put a `node` shim on PATH that is Bun; `node --check` then loads
  // `electron` and fails. Require a real Node.js binary.
  const notBun = spawnSync(bin, ['-e', 'process.exit(process.versions.bun ? 1 : 0)']);
  return notBun.status === 0;
};

const resolveNodeForBundledCheck = () => {
  const fromEnv = process.env.NODE_BINARY;
  if (fromEnv && nodeVersionOk(fromEnv)) {
    return fromEnv;
  }
  const candidates = ['node', '/usr/local/bin/node', '/opt/hostedtoolcache/node/22/x64/bin/node'];
  for (const bin of candidates) {
    if (nodeVersionOk(bin)) {
      return bin;
    }
  }
  return null;
};

let nodeBin = process.env.NODE_BINARY || 'node';

const runNodeCheck = (file) => {
  const result = spawnSync(nodeBin, ['--check', file], { stdio: 'inherit', env: process.env });
  if (result.error?.code === 'ENOENT') {
    console.error(`[electron] type-check: '${nodeBin}' not found (set NODE_BINARY or install Node)`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

if (process.platform === 'linux') {
  const resolvedNode = resolveNodeForBundledCheck();
  if (!resolvedNode) {
    console.error(
      '[electron] type-check: need Node.js 22+ on PATH for `node --check` of dist-bundle (Bun --check still resolves `electron`). ' +
        'Install Node 22+ in CI or set NODE_BINARY.',
    );
    process.exit(1);
  }
  nodeBin = resolvedNode;

  const bunBin = process.env.BUN_BINARY || 'bun';
  const runBun = (scriptName) => {
    const script = path.join(root, 'scripts', scriptName);
    const r = spawnSync(bunBin, [script], { stdio: 'inherit', cwd: root, env: process.env });
    if (r.error?.code === 'ENOENT') {
      console.error(`[electron] type-check: failed to spawn '${bunBin}'`);
      process.exit(1);
    }
    if (r.status !== 0) {
      process.exit(r.status ?? 1);
    }
  };
  runBun('bundle-main.mjs');
  runBun('bundle-preload.mjs');
  for (const rel of ['main.mjs', 'preload.mjs']) {
    const file = path.join(root, 'dist-bundle', rel);
    if (!fs.existsSync(file)) {
      console.error(`[electron] type-check: missing bundled ${rel} (run bundle:main / bundle:preload)`);
      process.exit(1);
    }
    runNodeCheck(file);
  }
  process.exit(0);
}

for (const rel of ['main.mjs', 'preload.mjs']) {
  runNodeCheck(path.join(root, rel));
}
