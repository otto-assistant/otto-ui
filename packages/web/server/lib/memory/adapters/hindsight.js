import path from 'path';
import fs from 'fs';
import { getMcpConfig, createMcpConfig, updateMcpConfig } from '../../opencode/mcp.js';
import { AGENT_SCOPE, OPENCODE_CONFIG_DIR } from '../../opencode/shared.js';
import {
  installServer,
  startServer,
  stopServer,
  isInstalled,
  isServerRunning,
  serverReachable,
  waitForHealth,
  resolveLlmKey,
} from '../hindsight-server.js';

const MCP_NAME = 'hindsight';
const CONFIG_FILE = path.join(OPENCODE_CONFIG_DIR, 'openchamber-hindsight.json');
const DEFAULT_BASE_URL = 'http://localhost:8888';

const DEFAULT_SETTINGS = {
  baseUrl: DEFAULT_BASE_URL,
  port: 8888,
  bank: '',
  llmProvider: 'gemini',
  llmApiKeyEnv: 'GEMINI_API_KEY',
  llmModel: 'gemini-2.5-flash',
  promptCacheEnabled: false,
  autoStart: true,
};

function readSettings() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) || {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(next) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
}

function baseUrl() {
  const s = readSettings();
  return (typeof s.baseUrl === 'string' && s.baseUrl) ? s.baseUrl.replace(/\/$/, '') : DEFAULT_BASE_URL;
}

function mcpUrl() {
  // When a fixed bank is configured, target it directly so the agent (MCP) and
  // the records UI operate on the same bank. Otherwise use the server default.
  const bank = readSettings().bank;
  return bank ? `${baseUrl()}/mcp/${encodeURIComponent(bank)}` : `${baseUrl()}/mcp`;
}

/**
 * Hindsight scopes memory into "banks". We map one bank per project so records
 * stay project-scoped. Bank id is a sanitized project basename.
 */
function bankForProject(workingDirectory) {
  const configured = readSettings().bank;
  if (typeof configured === 'string' && configured) return configured;
  if (!workingDirectory) return 'default';
  const base = path.basename(workingDirectory).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return base || 'default';
}

async function hsFetch(pathname, init = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${baseUrl()}${pathname}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Create the bank if missing (idempotent). Bank create is PUT /banks/{id}. */
async function ensureBank(bank) {
  try {
    const res = await hsFetch(`/v1/default/banks/${encodeURIComponent(bank)}`, { method: 'GET' }, 6000);
    if (res.ok) return;
  } catch { /* create below */ }
  try {
    await hsFetch(`/v1/default/banks/${encodeURIComponent(bank)}`, {
      method: 'PUT',
      body: JSON.stringify({ name: bank }),
    }, 10000);
  } catch { /* ignore */ }
}

function normalizeRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id ?? raw.memory_id ?? raw.unit_id;
  if (!id) return null;
  return {
    id: String(id),
    title: '',
    content: raw.text ?? raw.content ?? raw.fact ?? '',
    kind: raw.fact_type ?? raw.type ?? '',
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    project: '',
    createdAt: raw.occurred_start ?? raw.mentioned_at ?? raw.date ?? raw.created_at ?? null,
    updatedAt: raw.edited_at ?? raw.updated_at ?? null,
    _state: raw.state,
  };
}

function startupConfig() {
  const s = readSettings();
  return {
    port: s.port,
    llmProvider: s.llmProvider,
    llmApiKeyEnv: s.llmApiKeyEnv,
    llmModel: s.llmModel,
    promptCacheEnabled: s.promptCacheEnabled,
  };
}

async function ensureRunning() {
  if (!isInstalled()) return { ok: false, reason: 'not-installed' };
  if (!isServerRunning() || !(await serverReachable(baseUrl(), 3000))) {
    if (readSettings().autoStart !== false) {
      await startServer(startupConfig());
      await waitForHealth(baseUrl(), 60000);
    }
  }
  return { ok: await serverReachable(baseUrl(), 3000) };
}

export const hindsightAdapter = {
  id: 'hindsight',
  name: 'Hindsight',
  tagline: 'Structured belief memory: retain, recall, reflect (local server)',
  description:
    'An agent memory system that extracts structured facts, resolves entities, builds a knowledge graph, and forms opinions. OpenChamber installs and runs it locally (Python venv + embedded PostgreSQL) and exposes it over MCP.',
  docsUrl: 'https://github.com/vectorize-io/hindsight',
  integration: 'mcp',
  badges: ['structured', 'knowledge-graph', 'temporal', 'mcp', 'local-server'],
  requirements: [
    { id: 'python', label: 'Python 3.11+ (a dedicated virtualenv is created automatically)' },
    { id: 'llm', label: 'An LLM provider key for fact extraction (defaults to GEMINI_API_KEY)' },
    { id: 'network', label: 'Network access to install the server and reach the LLM provider' },
  ],
  capabilities: {
    records: true,
    create: true,
    update: true,
    delete: true,
    search: true,
    projectScoped: true,
    configurable: true,
  },
  recordModel: { title: false, kind: false, tags: true },

  async detect({ workingDirectory }) {
    const mcp = getMcpConfig(MCP_NAME, workingDirectory);
    const active = Boolean(mcp && mcp.enabled !== false);
    const installed = isInstalled() || Boolean(mcp) || fs.existsSync(CONFIG_FILE);
    const issues = [];
    if (active) {
      if (!isInstalled()) {
        issues.push('MCP entry is enabled but the Hindsight server is not installed — run Install.');
      } else {
        const running = isServerRunning() && await serverReachable(baseUrl(), 2000);
        if (!running) issues.push('Hindsight server is not running — it will auto-start when records are accessed.');
        const { key } = resolveLlmKey(readSettings());
        if (!key) issues.push('No LLM API key resolved — set llmApiKeyEnv (e.g. GEMINI_API_KEY) so fact extraction works.');
      }
    }
    return {
      installed,
      active,
      detail: active ? 'MCP server registered in OpenCode config.' : (installed ? 'Installed but not active.' : 'Not installed.'),
      issues,
    };
  },

  async install({ workingDirectory }) {
    const steps = [];
    if (!fs.existsSync(CONFIG_FILE)) {
      writeSettings({ ...DEFAULT_SETTINGS });
      steps.push({ label: 'Create Hindsight connection settings', ok: true, detail: CONFIG_FILE });
    }

    const installResult = await installServer();
    steps.push(...installResult.steps);

    // Start the server with the resolved LLM key.
    const { key, source } = resolveLlmKey(readSettings());
    await startServer(startupConfig());
    const healthy = await waitForHealth(baseUrl(), 120000);
    steps.push({
      label: 'Start Hindsight server (embedded PostgreSQL + REST/MCP)',
      ok: healthy,
      detail: healthy
        ? `Reachable at ${baseUrl()}${key ? ` (LLM key from ${source})` : ''}`
        : 'Server did not become healthy in time — check logs in ~/.openchamber-hindsight/server.log',
    });
    if (!key) {
      steps.push({
        label: 'LLM API key',
        ok: false,
        detail: `No key found in env "${source}". Fact extraction (create) needs one. Set the env var or edit llmApiKeyEnv in Configure.`,
      });
    }

    const mcp = getMcpConfig(MCP_NAME, workingDirectory);
    if (mcp) {
      if (mcp.enabled === false) updateMcpConfig(MCP_NAME, { enabled: true }, workingDirectory);
    } else {
      createMcpConfig(MCP_NAME, { type: 'remote', url: mcpUrl(), enabled: true }, workingDirectory, AGENT_SCOPE.USER);
    }
    steps.push({ label: 'Register Hindsight MCP server', ok: true, detail: mcpUrl() });
    return { steps };
  },

  async activate({ workingDirectory }) {
    if (isInstalled() && !isServerRunning()) {
      try {
        await startServer(startupConfig());
        await waitForHealth(baseUrl(), 60000);
      } catch { /* surfaced via detect issues */ }
    }
    const mcp = getMcpConfig(MCP_NAME, workingDirectory);
    if (mcp) {
      if (mcp.enabled === false) updateMcpConfig(MCP_NAME, { enabled: true }, workingDirectory);
    } else {
      createMcpConfig(MCP_NAME, { type: 'remote', url: mcpUrl(), enabled: true }, workingDirectory, AGENT_SCOPE.USER);
    }
    return { active: true };
  },

  async deactivate({ workingDirectory }) {
    const mcp = getMcpConfig(MCP_NAME, workingDirectory);
    if (mcp && mcp.enabled !== false) updateMcpConfig(MCP_NAME, { enabled: false }, workingDirectory);
    // Stop the local server so it doesn't keep running in the background.
    if (isServerRunning()) stopServer();
    return { active: false };
  },

  getConfig() {
    return { path: CONFIG_FILE, raw: JSON.stringify(readSettings(), null, 2) };
  },

  setConfig(_ctx, raw) {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') throw new Error('Configuration must be a JSON object');
    writeSettings({ ...DEFAULT_SETTINGS, ...parsed });
    // Restart so provider/model/port changes take effect.
    if (isServerRunning()) {
      stopServer();
    }
    return { path: CONFIG_FILE };
  },

  records: {
    async available() {
      if (!isInstalled()) {
        return { ok: false, reason: 'Hindsight server is not installed — run Install on the backend card.' };
      }
      const run = await ensureRunning();
      if (run.ok) return { ok: true, reason: 'server reachable' };
      return { ok: false, reason: 'Hindsight server is not reachable — check ~/.openchamber-hindsight/server.log' };
    },

    async list({ workingDirectory, query }) {
      const bank = bankForProject(workingDirectory);
      // Only world/experience facts are curatable; observations are derived
      // summaries that regenerate from sources and can't be edited/deleted, so
      // we don't surface them in the CRUD list (every shown row stays editable).
      const isCuratable = (r) => !r.kind || r.kind === 'world' || r.kind === 'experience';
      if (query) {
        const res = await hsFetch(`/v1/default/banks/${encodeURIComponent(bank)}/memories/recall`, {
          method: 'POST',
          body: JSON.stringify({ query }),
        }, 30000);
        if (!res.ok) throw new Error(`Hindsight recall failed (${res.status})`);
        const payload = await res.json();
        const arr = payload?.results || payload?.memories || [];
        return arr.map(normalizeRecord).filter(Boolean).filter(isCuratable).map(({ _state, ...rest }) => rest);
      }
      const res = await hsFetch(`/v1/default/banks/${encodeURIComponent(bank)}/memories/list?state=valid`, { method: 'GET' }, 20000);
      if (res.status === 404) return [];
      if (!res.ok) throw new Error(`Hindsight list failed (${res.status})`);
      const payload = await res.json();
      const arr = Array.isArray(payload?.items) ? payload.items : (Array.isArray(payload) ? payload : []);
      return arr
        .map(normalizeRecord)
        .filter((r) => r && r._state !== 'invalidated')
        .filter(isCuratable)
        .map(({ _state, ...rest }) => rest);
    },

    async create({ workingDirectory, input }) {
      const bank = bankForProject(workingDirectory);
      await ensureBank(bank);
      const res = await hsFetch(`/v1/default/banks/${encodeURIComponent(bank)}/memories`, {
        method: 'POST',
        body: JSON.stringify({
          items: [{ content: input.content || '', tags: Array.isArray(input.tags) ? input.tags : undefined }],
        }),
      }, 120000);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload?.success === false) {
        throw new Error(payload?.detail || payload?.error || `Hindsight retain failed (${res.status})`);
      }
      // Retain extracts facts (possibly several) — return a synthesized record;
      // the list refresh shows the extracted facts.
      return {
        id: String(payload?.operation_id || payload?.operation_ids?.[0] || Date.now()),
        title: '',
        content: input.content || '',
        kind: 'pending-extraction',
        tags: Array.isArray(input.tags) ? input.tags : [],
        project: bank,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    },

    async update({ workingDirectory, id, input }) {
      const bank = bankForProject(workingDirectory);
      const res = await hsFetch(`/v1/default/banks/${encodeURIComponent(bank)}/memories/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ text: input.content }),
      }, 30000);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.detail || `Hindsight edit failed (${res.status})`);
      return normalizeRecord(payload?.memory || payload || { id, text: input.content }) || { id: String(id), content: input.content, title: '', kind: '', tags: [], project: bank };
    },

    async remove({ workingDirectory, id }) {
      const bank = bankForProject(workingDirectory);
      const res = await hsFetch(`/v1/default/banks/${encodeURIComponent(bank)}/memories/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ state: 'invalidated' }),
      }, 20000);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.detail || `Hindsight invalidate failed (${res.status})`);
      }
    },
  },
};
