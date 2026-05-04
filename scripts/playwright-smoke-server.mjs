/**
 * Playwright smoke: serve packages/web via `vite preview` and a loopback stub
 * API so the SPA can boot without a real Otto/OpenChamber backend.
 */
import net from 'node:net';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '../packages/web');

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
        else reject(new Error('Failed to allocate stub port'));
      });
    });
    server.on('error', reject);
  });

const stubPort = await listenPort();

const stub = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  const p = url.pathname;

  if (p === '/health') {
    json(res, 200, { ok: true, isOpenCodeReady: true });
    return;
  }

  if (p === '/auth/session') {
    json(res, 200, { ok: true });
    return;
  }

  if (p === '/auth/passkey/status') {
    json(res, 200, {
      enabled: false,
      hasPasskeys: false,
      passkeyCount: 0,
      rpID: null,
    });
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
    json(res, 200, { name: 'smoke', path: '/' });
    return;
  }

  if (p === '/api/session' && req.method === 'GET') {
    json(res, 200, []);
    return;
  }

  if (p === '/api/otto/status') {
    json(res, 200, {
      healthy: true,
      version: 'smoke',
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

await new Promise((resolve, reject) => {
  stub.listen(stubPort, '127.0.0.1', resolve);
  stub.on('error', reject);
});

const child = spawn('bun', ['run', 'preview:ci'], {
  cwd: webRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    PLAYWRIGHT_STUB_API_PORT: String(stubPort),
  },
});

const shutdown = () => {
  try {
    stub.close();
  } catch {
    // ignore
  }
  try {
    child.kill('SIGTERM');
  } catch {
    // ignore
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
child.on('exit', (code, signal) => {
  shutdown();
  if (signal) process.exit(0);
  process.exit(code ?? 0);
});
