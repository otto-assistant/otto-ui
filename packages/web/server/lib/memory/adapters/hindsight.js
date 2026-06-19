import os from 'os';
import path from 'path';
import fs from 'fs';
import { getMcpConfig, createMcpConfig, updateMcpConfig } from '../../opencode/mcp.js';
import { AGENT_SCOPE, OPENCODE_CONFIG_DIR } from '../../opencode/shared.js';

const MCP_NAME = 'hindsight';
const CONFIG_FILE = path.join(OPENCODE_CONFIG_DIR, 'openchamber-hindsight.json');
const DEFAULT_BASE_URL = 'http://localhost:8888';

function readSettings() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) || {};
  } catch {
    return {};
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
  return `${baseUrl()}/mcp`;
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

async function hsFetch(pathname, init = {}, timeoutMs = 10000) {
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

async function ensureBank(bank) {
  // Best-effort: create the bank if it doesn't exist. Ignore "already exists".
  try {
    const res = await hsFetch(`/v1/default/banks/${encodeURIComponent(bank)}`, { method: 'GET' }, 5000);
    if (res.ok) return;
  } catch { /* fall through to create */ }
  try {
    await hsFetch('/v1/default/banks', { method: 'POST', body: JSON.stringify({ id: bank, name: bank }) }, 8000);
  } catch { /* ignore */ }
}

function normalizeRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id ?? raw.memory_id ?? raw.unit_id;
  if (!id) return null;
  return {
    id: String(id),
    title: raw.fact_type || '',
    content: raw.text ?? raw.content ?? raw.fact ?? '',
    kind: raw.fact_type ?? raw.state ?? '',
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    project: '',
    createdAt: raw.occurred_at ?? raw.created_at ?? null,
    updatedAt: raw.edited_at ?? raw.updated_at ?? null,
  };
}

export const hindsightAdapter = {
  id: 'hindsight',
  name: 'Hindsight',
  tagline: 'Structured belief memory: retain, recall, reflect (MCP server)',
  description:
    'An agent memory system that extracts structured facts, resolves entities, builds a knowledge graph, and forms opinions. Runs as a server (Docker or pip) exposing REST + an MCP endpoint.',
  docsUrl: 'https://github.com/vectorize-io/hindsight',
  integration: 'mcp',
  badges: ['structured', 'knowledge-graph', 'temporal', 'mcp', 'server'],
  requirements: [
    { id: 'server', label: 'A running Hindsight server (Docker `ghcr.io/vectorize-io/hindsight` or `pip install hindsight-api`)' },
    { id: 'llm', label: 'An LLM provider API key for fact extraction (HINDSIGHT_API_LLM_API_KEY)' },
    { id: 'postgres', label: 'PostgreSQL with pgvector (embedded by default)' },
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
  recordModel: { title: false, kind: false, tags: false },

  async detect({ workingDirectory }) {
    const mcp = getMcpConfig(MCP_NAME, workingDirectory);
    const active = Boolean(mcp && mcp.enabled !== false);
    const installed = Boolean(mcp) || fs.existsSync(CONFIG_FILE) || fs.existsSync(path.join(os.homedir(), '.hindsight-docker'));
    return {
      installed,
      active,
      detail: active ? 'MCP server registered in OpenCode config.' : (installed ? 'Configured but not active.' : 'Not installed.'),
      issues: active ? ['Hindsight requires a running server (Docker/pip) reachable at the configured URL.'] : [],
    };
  },

  async install({ workingDirectory }) {
    const steps = [];
    if (!fs.existsSync(CONFIG_FILE)) {
      writeSettings({ baseUrl: DEFAULT_BASE_URL });
      steps.push({ label: 'Create Hindsight connection settings', ok: true, detail: CONFIG_FILE });
    }
    const mcp = getMcpConfig(MCP_NAME, workingDirectory);
    if (mcp) {
      if (mcp.enabled === false) updateMcpConfig(MCP_NAME, { enabled: true }, workingDirectory);
      steps.push({ label: 'Use existing Hindsight MCP entry', ok: true });
    } else {
      createMcpConfig(MCP_NAME, { type: 'remote', url: mcpUrl(), enabled: true }, workingDirectory, AGENT_SCOPE.USER);
      steps.push({ label: 'Register Hindsight MCP server (remote)', ok: true, detail: mcpUrl() });
    }
    steps.push({
      label: 'Start the Hindsight server',
      ok: false,
      detail: 'Run `docker run -p 8888:8888 ghcr.io/vectorize-io/hindsight:latest` (or `pip install hindsight-api && hindsight-api`) with an LLM API key.',
    });
    return { steps };
  },

  async activate({ workingDirectory }) {
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
    return { active: false };
  },

  getConfig() {
    return { path: CONFIG_FILE, raw: JSON.stringify({ baseUrl: baseUrl(), ...readSettings() }, null, 2) };
  },

  setConfig(_ctx, raw) {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') throw new Error('Configuration must be a JSON object');
    writeSettings(parsed);
    return { path: CONFIG_FILE };
  },

  records: {
    async available() {
      try {
        const res = await hsFetch('/health', { method: 'GET' }, 3000).catch(() => null)
          || await hsFetch('/', { method: 'GET' }, 3000);
        if (res && (res.ok || res.status < 500)) return { ok: true, reason: 'server reachable' };
        return { ok: false, reason: `server returned ${res ? res.status : 'no response'}` };
      } catch {
        return { ok: false, reason: 'Hindsight server not reachable — start it (Docker/pip) at the configured URL.' };
      }
    },

    async list({ workingDirectory, query }) {
      const bank = bankForProject(workingDirectory);
      if (query) {
        const res = await hsFetch(`/v1/default/banks/${encodeURIComponent(bank)}/memories/recall`, {
          method: 'POST',
          body: JSON.stringify({ query, top_k: 50 }),
        }, 20000);
        if (!res.ok) throw new Error(`Hindsight recall failed (${res.status})`);
        const payload = await res.json();
        const arr = payload?.memories || payload?.results || payload?.facts || [];
        return arr.map(normalizeRecord).filter(Boolean);
      }
      const res = await hsFetch(`/v1/default/banks/${encodeURIComponent(bank)}/memories/list`, { method: 'GET' }, 15000);
      if (!res.ok) throw new Error(`Hindsight list failed (${res.status})`);
      const payload = await res.json();
      const arr = payload?.memories || payload?.units || payload?.results || (Array.isArray(payload) ? payload : []);
      return arr.map(normalizeRecord).filter(Boolean);
    },

    async create({ workingDirectory, input }) {
      const bank = bankForProject(workingDirectory);
      await ensureBank(bank);
      const res = await hsFetch(`/v1/default/banks/${encodeURIComponent(bank)}/memories`, {
        method: 'POST',
        body: JSON.stringify({ items: [{ content: input.content || '' }] }),
      }, 60000);
      if (!res.ok) throw new Error(`Hindsight retain failed (${res.status})`);
      const payload = await res.json().catch(() => ({}));
      const created = payload?.memories?.[0] || payload?.created?.[0] || payload;
      return normalizeRecord(created) || { id: String(payload?.operation_id || Date.now()), content: input.content, title: '', kind: 'pending', tags: [], project: '' };
    },

    async update({ workingDirectory, id, input }) {
      const bank = bankForProject(workingDirectory);
      const res = await hsFetch(`/v1/default/banks/${encodeURIComponent(bank)}/memories/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ text: input.content }),
      }, 20000);
      if (!res.ok) throw new Error(`Hindsight edit failed (${res.status})`);
      const payload = await res.json().catch(() => ({}));
      return normalizeRecord(payload) || { id: String(id), content: input.content, title: '', kind: '', tags: [], project: '' };
    },

    async remove({ workingDirectory, id }) {
      const bank = bankForProject(workingDirectory);
      // Curation: invalidate (retire) the fact.
      const res = await hsFetch(`/v1/default/banks/${encodeURIComponent(bank)}/memories/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ state: 'invalidated' }),
      }, 20000);
      if (!res.ok) throw new Error(`Hindsight invalidate failed (${res.status})`);
    },
  },
};
