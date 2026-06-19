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

function modelReady() {
  // Transformers.js caches the embedding model under ~/.cache or the palace
  // dir; treat presence of the palace knowledge graph or a cached model as
  // "ready enough" to attempt record operations.
  return fs.existsSync(path.join(palaceDir(), 'knowledge_graph.sqlite3'))
    || fs.existsSync(path.join(palaceDir(), 'models'))
    || fs.existsSync(path.join(os.homedir(), '.cache', 'huggingface'));
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
    _triple: { subject, predicate, object },
  };
}

function parseTriplesFromText(text) {
  if (!text) return [];
  // mempalace tools return JSON or human text depending on version; try JSON.
  try {
    const parsed = JSON.parse(text);
    const arr = Array.isArray(parsed) ? parsed : (parsed.triples || parsed.results || parsed.entities || []);
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
    if (active && !modelReady()) {
      issues.push('Embedding model not downloaded yet — run install again or the first search may be slow.');
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
      if (!modelReady()) {
        return { ok: false, reason: 'Embedding model not downloaded yet — run install to pre-download.' };
      }
      return { ok: true, reason: 'MCP knowledge graph' };
    },

    async list({ query }) {
      return withMempalace(async ({ callTool }) => {
        const toolName = query ? 'mempalace_search' : 'mempalace_kg_stats';
        if (query) {
          const result = await callTool('mempalace_search', { query });
          return parseTriplesFromText(mcpResultText(result));
        }
        // Without a query, surface graph stats as a single informational record
        // plus any timeline entries the server can produce.
        const result = await callTool(toolName, {});
        const text = mcpResultText(result);
        const triples = parseTriplesFromText(text);
        if (triples.length) return triples;
        return text
          ? [{ id: 'kg-stats', title: 'Knowledge graph', content: text, kind: 'stats', tags: [], project: '' }]
          : [];
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
