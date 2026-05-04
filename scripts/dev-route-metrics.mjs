#!/usr/bin/env node
import path from 'node:path';
import net from 'node:net';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/**
 * Measures TTFB-ish and DOM timing for Otto UI hash routes against a local dev/preview server.
 *
 * Usage:
 *   1) Terminal A: `bun run dev` (HMR — default UI http://127.0.0.1:5180; set OPENCHAMBER_HMR_UI_PORT / OPENCHAMBER_HMR_API_PORT to customize)
 *   2) Optional: point `PLAYWRIGHT_BROWSERS_PATH` at your install (this script auto-detects bun’s `node_modules/.bun/playwright-core@*.../.local-browsers` when unset)
 *
 * Or one-shot (spawns loopback API stub + `vite` dev — no nodemon API):
 *   `bun scripts/dev-route-metrics.mjs`
 *
 * Output: JSON summary to stdout (and optional file via DEV_ROUTE_METRICS_OUT).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const webRoot = path.join(repoRoot, 'packages/web');

function configurePlaywrightBrowsersPath() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return;

  const candidates = [];
  try {
    const pwTestPkg = path.join(repoRoot, 'node_modules', '@playwright', 'test', 'package.json');
    if (existsSync(pwTestPkg)) {
      const requireFromPw = createRequire(pwTestPkg);
      const coreDir = path.dirname(requireFromPw.resolve('playwright-core/package.json'));
      candidates.push(path.join(coreDir, '.local-browsers'));
    }
  } catch {
    /* playwright not hoisted in a resolvable layout */
  }

  const bunDir = path.join(repoRoot, 'node_modules', '.bun');
  if (existsSync(bunDir)) {
    for (const name of readdirSync(bunDir)) {
      if (!name.startsWith('playwright-core@')) continue;
      const p = path.join(bunDir, name, 'node_modules', 'playwright-core', '.local-browsers');
      try {
        if (statSync(p).isDirectory()) {
          candidates.push(p);
          break;
        }
      } catch {
        /* continue */
      }
    }
  }

  for (const c of candidates) {
    if (existsSync(c)) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = c;
      return;
    }
  }
}

configurePlaywrightBrowsersPath();

const ROUTES = ['#/', '#/projects', '#/persona', '#/memory', '#/tasks', '#/schedule', '#/chat', '#/settings'];

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

const listenPort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : null;
      server.close(() => {
        if (port) resolve(port);
        else reject(new Error('Failed to allocate port'));
      });
    });
    server.on('error', reject);
  });

function startStub(stubPort) {
  const stub = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    const p = url.pathname;

    if (p === '/health') {
      json(res, 200, { ok: true, isOpenCodeReady: true, planModeExperimentalEnabled: false });
      return;
    }
    if (p === '/auth/session') {
      json(res, 200, { ok: true });
      return;
    }
    if (p === '/auth/passkey/status') {
      json(res, 200, { enabled: false, hasPasskeys: false, passkeyCount: 0, rpID: null });
      return;
    }
    if (p === '/api/config/settings') {
      json(res, 200, {});
      return;
    }
    if (p === '/api/config/providers') {
      json(res, 200, { providers: [], default: {} });
      return;
    }
    if (p === '/api/config/themes') {
      json(res, 200, { themes: [] });
      return;
    }
    if (p === '/api/session-folders') {
      if (req.method === 'GET' || req.method === 'POST') {
        json(res, 200, { foldersMap: {}, collapsedFolderIds: [] });
        return;
      }
    }
    if (p === '/api/fs/home') {
      json(res, 200, { home: '/tmp' });
      return;
    }
    if (p === '/api/path') {
      json(res, 200, { path: '/', exists: true, isDirectory: true });
      return;
    }
    if (p === '/api/project/current') {
      json(res, 200, { name: 'metrics', path: '/' });
      return;
    }
    if (p === '/api/session' && req.method === 'GET') {
      json(res, 200, []);
      return;
    }
    if (p === '/api/otto/status') {
      json(res, 200, {
        healthy: true,
        version: 'metrics-stub',
        stats: { messagesToday: 0, tasksCompleted: 0, activeSessions: 0, memoryFacts: 0 },
        activity: [],
        runningTasks: [],
        recentSessions: [],
      });
      return;
    }
    if (p === '/api/otto/agents') {
      json(res, 200, { agents: [] });
      return;
    }
    if (p.startsWith('/app/agents') || p === '/api/app/agents') {
      json(res, 200, []);
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  return new Promise((resolve, reject) => {
    stub.listen(stubPort, '127.0.0.1', () => resolve(stub));
    stub.on('error', reject);
  });
}

async function main() {
  const { chromium } = await import('@playwright/test');
  const stubPort = await listenPort();
  const uiPort = Number.parseInt(process.env.DEV_ROUTE_METRICS_UI_PORT ?? '5189', 10);
  const stub = await startStub(stubPort);

  const vite = spawn('bun', ['x', 'vite', '--force', '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort'], {
    cwd: webRoot,
    stdio: 'pipe',
    env: {
      ...process.env,
      PLAYWRIGHT_STUB_API_PORT: String(stubPort),
      OPENCHAMBER_DISABLE_PWA_DEV: '1',
    },
  });

  const baseURL = `http://127.0.0.1:${uiPort}`;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const waitReady = async () => {
    for (let i = 0; i < 120; i++) {
      try {
        const res = await fetch(baseURL);
        if (res.ok) return;
      } catch {
        /* wait */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('Vite dev server did not become ready in time');
  };

  try {
    await waitReady();
    const results = [];

    let routeIndex = 0;
    for (const hash of ROUTES) {
      // Hash-only changes do not reload the document; force a full navigation so
      // Navigation Timing + resource waterfalls reflect each route.
      const url = `${baseURL}/?_rt=${routeIndex}${hash}`;
      routeIndex += 1;
      await page.goto(url, { waitUntil: 'load', timeout: 60_000 });

      await page.waitForFunction(
        () => {
          const w = window;
          return w.__openchamberAppReady === true || document.querySelector('#root')?.children?.length > 0;
        },
        { timeout: 45_000 },
      );

      const timing = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        const n = nav && 'responseStart' in nav ? nav : null;
        const fetchStart = n?.fetchStart ?? 0;
        const responseStart = n?.responseStart ?? 0;
        const domInteractive = n?.domInteractive ?? 0;
        const transferSize = typeof n?.transferSize === 'number' ? n.transferSize : null;
        const entries = performance.getEntriesByType('resource').map((e) => ({
          name: e.name.split('?')[0],
          duration: Math.round(e.duration * 100) / 100,
          initiatorType: e.initiatorType,
          transferSize: 'transferSize' in e && typeof e.transferSize === 'number' ? e.transferSize : undefined,
        }));
        const byDomain = {};
        for (const e of entries) {
          try {
            const host = new URL(e.name).host || 'same';
            byDomain[host] = (byDomain[host] || 0) + e.duration;
          } catch {
            byDomain._relative = (byDomain._relative || 0) + e.duration;
          }
        }
        const topDomains = Object.entries(byDomain)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([host, ms]) => ({ host, durationMs: Math.round(ms * 100) / 100 }));

        return {
          route: typeof window.location.hash === 'string' ? window.location.hash || '#/' : '#/',
          ttfbMs: fetchStart && responseStart ? Math.round(responseStart - fetchStart) : null,
          domInteractiveMs: fetchStart && domInteractive ? Math.round(domInteractive - fetchStart) : null,
          docTransferBytes: transferSize,
          resourceCount: entries.length,
          topDomains,
        };
      });

      results.push(timing);

      await new Promise((r) => setTimeout(r, 300));
    }

    const out = {
      mode: 'dev-route-metrics-mjs',
      baseURL,
      stubPort,
      capturedAt: new Date().toISOString(),
      routes: results,
    };

    console.log(JSON.stringify(out, null, 2));

    const outPath = process.env.DEV_ROUTE_METRICS_OUT;
    if (outPath) {
      writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
    }
  } finally {
    await browser.close();
    try {
      vite.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    stub.close();
  }
}

await main();
