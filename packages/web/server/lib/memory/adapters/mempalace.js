import os from 'os';
import path from 'path';
import fs from 'fs';
import { runCommand } from '../exec.js';
import { withMcpStdio, mcpResultText } from '../mcp-stdio.js';
import { getMcpConfig, createMcpConfig, updateMcpConfig } from '../../opencode/mcp.js';
import { AGENT_SCOPE } from '../../opencode/shared.js';

const MCP_NAME = 'mempalace';
const MCP_COMMAND = ['npx', '-y', '@mempalace/core', 'mcp'];

function palaceDir() {
  return process.env.MEMPALACE_PATH || path.join(os.homedir(), '.mempalace');
}

function palaceInitialized() {
  // The MCP server initializes a palace under ~/.mempalace/palace on first run.
  // Knowledge-graph operations (add/query/stats) do not need the embedding
  // model — only semantic (vector) search does — so palace presence is enough
  // to enable record management.
  return fs.existsSync(path.join(palaceDir(), 'palace', 'knowledge_graph.sqlite3'))
    || fs.existsSync(path.join(palaceDir(), 'knowledge_graph.sqlite3'))
    || fs.existsSync(palaceDir());
}

async function withMempalace(run) {
  return withMcpStdio(MCP_COMMAND[0], MCP_COMMAND.slice(1), run, { timeoutMs: 120000 });
}

// MemPalace "records" are drawers: the verbatim notes/memories filed into a
// wing -> room taxonomy. We surface them as canonical records. Drawer ids have
// the form `drawer_<wing>_<room>_<hash>` so wing/room can be recovered for
// edits (which are delete+re-add, since drawers have no in-place update tool).
const DEFAULT_WING = 'notes';
const DEFAULT_ROOM = 'general';
// Semantic search returns every drawer up to `limit` (ranked), so a broad query
// with a high limit acts as "list all".
const LIST_ALL_QUERY = 'memory note knowledge fact';
const LIST_LIMIT = 200;

function drawerToRecord(drawer) {
  if (!drawer || typeof drawer !== 'object') return null;
  const id = drawer.id;
  if (!id) return null;
  const wing = drawer.wing ?? '';
  const room = drawer.room ?? '';
  const location = [wing, room].filter(Boolean).join('/');
  return {
    id: String(id),
    title: '',
    content: drawer.content ?? drawer.text ?? '',
    kind: location,
    tags: [],
    project: wing,
    createdAt: drawer.filedAt ?? drawer.created_at ?? null,
    updatedAt: null,
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

function parseDrawersFromText(text) {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    const arr = Array.isArray(parsed) ? parsed : (parsed.results || parsed.drawers || []);
    // Drop the heavy embedding vectors before returning.
    return arr.map((d) => { if (d && typeof d === 'object') delete d.vector; return d; })
      .map(drawerToRecord)
      .filter(Boolean);
  } catch {
    return [];
  }
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
    { id: 'network', label: 'Network access to npm + a ~90MB embedding model download on first use' },
    { id: 'node', label: 'Native better-sqlite3 (runs under Node; pre-download model with mempalace setup)' },
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
    const installed = Boolean(mcp) || fs.existsSync(palaceDir());
    const issues = [];
    if (active && !palaceInitialized()) {
      issues.push('Palace not initialized yet — the first semantic search may download a ~90MB embedding model.');
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
    const mcp = getMcpConfig(MCP_NAME, workingDirectory);
    if (mcp) {
      if (mcp.enabled === false) updateMcpConfig(MCP_NAME, { enabled: true }, workingDirectory);
      steps.push({ label: 'Use existing mempalace MCP entry', ok: true });
    } else {
      createMcpConfig(MCP_NAME, { type: 'local', command: MCP_COMMAND, enabled: true }, workingDirectory, AGENT_SCOPE.USER);
      steps.push({ label: 'Register mempalace MCP server', ok: true, detail: MCP_COMMAND.join(' ') });
    }
    // Best-effort model pre-download so the first search isn't a multi-minute
    // stall. Tolerate failure/timeout; the model also downloads lazily.
    try {
      const res = await runCommand('npx', ['-y', '@mempalace/core', 'setup'], { timeoutMs: 240000 });
      steps.push({ label: 'Pre-download embedding model (mempalace setup)', ok: res.code === 0, detail: res.code === 0 ? 'Model cached.' : 'Will download lazily on first use.' });
    } catch {
      steps.push({ label: 'Pre-download embedding model (mempalace setup)', ok: false, detail: 'Skipped — model downloads lazily on first use.' });
    }
    return { steps };
  },

  async activate({ workingDirectory }) {
    const mcp = getMcpConfig(MCP_NAME, workingDirectory);
    if (mcp) {
      if (mcp.enabled === false) updateMcpConfig(MCP_NAME, { enabled: true }, workingDirectory);
    } else {
      createMcpConfig(MCP_NAME, { type: 'local', command: MCP_COMMAND, enabled: true }, workingDirectory, AGENT_SCOPE.USER);
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

    async list({ query }) {
      // Drawers are the notes filed in the palace. Semantic search returns every
      // drawer up to `limit` (ranked), so a broad query lists them all; a real
      // query ranks by relevance.
      return withMempalace(async ({ callTool }) => {
        const result = await callTool('mempalace_search', {
          query: query && query.trim() ? query.trim() : LIST_ALL_QUERY,
          limit: LIST_LIMIT,
        });
        return parseDrawersFromText(mcpResultText(result));
      });
    },

    async create({ input }) {
      const content = (input.content || '').trim();
      if (!content) throw new Error('A note (content) is required.');
      return withMempalace(async ({ callTool }) => {
        const res = await callTool('mempalace_add_drawer', {
          wing: DEFAULT_WING,
          room: DEFAULT_ROOM,
          content,
        });
        let id;
        try { id = JSON.parse(mcpResultText(res))?.id; } catch { /* ignore */ }
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

    async update({ id, input }) {
      // Drawers have no in-place edit; recreate in the same wing/room.
      const { wing, room } = locationFromId(id);
      const content = (input.content || '').trim();
      return withMempalace(async ({ callTool }) => {
        try { await callTool('mempalace_delete_drawer', { id: String(id) }); } catch { /* may already be gone */ }
        const res = await callTool('mempalace_add_drawer', { wing, room, content });
        let newId;
        try { newId = JSON.parse(mcpResultText(res))?.id; } catch { /* ignore */ }
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

    async remove({ id }) {
      if (!id) throw new Error('Invalid mempalace drawer id');
      return withMempalace(async ({ callTool }) => {
        await callTool('mempalace_delete_drawer', { id: String(id) });
      });
    },
  },
};
