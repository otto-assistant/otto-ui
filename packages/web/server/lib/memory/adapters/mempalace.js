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

/**
 * Records in mempalace are temporal knowledge-graph triples
 * (subject -> predicate -> object). We render them as canonical records where
 * `content` is the "subject predicate object" sentence and the predicate is
 * surfaced as `kind`.
 */
function tripleToRecord(triple) {
  if (!triple || typeof triple !== 'object') return null;
  const subject = triple.subject ?? triple.subName ?? triple.s ?? '';
  const predicate = triple.predicate ?? triple.p ?? '';
  const object = triple.object ?? triple.objName ?? triple.o ?? '';
  const id = triple.id ?? `${subject}|${predicate}|${object}`;
  return {
    id: String(id),
    title: subject,
    content: [subject, predicate, object].filter(Boolean).join(' '),
    kind: predicate,
    tags: [],
    project: '',
    createdAt: triple.validFrom ?? triple.valid_from ?? null,
    updatedAt: triple.validTo ?? triple.valid_to ?? null,
    _current: triple.current,
    _triple: { subject, predicate, object },
  };
}

function parseTriplesFromText(text) {
  if (!text) return [];
  // mempalace tools return JSON in several shapes depending on the tool:
  //  - an array of triples
  //  - { triples: [...] } / { results: [...] }
  //  - an index-keyed object { "0": {...}, "1": {...} } (kg_timeline)
  try {
    const parsed = JSON.parse(text);
    let arr;
    if (Array.isArray(parsed)) {
      arr = parsed;
    } else if (Array.isArray(parsed.triples) || Array.isArray(parsed.results) || Array.isArray(parsed.entities)) {
      arr = parsed.triples || parsed.results || parsed.entities;
    } else if (parsed && typeof parsed === 'object') {
      arr = Object.values(parsed).filter((v) => v && typeof v === 'object');
    } else {
      arr = [];
    }
    return arr.map(tripleToRecord).filter(Boolean);
  } catch {
    return [];
  }
}

export const mempalaceAdapter = {
  id: 'mempalace',
  name: 'MemPalace',
  tagline: 'Zero-LLM temporal knowledge-graph memory (MCP server)',
  description:
    'A local-first memory palace exposing a temporal knowledge graph (SQLite) and embedded vector search (LanceDB) over MCP. Stores facts as triples with validity ranges.',
  docsUrl: 'https://github.com/adshaa/mempalacejs',
  integration: 'mcp',
  badges: ['local-first', 'knowledge-graph', 'vector', 'mcp', 'zero-llm'],
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
  recordModel: { title: true, kind: true, tags: false, triple: true },

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
      // KG add/list/stats only need the MCP server, which npx can always
      // launch. Semantic search lazily downloads the embedding model.
      return { ok: true, reason: 'MCP knowledge graph' };
    },

    async list({ query }) {
      return withMempalace(async ({ callTool }) => {
        // kg_timeline with no entity returns every triple in the graph. We list
        // current (non-invalidated) facts and filter client-side for queries so
        // search reliably covers the knowledge graph (vector search only covers
        // mined drawers, not manually-added facts).
        const result = await callTool('mempalace_kg_timeline', {});
        let triples = parseTriplesFromText(mcpResultText(result)).filter((t) => t._current !== false);
        if (query) {
          const q = query.toLowerCase();
          triples = triples.filter((t) => t.content.toLowerCase().includes(q));
        }
        // Strip internal fields before returning.
        return triples.map(({ _current, _triple, ...rest }) => ({ ...rest, _triple }));
      });
    },

    async create({ input }) {
      // Expect input.content as "subject | predicate | object" or use the
      // structured fields if provided.
      let { subject, predicate, object } = input.triple || {};
      if (!subject && typeof input.content === 'string' && input.content.includes('|')) {
        [subject, predicate, object] = input.content.split('|').map((s) => s.trim());
      }
      if (!subject || !predicate || !object) {
        throw new Error('MemPalace records are facts. Provide subject, predicate and object (or "subject | predicate | object").');
      }
      return withMempalace(async ({ callTool }) => {
        await callTool('mempalace_kg_add', { subject, predicate, object });
        return tripleToRecord({ subject, predicate, object });
      });
    },

    async update({ id, input }) {
      await this.remove({ id });
      return this.create({ input });
    },

    async remove({ id }) {
      const [subject, predicate, object] = String(id).split('|');
      if (!subject) throw new Error('Invalid mempalace record id');
      return withMempalace(async ({ callTool }) => {
        await callTool('mempalace_kg_invalidate', { subject, predicate, object });
      });
    },
  },
};
