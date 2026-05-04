/**
 * Validates Electron main/preload entrypoints without executing them.
 *
 * Plain `node --check` still parses `import … from 'electron'`. On Linux the
 * `electron` package resolves to the CLI path string, not the API surface, so
 * parsing fails with "Export named 'BrowserWindow' not found". macOS/Windows
 * installs expose a loadable module for tooling.
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

if (process.platform === 'linux') {
  console.warn(
    '[electron] syntax type-check skipped on Linux: Node cannot parse static `electron` imports (electron resolves to the binary path). ' +
      'Use macOS/Windows with Node for full syntax check, or SKIP_ELECTRON_TYPECHECK=1.',
  );
  process.exit(0);
}

const nodeBin = process.env.NODE_BINARY || 'node';
for (const rel of ['main.mjs', 'preload.mjs']) {
  const file = path.join(root, rel);
  const result = spawnSync(nodeBin, ['--check', file], { stdio: 'inherit', env: process.env });
  if (result.error?.code === 'ENOENT') {
    console.error(`[electron] type-check: '${nodeBin}' not found (set NODE_BINARY or install Node)`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
