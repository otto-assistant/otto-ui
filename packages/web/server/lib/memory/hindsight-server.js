import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { runCommand, commandExists } from './exec.js';

/**
 * Hindsight server lifecycle on the local machine.
 *
 * Hindsight is a standalone server (REST + MCP) backed by an embedded
 * PostgreSQL (pg0) and an LLM provider for fact extraction. Unlike the other
 * backends it isn't launched on-demand by OpenCode, so OpenChamber installs and
 * runs it here:
 *   - install: create a Python venv, bootstrap pip (no sudo / no ensurepip
 *     dependency), `pip install hindsight-api`.
 *   - run: spawn `hindsight-api` as a detached background process with the LLM
 *     provider + key supplied via env (never persisted to disk).
 *
 * Free-tier nuance: Gemini's prompt/content caching is disabled by default
 * (HINDSIGHT_API_LLM_PROMPT_CACHE_ENABLED=false) because the free tier rejects
 * cached-content storage (429), which otherwise breaks fact extraction.
 */

export const HS_DIR = path.join(os.homedir(), '.openchamber-hindsight');
const VENV_DIR = path.join(HS_DIR, 'venv');
const PID_FILE = path.join(HS_DIR, 'server.pid');
const LOG_FILE = path.join(HS_DIR, 'server.log');
const GETPIP = path.join(HS_DIR, 'get-pip.py');

const PROVIDER_KEY_ENV = {
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  groq: 'GROQ_API_KEY',
};

function venvBin(name) {
  const sub = process.platform === 'win32' ? 'Scripts' : 'bin';
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  return path.join(VENV_DIR, sub, exe);
}

export function isInstalled() {
  return fs.existsSync(venvBin('hindsight-api'));
}

async function resolvePython() {
  if (await commandExists('python3')) return 'python3';
  if (await commandExists('python')) return 'python';
  return null;
}

/**
 * Install the Hindsight server into a dedicated venv. Idempotent: if already
 * installed, returns immediately.
 */
export async function installServer() {
  const steps = [];
  if (isInstalled()) {
    return { steps: [{ label: 'Hindsight already installed', ok: true, detail: VENV_DIR }] };
  }

  const py = await resolvePython();
  if (!py) {
    throw new Error('Python 3.11+ is required to install the Hindsight server.');
  }
  fs.mkdirSync(HS_DIR, { recursive: true });

  // venv without pip (ensurepip may be unavailable on minimal systems).
  let r = await runCommand(py, ['-m', 'venv', '--without-pip', VENV_DIR], { timeoutMs: 120000 });
  steps.push({ label: 'Create Python virtual environment', ok: r.code === 0, detail: r.code === 0 ? VENV_DIR : (r.stderr || r.stdout).trim().slice(-300) });
  if (r.code !== 0) throw new Error(`venv creation failed: ${(r.stderr || r.stdout).trim().slice(-200)}`);

  // Bootstrap pip without sudo via get-pip.py.
  r = await runCommand('curl', ['-sSL', 'https://bootstrap.pypa.io/get-pip.py', '-o', GETPIP], { timeoutMs: 60000 });
  if (!fs.existsSync(GETPIP)) throw new Error('Failed to download get-pip.py (network required).');
  r = await runCommand(venvBin('python'), [GETPIP], { timeoutMs: 120000 });
  steps.push({ label: 'Bootstrap pip', ok: r.code === 0, detail: r.code === 0 ? 'pip ready' : (r.stderr || r.stdout).trim().slice(-300) });
  if (r.code !== 0) throw new Error('pip bootstrap failed.');

  // Install the package (heavy — embedded Postgres, pgvector, ML deps).
  r = await runCommand(venvBin('python'), ['-m', 'pip', 'install', 'hindsight-api'], { timeoutMs: 900000 });
  steps.push({ label: 'pip install hindsight-api', ok: r.code === 0, detail: r.code === 0 ? 'installed' : (r.stderr || r.stdout).trim().slice(-400) });
  if (r.code !== 0) throw new Error(`pip install hindsight-api failed: ${(r.stderr || r.stdout).trim().slice(-300)}`);

  return { steps };
}

/**
 * Resolve the LLM API key for fact extraction without persisting a secret:
 * prefer an explicit env-var reference, then provider defaults.
 */
export function resolveLlmKey(config) {
  const envName = config.llmApiKeyEnv || PROVIDER_KEY_ENV[config.llmProvider || 'gemini'];
  if (envName && process.env[envName]) {
    return { key: process.env[envName], source: envName };
  }
  return { key: null, source: envName || null };
}

function readPid() {
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isServerRunning() {
  return isAlive(readPid());
}

export async function serverReachable(baseUrl, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/health`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function waitForHealth(baseUrl, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await serverReachable(baseUrl, 3000)) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

/**
 * Start the Hindsight server as a detached background process. No-op if already
 * running. Returns { started, pid, keyMissing }.
 */
export async function startServer(config) {
  if (!isInstalled()) {
    throw new Error('Hindsight is not installed yet. Install it first.');
  }
  if (isServerRunning()) {
    return { started: false, alreadyRunning: true, pid: readPid() };
  }

  const port = Number(config.port) || 8888;
  const provider = config.llmProvider || 'gemini';
  const { key, source } = resolveLlmKey(config);

  const env = {
    ...process.env,
    HINDSIGHT_API_HOST: '127.0.0.1',
    HINDSIGHT_API_PORT: String(port),
    HINDSIGHT_API_LLM_PROVIDER: provider,
    // Free-tier providers reject cached-content; disable unless explicitly on.
    HINDSIGHT_API_LLM_PROMPT_CACHE_ENABLED: config.promptCacheEnabled ? 'true' : 'false',
  };
  if (key) env.HINDSIGHT_API_LLM_API_KEY = key;
  if (config.llmModel) env.HINDSIGHT_API_LLM_MODEL = config.llmModel;

  fs.mkdirSync(HS_DIR, { recursive: true });
  const out = fs.openSync(LOG_FILE, 'a');
  const child = spawn(venvBin('hindsight-api'), ['--host', '127.0.0.1', '--port', String(port)], {
    env,
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
  });
  child.unref();
  // The child keeps its own dup of the log fd; close the parent copy so the
  // long-lived server process doesn't leak one fd per (re)start.
  fs.closeSync(out);
  fs.writeFileSync(PID_FILE, String(child.pid));
  return { started: true, pid: child.pid, keyMissing: !key, keyEnv: source };
}

export function stopServer() {
  const pid = readPid();
  if (isAlive(pid)) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }
  }
  try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
  return { stopped: true };
}
