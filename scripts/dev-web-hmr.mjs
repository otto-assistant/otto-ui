#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const useDetachedChildren = process.platform === 'darwin';
const webRoot = path.join(repoRoot, 'packages/web');

function run(label, command, args, env = {}, options = {}) {
  return spawn(command, args, {
    cwd: options.cwd || repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...env },
    detached: useDetachedChildren,
  }).on('error', (error) => {
    console.error(`[dev:web:hmr] Failed to start ${label}:`, error);
  });
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }

    const onExit = () => {
      clearTimeout(timer);
      resolve();
    };

    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve();
    }, timeoutMs);

    child.once('exit', onExit);
  });
}

function signalChild(child, signal) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  try {
    if (useDetachedChildren && process.platform !== 'win32') {
      process.kill(-child.pid, signal);
      return;
    }
  } catch {
  }

  try {
    child.kill(signal);
  } catch {
  }
}

function listLanIpv4Addresses() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const entry of nets[name] ?? []) {
      const fam = typeof entry.family === 'string' ? entry.family : `IPv${entry.family}`;
      const isIpv4 = fam === 'IPv4' || entry.family === 4;
      if (entry && isIpv4 && entry.internal !== true && entry.address) {
        ips.push(entry.address);
      }
    }
  }
  return ips;
}

async function stopChildTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  signalChild(child, 'SIGINT');
  await waitForExit(child, 2500);

  if (child.exitCode === null && child.signalCode === null) {
    signalChild(child, 'SIGTERM');
    await waitForExit(child, 2500);
  }

  if (child.exitCode === null && child.signalCode === null) {
    signalChild(child, 'SIGKILL');
    await waitForExit(child, 1000);
  }
}

const uiPort =
  process.env.OPENCHAMBER_HMR_UI_PORT || process.env.OPENCHAMBER_UI_PORT || '5173';
const backendPort =
  process.env.OPENCHAMBER_HMR_API_PORT || process.env.OPENCHAMBER_PORT || '3001';
const listenHost =
  typeof process.env.OPENCHAMBER_HOST === 'string' && process.env.OPENCHAMBER_HOST.trim().length > 0
    ? process.env.OPENCHAMBER_HOST.trim()
    : '0.0.0.0';

function clearViteCache() {
  const cacheDirs = [
    path.join(webRoot, 'node_modules/.vite'),
    path.join(webRoot, 'node_modules/.vite-temp'),
  ];

  for (const cacheDir of cacheDirs) {
    if (!existsSync(cacheDir)) continue;
    rmSync(cacheDir, { recursive: true, force: true });
  }
}

clearViteCache();

const api = run('api', 'bun', ['run', '--cwd', 'packages/web', 'dev:server:watch'], {
  OPENCHAMBER_PORT: backendPort,
  OPENCHAMBER_HOST: listenHost,
});
const vite = run(
  'vite',
  'bun',
  ['x', 'vite', '--force', '--host', listenHost, '--port', uiPort, '--strictPort'],
  {
    OPENCHAMBER_PORT: backendPort,
    OPENCHAMBER_HOST: listenHost,
    OPENCHAMBER_DISABLE_PWA_DEV: '1',
  },
  { cwd: webRoot },
);

const loopbackUi = `http://127.0.0.1:${uiPort}`;
console.log(`[dev:web:hmr] UI listening on ${listenHost}:${uiPort} (same machine: ${loopbackUi})`);

if (listenHost === '0.0.0.0' || listenHost === '::') {
  const lanIps = listLanIpv4Addresses();
  if (lanIps.length > 0) {
    for (const ip of lanIps) {
      console.log(`[dev:web:hmr] LAN UI hint: http://${ip}:${uiPort}`);
    }
  } else {
    console.log('[dev:web:hmr] LAN UI: no LAN IPv4 address found');
  }
}

console.log(`[dev:web:hmr] API listening on ${listenHost}:${backendPort}`);
console.log('[dev:web:hmr] IMPORTANT: browse the UI port for HMR; /api is proxied from the UI dev server from any host');

let shuttingDown = false;

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.all([stopChildTree(api), stopChildTree(vite)]);
  process.exit(exitCode);
}

function onChildExit(label) {
  return (code, signal) => {
    if (shuttingDown) return;

    if (code !== 0 || signal) {
      console.error(`[dev:web:hmr] ${label} exited unexpectedly (code=${code ?? 'null'} signal=${signal ?? 'none'})`);
      shutdown(typeof code === 'number' ? code : 1).catch(() => process.exit(1));
      return;
    }

    shutdown(0).catch(() => process.exit(1));
  };
}

api.on('exit', onChildExit('api'));
vite.on('exit', onChildExit('vite'));

process.on('SIGINT', () => {
  shutdown(130).catch(() => process.exit(130));
});
process.on('SIGTERM', () => {
  shutdown(143).catch(() => process.exit(143));
});
process.on('SIGHUP', () => {
  shutdown(129).catch(() => process.exit(129));
});
