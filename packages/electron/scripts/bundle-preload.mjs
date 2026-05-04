/**
 * Bundles preload.mjs for Linux CI syntax validation (same externals as main bundle).
 * Output lives next to dist-bundle/main.mjs from bundle:main.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outdir = path.join(root, 'dist-bundle');

const result = await Bun.build({
  entrypoints: [path.join(root, 'preload.mjs')],
  outdir,
  target: 'node',
  format: 'esm',
  external: [
    'electron',
    '@openchamber/web',
    '@openchamber/web/*',
    'bun-pty',
    'node-pty',
    'better-sqlite3',
  ],
  minify: false,
  sourcemap: 'none',
  naming: '[name].mjs',
});

if (!result.success) {
  for (const msg of result.logs) console.error(msg);
  process.exit(1);
}

console.log('[electron] preload.mjs bundled -> dist-bundle/preload.mjs');
