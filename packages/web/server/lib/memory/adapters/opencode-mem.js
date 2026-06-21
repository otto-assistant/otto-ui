import os from 'os';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { parse as parseJsonc } from 'jsonc-parser';
import { hasPlugin, addPlugin, removePlugin } from '../opencode-config.js';
import { AGENT_SCOPE, OPENCODE_CONFIG_DIR } from '../../opencode/shared.js';

const PLUGIN_NAME = 'opencode-mem';
const CONFIG_FILE = path.join(OPENCODE_CONFIG_DIR, 'opencode-mem.jsonc');
const DEFAULT_PORT = 4747;
const DEFAULT_HOST = '127.0.0.1';

const DEFAULT_CONFIG = `{
  // OpenChamber-managed opencode-mem configuration.
  // Full reference: https://github.com/tickernelz/opencode-mem
  "storagePath": "~/.opencode-mem/data",
  "webServerEnabled": true,
  "webServerPort": ${DEFAULT_PORT},
  "webServerHost": "${DEFAULT_HOST}",
  "autoCaptureEnabled": true,
  "memoryQuery": {
    "defaultScope": "project"
  }
}
`;

function readMemConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {};
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    return parseJsonc(raw, [], { allowTrailingComma: true }) || {};
  } catch {
    return {};
  }
}

function webBaseUrl() {
  const cfg = readMemConfig();
  const port = typeof cfg.webServerPort === 'number' ? cfg.webServerPort : DEFAULT_PORT;
  const host = typeof cfg.webServerHost === 'string' ? cfg.webServerHost : DEFAULT_HOST;
  return `http://${host}:${port}`;
}

function dataDir() {
  const cfg = readMemConfig();
  if (typeof cfg.storagePath === 'string' && cfg.storagePath) {
    return cfg.storagePath.replace(/^~(?=$|\/|\\)/, os.homedir());
  }
  return path.join(os.homedir(), '.opencode-mem');
}

/**
 * Resolve opencode-mem's own `getProjectTagInfo` so we can compute the exact
 * container tag a project's memories live under.
 *
 * OpenCode downloads plugins into its package cache
 * (~/.cache/opencode/packages/opencode-mem@<ver>/node_modules/opencode-mem),
 * not the config dir, so we search both. The module is ESM, so we dynamic
 * import the resolved file.
 */
let cachedTagsModule;
function findTagsModulePaths() {
  const paths = [];
  try {
    const requireFrom = createRequire(path.join(OPENCODE_CONFIG_DIR, 'noop.js'));
    paths.push(requireFrom.resolve('opencode-mem/tags'));
  } catch { /* not in config dir */ }
  try {
    const cacheBase = path.join(os.homedir(), '.cache', 'opencode', 'packages');
    if (fs.existsSync(cacheBase)) {
      for (const dir of fs.readdirSync(cacheBase)) {
        if (!dir.startsWith('opencode-mem')) continue;
        const candidate = path.join(cacheBase, dir, 'node_modules', 'opencode-mem', 'dist', 'services', 'tags.js');
        if (fs.existsSync(candidate)) paths.push(candidate);
      }
    }
  } catch { /* ignore */ }
  return paths;
}

async function loadTagsModule() {
  if (cachedTagsModule !== undefined) return cachedTagsModule;
  for (const candidate of findTagsModulePaths()) {
    try {
      const mod = await import(pathToFileURL(candidate).href);
      if (mod && typeof mod.getProjectTagInfo === 'function') {
        cachedTagsModule = mod;
        return mod;
      }
    } catch { /* try next */ }
  }
  cachedTagsModule = null;
  return null;
}

async function resolveProjectTagInfo(directory) {
  const mod = await loadTagsModule();
  if (!mod) return null;
  try {
    return mod.getProjectTagInfo(directory);
  } catch {
    return null;
  }
}

async function memFetch(pathname, init = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${webBaseUrl()}${pathname}`, { ...init, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The opencode-mem web server wraps responses as { success, data: {...} }.
 * Memory lists live at data.items (list) or data.results (search); some
 * versions return a bare array. Normalize all of these to an array.
 */
function extractList(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  const data = payload.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.memories)) return data.memories;
  }
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.memories)) return payload.memories;
  return [];
}

function normalizeRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id;
  if (!id) return null;
  const tags = typeof raw.tags === 'string' && raw.tags
    ? raw.tags.split(',').map((t) => t.trim()).filter(Boolean)
    : (Array.isArray(raw.tags) ? raw.tags.map(String) : []);
  return {
    id: String(id),
    title: raw.displayName || raw.title || '',
    content: raw.content || '',
    kind: raw.type || '',
    tags,
    project: raw.projectName || raw.projectPath || '',
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
  };
}

export const opencodeMemAdapter = {
  id: 'opencode-mem',
  name: 'OpenCode Memory',
  tagline: 'Persistent memory plugin with a local vector database and web UI',
  description:
    'An OpenCode plugin that gives agents persistent memory using a local SQLite + USearch vector database. Provides a built-in memory tool, automatic prompt-based extraction, and a web UI.',
  docsUrl: 'https://github.com/tickernelz/opencode-mem',
  integration: 'plugin',
  badges: ['local-first', 'sqlite', 'vector', 'web-ui'],
  requirements: [
    { id: 'network', label: 'Network access to npm for first-time plugin download' },
    { id: 'webserver', label: 'Built-in web server on 127.0.0.1:4747 (used for record management)' },
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
  recordModel: { title: false, kind: true, tags: true },

  async detect({ workingDirectory }) {
    const active = hasPlugin(workingDirectory, PLUGIN_NAME);
    const installed = active || fs.existsSync(dataDir()) || fs.existsSync(CONFIG_FILE);
    return {
      installed,
      active,
      detail: active ? 'Plugin registered in OpenCode config.' : (installed ? 'Installed but not active.' : 'Not installed.'),
      issues: [],
    };
  },

  async install({ workingDirectory }) {
    const steps = [];
    if (!fs.existsSync(CONFIG_FILE)) {
      fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
      fs.writeFileSync(CONFIG_FILE, DEFAULT_CONFIG, 'utf8');
      steps.push({ label: 'Create opencode-mem.jsonc with web server enabled', ok: true, detail: CONFIG_FILE });
    } else {
      steps.push({ label: 'Use existing opencode-mem.jsonc', ok: true, detail: CONFIG_FILE });
    }
    addPlugin(workingDirectory, PLUGIN_NAME, AGENT_SCOPE.USER);
    steps.push({ label: 'Add "opencode-mem" to OpenCode plugin list', ok: true, detail: 'OpenCode downloads the plugin on next start.' });
    return { steps };
  },

  async activate({ workingDirectory }) {
    addPlugin(workingDirectory, PLUGIN_NAME, AGENT_SCOPE.USER);
    return { active: true };
  },

  async deactivate({ workingDirectory }) {
    removePlugin(workingDirectory, PLUGIN_NAME);
    return { active: false };
  },

  getConfig() {
    return {
      path: CONFIG_FILE,
      raw: fs.existsSync(CONFIG_FILE) ? fs.readFileSync(CONFIG_FILE, 'utf8') : DEFAULT_CONFIG,
    };
  },

  setConfig(_ctx, raw) {
    if (typeof raw !== 'string') {
      throw new Error('Configuration must be a JSONC string');
    }
    // Validate it parses before writing. `parseJsonc` is best-effort and never
    // throws; it reports syntax problems through the errors array instead.
    const parseErrors = [];
    parseJsonc(raw, parseErrors, { allowTrailingComma: true });
    if (parseErrors.length > 0) {
      throw new Error('Configuration is not valid JSONC');
    }
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, raw, 'utf8');
    return { path: CONFIG_FILE };
  },

  records: {
    async available() {
      try {
        const res = await memFetch('/api/stats', { method: 'GET' }, 3000);
        if (res.ok) return { ok: true, reason: 'web server reachable' };
        return { ok: false, reason: `web server returned ${res.status}` };
      } catch {
        return { ok: false, reason: 'web server not reachable — start OpenCode with opencode-mem active' };
      }
    },

    async list({ workingDirectory, query }) {
      const pathname = query
        ? `/api/search?q=${encodeURIComponent(query)}&pageSize=100`
        : '/api/memories?pageSize=100&includePrompts=false';
      const res = await memFetch(pathname, { method: 'GET' });
      if (!res.ok) throw new Error(`opencode-mem web server returned ${res.status}`);
      const payload = await res.json();
      const list = extractList(payload);
      const tagInfo = await resolveProjectTagInfo(workingDirectory);
      if (tagInfo?.tag) {
        const filtered = list.filter((m) => m.containerTag === tagInfo.tag);
        // Only narrow when the project tag actually matched something so a
        // not-yet-tagged project still shows its memories.
        if (filtered.length > 0) return filtered.map(normalizeRecord).filter(Boolean);
      }
      return list.map(normalizeRecord).filter(Boolean);
    },

    async create({ workingDirectory, input }) {
      const tagInfo = await resolveProjectTagInfo(workingDirectory);
      if (!tagInfo?.tag) {
        throw new Error('Cannot determine project container tag — start OpenCode once with opencode-mem active so the plugin is downloaded.');
      }
      const body = {
        content: input.content || '',
        containerTag: tagInfo.tag,
        tags: Array.isArray(input.tags) ? input.tags : [],
        type: input.kind || undefined,
        projectPath: tagInfo.projectPath,
        projectName: tagInfo.projectName,
      };
      // First create can trigger a local embedding-model download, so allow time.
      const res = await memFetch('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, 120000);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload?.success === false) {
        throw new Error(payload?.error || `opencode-mem create failed (${res.status})`);
      }
      // The create endpoint returns only the new id; synthesize the full record
      // from the input we sent so the UI can render it immediately (the next
      // list refresh replaces it with the server-normalized version).
      const newId = payload?.data?.id ?? payload?.id ?? Date.now().toString();
      return {
        id: String(newId),
        title: '',
        content: input.content || '',
        kind: input.kind || '',
        tags: Array.isArray(input.tags) ? input.tags : [],
        project: tagInfo.projectName || '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    },

    async update({ workingDirectory, id, input }) {
      const res = await memFetch(`/api/memories/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: input.content, tags: input.tags }),
      }, 120000);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload?.success === false) {
        throw new Error(payload?.error || `opencode-mem update failed (${res.status})`);
      }
      const tagInfo = await resolveProjectTagInfo(workingDirectory);
      return normalizeRecord(payload.data || payload.memory || { id, content: input.content, type: input.kind, projectName: tagInfo?.projectName });
    },

    async remove({ id }) {
      const res = await memFetch(`/api/memories/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || payload?.success === false) {
        throw new Error(payload?.error || `opencode-mem delete failed (${res.status})`);
      }
    },
  },
};
