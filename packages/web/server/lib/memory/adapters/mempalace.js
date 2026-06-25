import os from 'os';
import path from 'path';
import fs from 'fs';
import { runCommand } from '../exec.js';
import { withMcpStdio, mcpResultText } from '../mcp-stdio.js';
import { getMcpConfig, createMcpConfig, updateMcpConfig } from '../../opencode/mcp.js';
import { AGENT_SCOPE } from '../../opencode/shared.js';

const MCP_NAME = 'mempalace';
const JS_MCP_COMMAND = ['npx', '-y', '@mempalace/core', 'mcp'];
const PY_MCP_COMMAND = ['python3', '-m', 'mempalace.mcp_server'];

function palaceDir() {
  return process.env.MEMPALACE_PATH || path.join(os.homedir(), '.mempalace');
}

function palaceInitialized() {
  const root = palaceDir();
  const palacePath = path.join(root, 'palace');
  // Python mempalace (Chroma) and JS mempalace (LanceDB) use different stores.
  return fs.existsSync(path.join(palacePath, 'chroma.sqlite3'))
    || fs.existsSync(path.join(palacePath, 'lancedb'))
    || fs.existsSync(path.join(palacePath, 'knowledge_graph.sqlite3'))
    || fs.existsSync(path.join(root, 'knowledge_graph.sqlite3'))
    || fs.existsSync(root);
}

async function pythonMempalaceAvailable() {
  try {
    const res = await runCommand('python3', ['-c', 'import mempalace.mcp_server'], { timeoutMs: 8000 });
    return res.code === 0;
  } catch {
    return false;
  }
}

function resolveMcpCommand(workingDirectory) {
  const mcp = getMcpConfig(MCP_NAME, workingDirectory);
  if (mcp?.command?.length) return mcp.command;
  return JS_MCP_COMMAND;
}

async function withMempalace(workingDirectory, run) {
  const command = resolveMcpCommand(workingDirectory);
  return withMcpStdio(command[0], command.slice(1), run, { timeoutMs: 120000 });
}

// MemPalace "records" are drawers: the verbatim notes/memories filed into a
// wing -> room taxonomy. We surface them as canonical records. Drawer ids have
// the form `drawer_<wing>_<room>_<hash>` so wing/room can be recovered for
// edits (in-place update on Python server, delete+re-add on JS).
const DEFAULT_WING = 'notes';
const DEFAULT_ROOM = 'general';
const LIST_ALL_QUERY = 'memory note knowledge fact';
const LIST_LIMIT = 200;

function drawerToRecord(drawer) {
  if (!drawer || typeof drawer !== 'object') return null;
  const id = drawer.id ?? drawer.drawer_id;
  if (!id) return null;
  const wing = drawer.wing ?? '';
  const room = drawer.room ?? '';
  const location = [wing, room].filter(Boolean).join('/');
  const preview = drawer.content_preview;
  const content = drawer.content ?? drawer.text ?? preview ?? '';
  const fromPreview = Boolean(preview && !drawer.content && !drawer.text);
  const meta = drawer.metadata && typeof drawer.metadata === 'object' ? drawer.metadata : {};
  return {
    id: String(id),
    title: room || wing || '',
    content,
    kind: location,
    tags: [],
    project: wing,
    wing,
    room,
    createdAt: drawer.filedAt ?? drawer.filed_at ?? meta.filed_at ?? drawer.created_at ?? drawer.createdAt ?? null,
    updatedAt: null,
    truncated: fromPreview,
  };
}

/** Recover { wing, room } from a `drawer_<wing>_<room>_<hash>` id. */
function locationFromId(id) {
  const parts = String(id).split('_');
  if (parts[0] === 'drawer' && parts.length >= 4) {
    return { wing: parts[1] || DEFAULT_WING, room: parts[2] || DEFAULT_ROOM };
  }
  return { wing: DEFAULT_WING, room: DEFAULT_ROOM };
}

function parseMcpPayload(result) {
  if (result?.isError) {
    const text = mcpResultText(result);
    throw new Error(text || 'MemPalace MCP tool failed');
  }
  const text = mcpResultText(result);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && typeof parsed.error === 'string' && parsed.error) {
      throw new Error(parsed.error);
    }
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) return text;
    throw error;
  }
}

function parseDrawersFromPayload(payload) {
  if (!payload) return [];
  const arr = Array.isArray(payload)
    ? payload
    : (payload.results || payload.drawers || []);
  return arr
    .map((d) => {
      if (d && typeof d === 'object') delete d.vector;
      return d;
    })
    .map(drawerToRecord)
    .filter(Boolean);
}

function filterRecordsByQuery(records, query) {
  const needle = query?.trim();
  if (!needle) return records;
  const lower = needle.toLowerCase();
  return records.filter((record) => (record.content || '').toLowerCase().includes(lower));
}

function isMissingTableError(message) {
  return /table ['"]?mempalace_drawers['"]? was not found/i.test(message)
    || /dataset at path .*mempalace_drawers\.lance was not found/i.test(message);
}

async function mapWithConcurrency(items, limit, mapper) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}

async function enrichDrawer(callTool, record) {
  if (!record?.id) return record;
  const result = await callTool('mempalace_get_drawer', { drawer_id: record.id });
  const payload = parseMcpPayload(result);
  if (!payload || typeof payload !== 'object') return record;
  const wing = payload.wing || record.wing || record.project || '';
  const room = payload.room || record.room || '';
  const meta = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
  return drawerToRecord({
    drawer_id: payload.drawer_id || record.id,
    wing,
    room,
    content: payload.content ?? record.content,
    filed_at: meta.filed_at ?? meta.created_at ?? record.createdAt,
    metadata: meta,
  }) || record;
}

async function enrichDrawerRecords(callTool, records) {
  return mapWithConcurrency(records, 8, (record) => enrichDrawer(callTool, record));
}

async function listDrawers(callTool, listTools, { query, wing, room, limit = LIST_LIMIT }) {
  const tools = await listTools();
  const names = new Set(tools.map((tool) => tool.name));
  const canFetchFull = names.has('mempalace_get_drawer');

  const records = [];
  let offset = 0;
  const pageSize = Math.min(100, limit);

  while (records.length < limit) {
    const args = { limit: pageSize, offset };
    if (wing) args.wing = wing;
    if (room) args.room = room;
    const result = await callTool('mempalace_list_drawers', args);
    const payload = parseMcpPayload(result);
    const batch = parseDrawersFromPayload(payload);
    if (!batch.length) break;
    records.push(...batch);
    if (batch.length < pageSize) break;
    offset += batch.length;
  }

  let enriched = records.slice(0, limit);
  if (canFetchFull && enriched.some((record) => record.truncated || (record.content || '').endsWith('...'))) {
    enriched = await enrichDrawerRecords(callTool, enriched);
  }

  return filterRecordsByQuery(enriched, query);
}

async function listRecords(callTool, listTools, { query, wing, room }) {
  const tools = await listTools();
  const names = new Set(tools.map((tool) => tool.name));
  if (names.has('mempalace_list_drawers')) {
    return listDrawers(callTool, listTools, { query, wing, room, limit: LIST_LIMIT });
  }

  const result = await callTool('mempalace_search', {
    query: query && query.trim() ? query.trim() : LIST_ALL_QUERY,
    limit: LIST_LIMIT,
    ...(wing ? { wing } : {}),
    ...(room ? { room } : {}),
  });
  let records = parseDrawersFromPayload(parseMcpPayload(result));
  if (names.has('mempalace_get_drawer') && records.length) {
    records = await enrichDrawerRecords(callTool, records);
  }
  return filterRecordsByQuery(records, query);
}

async function preferredInstallCommand() {
  if (await pythonMempalaceAvailable()) return PY_MCP_COMMAND;
  return JS_MCP_COMMAND;
}

export const mempalaceAdapter = {
  id: 'mempalace',
  name: 'MemPalace',
  tagline: 'Zero-LLM memory palace: notes filed into wings & rooms (MCP server)',
  description:
    'A local-first memory palace that stores verbatim notes ("drawers") organized into a wing/room taxonomy, with embedded vector search (LanceDB) and a temporal knowledge graph, exposed over MCP.',
  docsUrl: 'https://github.com/adshaa/mempalacejs',
  integration: 'mcp',
  badges: ['local-first', 'notes', 'vector', 'mcp', 'zero-llm'],
  requirements: [
    { id: 'network', label: 'Network access to npm + a ~90MB embedding model download on first use (JS server)' },
    { id: 'node', label: 'Python mempalace (pip) or @mempalace/core (npx) MCP server' },
  ],
  capabilities: {
    records: true,
    create: true,
    update: true,
    delete: true,
    search: true,
    projectScoped: false,
    configurable: false,
  },
  recordModel: { title: false, kind: false, tags: false },

  async detect({ workingDirectory }) {
    const mcp = getMcpConfig(MCP_NAME, workingDirectory);
    const active = Boolean(mcp && mcp.enabled !== false);
    const installed = Boolean(mcp) || fs.existsSync(palaceDir()) || await pythonMempalaceAvailable();
    const issues = [];
    if (active && !palaceInitialized()) {
      issues.push('Palace not initialized yet — run mempalace init/mine or add your first record.');
    }
    if (active && mcp?.command?.join(' ') === JS_MCP_COMMAND.join(' ') && await pythonMempalaceAvailable()) {
      issues.push('Python mempalace is installed but the MCP entry points at @mempalace/core — reinstall to use the Python server with your existing palace.');
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
    const installCommand = await preferredInstallCommand();
    const mcp = getMcpConfig(MCP_NAME, workingDirectory);
    if (mcp) {
      if (mcp.enabled === false) updateMcpConfig(MCP_NAME, { enabled: true }, workingDirectory);
      const current = mcp.command?.join(' ');
      const desired = installCommand.join(' ');
      if (current !== desired) {
        updateMcpConfig(MCP_NAME, { type: 'local', command: installCommand, enabled: true }, workingDirectory);
        steps.push({ label: 'Point mempalace MCP at the installed server', ok: true, detail: desired });
      } else {
        steps.push({ label: 'Use existing mempalace MCP entry', ok: true });
      }
    } else {
      createMcpConfig(MCP_NAME, { type: 'local', command: installCommand, enabled: true }, workingDirectory, AGENT_SCOPE.USER);
      steps.push({ label: 'Register mempalace MCP server', ok: true, detail: installCommand.join(' ') });
    }

    if (installCommand === JS_MCP_COMMAND) {
      try {
        const res = await runCommand('npx', ['-y', '@mempalace/core', 'setup'], { timeoutMs: 240000 });
        steps.push({
          label: 'Pre-download embedding model (mempalace setup)',
          ok: res.code === 0,
          detail: res.code === 0 ? 'Model cached.' : 'Will download lazily on first use.',
        });
      } catch {
        steps.push({
          label: 'Pre-download embedding model (mempalace setup)',
          ok: false,
          detail: 'Skipped — model downloads lazily on first use.',
        });
      }
    } else {
      steps.push({
        label: 'Use Python mempalace MCP server',
        ok: true,
        detail: installCommand.join(' '),
      });
    }
    return { steps };
  },

  async activate({ workingDirectory }) {
    const mcp = getMcpConfig(MCP_NAME, workingDirectory);
    const installCommand = await preferredInstallCommand();
    if (mcp) {
      if (mcp.enabled === false) updateMcpConfig(MCP_NAME, { enabled: true }, workingDirectory);
      const current = mcp.command?.join(' ');
      const desired = installCommand.join(' ');
      if (current !== desired) {
        updateMcpConfig(MCP_NAME, { type: 'local', command: installCommand, enabled: true }, workingDirectory);
      }
    } else {
      createMcpConfig(MCP_NAME, { type: 'local', command: installCommand, enabled: true }, workingDirectory, AGENT_SCOPE.USER);
    }
    return { active: true };
  },

  async deactivate({ workingDirectory }) {
    const mcp = getMcpConfig(MCP_NAME, workingDirectory);
    if (mcp && mcp.enabled !== false) updateMcpConfig(MCP_NAME, { enabled: false }, workingDirectory);
    return { active: false };
  },

  records: {
    async available() {
      // The MCP server is always launchable via npx; drawer search lazily
      // downloads the embedding model on first use.
      return { ok: true, reason: 'MemPalace drawers' };
    },

    async list({ workingDirectory, query }) {
      try {
        return await withMempalace(workingDirectory, async ({ callTool, listTools }) => {
          return listRecords(callTool, listTools, { query });
        });
      } catch (error) {
        if (isMissingTableError(error.message || '')) {
          return [];
        }
        throw error;
      }
    },

    async create({ workingDirectory, input }) {
      const content = (input.content || '').trim();
      if (!content) throw new Error('A note (content) is required.');
      return withMempalace(workingDirectory, async ({ callTool }) => {
        const res = await callTool('mempalace_add_drawer', {
          wing: DEFAULT_WING,
          room: DEFAULT_ROOM,
          content,
        });
        const payload = parseMcpPayload(res);
        const id = payload?.id ?? payload?.drawer_id;
        return {
          id: String(id || `drawer_${DEFAULT_WING}_${DEFAULT_ROOM}_${Date.now()}`),
          title: '',
          content,
          kind: `${DEFAULT_WING}/${DEFAULT_ROOM}`,
          tags: [],
          project: DEFAULT_WING,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
      });
    },

    async update({ workingDirectory, id, input }) {
      const content = (input.content || '').trim();
      return withMempalace(workingDirectory, async ({ callTool, listTools }) => {
        const tools = await listTools();
        const hasUpdate = tools.some((tool) => tool.name === 'mempalace_update_drawer');
        if (hasUpdate) {
          const { wing, room } = locationFromId(id);
          const res = await callTool('mempalace_update_drawer', {
            drawer_id: String(id),
            content,
            wing,
            room,
          });
          const payload = parseMcpPayload(res);
          if (payload?.success === false) {
            throw new Error(payload.error || 'Failed to update drawer');
          }
          return {
            id: String(payload?.drawer_id || id),
            title: '',
            content,
            kind: `${wing}/${room}`,
            tags: [],
            project: wing,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
        }

        const { wing, room } = locationFromId(id);
        try { await callTool('mempalace_delete_drawer', { id: String(id) }); } catch { /* may already be gone */ }
        const res = await callTool('mempalace_add_drawer', { wing, room, content });
        const payload = parseMcpPayload(res);
        const newId = payload?.id ?? payload?.drawer_id;
        return {
          id: String(newId || id),
          title: '',
          content,
          kind: `${wing}/${room}`,
          tags: [],
          project: wing,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
      });
    },

    async remove({ workingDirectory, id }) {
      if (!id) throw new Error('Invalid mempalace drawer id');
      return withMempalace(workingDirectory, async ({ callTool }) => {
        const res = await callTool('mempalace_delete_drawer', { drawer_id: String(id), id: String(id) });
        parseMcpPayload(res);
      });
    },
  },
};

export const __test = {
  drawerToRecord,
  parseDrawersFromPayload,
  filterRecordsByQuery,
  parseMcpPayload,
  isMissingTableError,
  resolveMcpCommand,
};
