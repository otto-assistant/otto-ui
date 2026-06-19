import os from 'os';
import path from 'path';
import fs from 'fs';
import { runCommand, commandExists } from '../exec.js';
import { hasPlugin, addPlugin, removePlugin } from '../opencode-config.js';
import { getMcpConfig, createMcpConfig, updateMcpConfig } from '../../opencode/mcp.js';
import { AGENT_SCOPE } from '../../opencode/shared.js';

const PLUGIN_NAME = '@codemem/opencode-plugin';
const MCP_NAME = 'codemem';
const CLI_PACKAGE = 'codemem@latest';

/**
 * Resolve the codemem CLI invocation. Prefer a globally-installed `codemem`
 * binary; otherwise fall back to `npx -y codemem@latest` (npx caches the
 * package after the first run).
 */
let cachedInvocation = null;
async function codememInvocation() {
  if (cachedInvocation) return cachedInvocation;
  if (await commandExists('codemem')) {
    cachedInvocation = { command: 'codemem', base: [] };
  } else {
    cachedInvocation = { command: 'npx', base: ['-y', CLI_PACKAGE] };
  }
  return cachedInvocation;
}

async function runCodemem(args, { cwd, timeoutMs = 90000, input } = {}) {
  const { command, base } = await codememInvocation();
  return runCommand(command, [...base, ...args], { cwd, timeoutMs, input });
}

function parseJsonLoose(stdout) {
  if (!stdout) return null;
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // codemem may print log lines before the JSON payload; recover the last
    // top-level JSON value.
    const start = trimmed.search(/[[{]/);
    if (start === -1) return null;
    try {
      return JSON.parse(trimmed.slice(start));
    } catch {
      return null;
    }
  }
}

function splitTags(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    return value.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean);
  }
  return [];
}

function normalizeRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id ?? raw.memoryId ?? raw.uuid ?? raw.hash;
  if (id === undefined || id === null) return null;
  const tags = splitTags(raw.tags_text ?? raw.tags);
  return {
    id: String(id),
    title: raw.title ?? raw.name ?? '',
    content: raw.body_text ?? raw.body ?? raw.content ?? raw.text ?? '',
    kind: raw.kind ?? raw.type ?? '',
    tags,
    project: raw.project ?? raw.projectName ?? raw.repo ?? '',
    createdAt: raw.createdAt ?? raw.created_at ?? raw.created ?? null,
    updatedAt: raw.updatedAt ?? raw.updated_at ?? raw.updated ?? null,
  };
}

function extractRecordArray(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.memories)) return payload.memories;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

function codememDataDir() {
  return process.env.CODEMEM_DB
    ? path.dirname(process.env.CODEMEM_DB)
    : path.join(os.homedir(), '.codemem');
}

export const codememAdapter = {
  id: 'codemem',
  name: 'codemem',
  tagline: 'Local-first memory companion for OpenCode (plugin + MCP)',
  description:
    'Captures what you work on across sessions and injects relevant context into every prompt. Stores everything in a local SQLite database with hybrid lexical + semantic search.',
  docsUrl: 'https://github.com/kunickiaj/codemem',
  integration: 'plugin+mcp',
  badges: ['local-first', 'sqlite', 'auto-inject', 'mcp'],
  requirements: [
    { id: 'node', label: 'Node.js (codemem recommends 24+; works on 22 with warnings)' },
    { id: 'network', label: 'Network access to npm for first-time download' },
  ],
  capabilities: {
    records: true,
    create: true,
    update: true,
    delete: true,
    search: true,
    projectScoped: true,
    configurable: false,
  },
  recordModel: { title: true, kind: true, tags: true },

  async detect({ workingDirectory }) {
    const active = hasPlugin(workingDirectory, PLUGIN_NAME)
      || (() => {
        const mcp = getMcpConfig(MCP_NAME, workingDirectory);
        return Boolean(mcp && mcp.enabled !== false);
      })();
    const dataDirExists = fs.existsSync(codememDataDir());
    const cliAvailable = await commandExists('codemem');
    const installed = active || dataDirExists || cliAvailable;
    return {
      installed,
      active,
      detail: active ? 'Plugin and MCP server registered in OpenCode config.' : (installed ? 'Installed but not active.' : 'Not installed.'),
      issues: [],
    };
  },

  async install({ workingDirectory }) {
    const steps = [];

    // Nuance: codemem's OpenCode *plugin* shells out to the `codemem` binary at
    // runtime, so the CLI must be resolvable on PATH for memory capture/injection
    // to work inside OpenCode. Ensure a global install first (best-effort — a
    // root-owned npm prefix can make this fail, in which case the user must
    // install it themselves; we surface that explicitly instead of silently
    // shipping a broken plugin).
    if (!(await commandExists('codemem'))) {
      try {
        const gi = await runCommand('npm', ['install', '-g', 'codemem@latest'], { timeoutMs: 180000 });
        const giOk = gi.code === 0 && (await commandExists('codemem'));
        steps.push({
          label: 'Install codemem CLI globally (required by the OpenCode plugin)',
          ok: giOk,
          detail: giOk
            ? 'codemem available on PATH.'
            : 'Could not install globally (likely an npm permissions issue). Run `npm install -g codemem` manually so the plugin can capture/inject memory.',
        });
      } catch (error) {
        steps.push({
          label: 'Install codemem CLI globally (required by the OpenCode plugin)',
          ok: false,
          detail: `Skipped: ${error.message}. Run \`npm install -g codemem\` manually.`,
        });
      }
    } else {
      steps.push({ label: 'codemem CLI already on PATH', ok: true });
    }

    // `codemem setup --opencode-only` registers BOTH the OpenCode plugin and
    // the MCP server in the user config.
    const result = await runCodemem(['setup', '--opencode-only', '--force'], {
      cwd: workingDirectory,
      timeoutMs: 180000,
    });
    const ok = result.code === 0;
    steps.push({
      label: 'Register codemem plugin + MCP server with OpenCode',
      ok,
      detail: ok ? 'codemem setup --opencode-only completed.' : (result.stderr || result.stdout || 'setup failed').trim().slice(-500),
    });
    if (!ok) {
      throw new Error(`codemem setup failed (exit ${result.code}): ${(result.stderr || result.stdout).trim().slice(-300)}`);
    }
    return { steps };
  },

  async activate({ workingDirectory }) {
    addPlugin(workingDirectory, PLUGIN_NAME, AGENT_SCOPE.USER);
    const mcp = getMcpConfig(MCP_NAME, workingDirectory);
    if (mcp) {
      if (mcp.enabled === false) {
        updateMcpConfig(MCP_NAME, { enabled: true }, workingDirectory);
      }
    } else {
      createMcpConfig(MCP_NAME, { type: 'local', command: ['npx', '-y', 'codemem', 'mcp'], enabled: true }, workingDirectory, AGENT_SCOPE.USER);
    }
    return { active: true };
  },

  async deactivate({ workingDirectory }) {
    removePlugin(workingDirectory, PLUGIN_NAME);
    const mcp = getMcpConfig(MCP_NAME, workingDirectory);
    if (mcp && mcp.enabled !== false) {
      updateMcpConfig(MCP_NAME, { enabled: false }, workingDirectory);
    }
    return { active: false };
  },

  records: {
    async available() {
      const cli = await commandExists('codemem');
      // npx fallback is always "available" given network; report which path.
      return { ok: true, reason: cli ? 'codemem CLI' : 'npx codemem' };
    },

    async list({ workingDirectory, project, query, limit = 100 }) {
      const args = query
        ? ['search', query, '--limit', String(limit), '-j']
        : ['recent', '--limit', String(limit), '-j'];
      if (project) {
        args.push('--project', project);
      }
      const result = await runCodemem(args, { cwd: workingDirectory });
      if (result.code !== 0) {
        throw new Error((result.stderr || result.stdout || 'codemem list failed').trim().slice(-300));
      }
      const payload = parseJsonLoose(result.stdout);
      return extractRecordArray(payload).map(normalizeRecord).filter(Boolean);
    },

    async create({ workingDirectory, project, input }) {
      const args = ['memory', 'remember', '-j'];
      args.push('-k', input.kind || 'discovery');
      if (input.title) args.push('-t', input.title);
      args.push('-b', input.content || '');
      if (Array.isArray(input.tags) && input.tags.length) {
        args.push('--tags', ...input.tags.map(String));
      }
      if (project) args.push('--project', project);
      const result = await runCodemem(args, { cwd: workingDirectory });
      if (result.code !== 0) {
        throw new Error((result.stderr || result.stdout || 'codemem remember failed').trim().slice(-300));
      }
      const payload = parseJsonLoose(result.stdout);
      const id = payload?.id ?? payload?.memory?.id ?? payload?.data?.id;
      // `memory remember -j` returns only the new id; synthesize the full record
      // from the input we just sent so the UI can render it immediately.
      return {
        id: id !== undefined && id !== null ? String(id) : Date.now().toString(),
        title: input.title || '',
        content: input.content || '',
        kind: input.kind || 'discovery',
        tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
        project: project || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },

    async update({ workingDirectory, project, id, input }) {
      // codemem has no in-place update; emulate by forgetting the old item and
      // remembering the new content. The id changes as a result.
      await this.remove({ workingDirectory, id });
      return this.create({ workingDirectory, project, input });
    },

    async remove({ workingDirectory, id }) {
      const result = await runCodemem(['memory', 'forget', String(id)], { cwd: workingDirectory });
      if (result.code !== 0) {
        throw new Error((result.stderr || result.stdout || 'codemem forget failed').trim().slice(-300));
      }
    },
  },
};
