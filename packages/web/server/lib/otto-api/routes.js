import express from 'express';
import fs from 'fs';
import path from 'path';
import { AGENT_DIR, readConfigLayers } from '../opencode/shared.js';
import {
  parseOttoJsonObject,
  readOttoCliVersion,
  runCommandAsync,
  runOttoCli,
  runOttoCliAsync,
  stripOttoLogLines,
} from './otto-cli.js';
import { getAllTasks, getTaskById, createTask, updateTask, deleteTask } from './task-store.js';
import { receiveExternalTask, handleDiscordTaskUpdate, notifyDiscordRelay } from './task-sync-bridge.js';

const memoryDiary = [];
const memoryEntities = new Map();
const memoryRelations = [];

const asNonEmptyString = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const pushDiaryLine = (line) => {
  memoryDiary.push({
    id: `mem_${memoryDiary.length + 1}`,
    text: line,
    createdAt: new Date().toISOString(),
  });
};

const collectDiskAgentNames = (workingDirectory) => {
  const names = new Set();
  const layers = readConfigLayers(workingDirectory || undefined);

  for (const cfg of [layers.projectConfig, layers.userConfig, layers.customConfig]) {
    const bucket = cfg && typeof cfg === 'object' ? cfg.agent : null;
    if (bucket && typeof bucket === 'object') {
      for (const key of Object.keys(bucket)) {
        names.add(key);
      }
    }
  }

  const harvestMarkdown = (dir) => {
    if (!dir || !fs.existsSync(dir)) {
      return;
    }
    const stack = [dir];
    while (stack.length > 0) {
      const current = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          names.add(entry.name.slice(0, -3));
        }
      }
    }
  };

  harvestMarkdown(AGENT_DIR);

  if (workingDirectory) {
    harvestMarkdown(path.join(workingDirectory, '.opencode', 'agents'));
    harvestMarkdown(path.join(workingDirectory, '.opencode', 'agent'));
  }

  return [...names].sort((a, b) => a.localeCompare(b));
};

const parsePipeDelimitedTasks = (lines) => {
  const headerIndex = lines.findIndex((line) => /^id\s*\|/i.test(line));
  if (headerIndex === -1) {
    return null;
  }

  const columns = lines[headerIndex].split('|').map((cell) => cell.trim());
  const tasks = [];

  for (const line of lines.slice(headerIndex + 1)) {
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length < 2) {
      continue;
    }

    const task = {};
    columns.forEach((column, index) => {
      if (!column) {
        return;
      }
      const value = cells[index] ?? '';
      task[column] = value === '-' ? null : value;
    });

    if (task.id) {
      tasks.push(task);
    }
  }

  return tasks;
};

const parseScheduledTasksPayload = (raw) => {
  const cleaned = stripOttoLogLines(raw);
  const lowered = cleaned.toLowerCase();

  const json = parseOttoJsonObject(raw);
  if (json && typeof json === 'object') {
    if (Array.isArray(json.tasks)) {
      return { tasks: json.tasks, source: 'otto-json', raw };
    }

    if (Array.isArray(json.items)) {
      return { tasks: json.items, source: 'otto-json', raw };
    }
  }

  if (lowered.includes('no scheduled tasks')) {
    return { tasks: [], source: 'otto-text', raw: cleaned };
  }

  const lines = cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { tasks: [], source: 'otto-none', raw: cleaned };
  }

  // `otto task list` prints a pipe-delimited table:
  // id | status | message | channelId | projectName | folderName | timeRemaining | firesAt | cron
  const tableTasks = parsePipeDelimitedTasks(lines);
  if (tableTasks) {
    return { tasks: tableTasks, source: 'otto-table', raw: cleaned };
  }

  return {
    tasks: [],
    source: 'otto-unparsed',
    notice: 'Unable to parse Otto task listing; upgrade Otto or inspect raw output.',
    raw: cleaned,
  };
};

const buildSendScheduledArgs = ({ prompt, sendAt, channelId, projectDirectory }) => {
  const args = ['send', '-p', prompt, '--send-at', sendAt];
  const channel = channelId?.trim();

  if (channel) {
    args.push('-c', channel);
  }

  const project = projectDirectory?.trim();
  if (project) {
    args.push('-d', project);
  }

  return args;
};

export const registerOttoApiRoutes = (app, dependencies) => {
  const {
    fetchAgentsSnapshot,
    getAgentConfig: getAgentConfigDep,
    updateAgent: updateAgentDep,
    refreshOpenCodeAfterConfigChange,
    clientReloadDelayMs,
    resolveOptionalProjectDirectory,
    resolveProjectDirectory,
    openchamberVersion,
    getRuntimeSlice,
  } = dependencies;

  const router = express.Router();

  // The shared request middleware in `core-routes.js` skips JSON body parsing
  // for `/api/*` paths that aren't on its allowlist (including `/api/otto/...`).
  // Mount our own parser here so create/update handlers (POST/PUT) see `req.body`.
  // Matches the convention already used by `discord-sync.js` and `messenger-sync.js`.
  router.use(express.json({ limit: '256kb' }));

  router.get('/status', (_req, res) => {
    const ottoVersion = readOttoCliVersion();

    try {
      const runtime = typeof getRuntimeSlice === 'function' ? getRuntimeSlice() : {};

      const health = {
        ottoCli: ottoVersion ? 'ok' : 'unavailable',
        openCode: runtime?.isOpenCodeReady ? 'ready' : 'not-ready',
      };

      return res.json({
        version: {
          openchamber: openchamberVersion || 'unknown',
          otto: ottoVersion,
        },
        uptime: {
          processSeconds: typeof process.uptime === 'function' ? process.uptime() : null,
          nodeVersion: typeof process.version === 'string' ? process.version : null,
        },
        health,
      });
    } catch (error) {
      console.error('[OttoAPI] Failed to assemble status:', error);
      return res.status(500).json({ error: 'Failed to build Otto status snapshot' });
    }
  });

  const extractSemver = (value) => {
    if (typeof value !== 'string') {
      return null;
    }
    const match = value.match(/\d+\.\d+\.\d+(?:[-+][\w.]+)?/);
    return match ? match[0] : null;
  };

  // Checks npm for a newer Otto CLI release (mirrors the Discord bot's
  // /upgrade-and-restart version check).
  router.get('/upgrade/check', async (_req, res) => {
    const installedRaw = readOttoCliVersion();
    const current = extractSemver(installedRaw);

    if (!current) {
      return res.status(503).json({
        current: null,
        latest: null,
        updateAvailable: false,
        error: 'Otto CLI is not installed or not on PATH',
      });
    }

    const { code, combined } = await runCommandAsync(
      'npm',
      ['view', '@otto-assistant/otto', 'version'],
      { timeoutMs: 20_000 },
    );

    const latest = code === 0 ? extractSemver(combined) : null;

    return res.json({
      current,
      latest,
      updateAvailable: Boolean(latest && latest !== current),
      ...(latest ? {} : { notice: 'Unable to determine latest published version' }),
    });
  });

  // Upgrades the Otto CLI to the latest release (web equivalent of the
  // Discord /upgrade-and-restart command).
  router.post('/upgrade', async (_req, res) => {
    const previousVersion = extractSemver(readOttoCliVersion());

    if (!previousVersion) {
      return res.status(503).json({
        ok: false,
        error: 'Otto CLI is not installed or not on PATH',
      });
    }

    const { code, combined } = await runOttoCliAsync(['upgrade'], { timeoutMs: 180_000 });

    if (code !== 0) {
      return res.status(500).json({
        ok: false,
        previousVersion,
        error: stripOttoLogLines(combined) || 'otto upgrade failed',
      });
    }

    const currentVersion = extractSemver(readOttoCliVersion()) ?? previousVersion;

    return res.json({
      ok: true,
      previousVersion,
      currentVersion,
      upgraded: currentVersion !== previousVersion,
      output: stripOttoLogLines(combined),
    });
  });

  router.get('/agents', async (req, res) => {
    try {
      const snapshot = await fetchAgentsSnapshot();

      const { directory } = await resolveOptionalProjectDirectory(req);
      const fallbackNames = collectDiskAgentNames(directory);
      const indexByName = new Map();

      if (Array.isArray(snapshot)) {
        for (const entry of snapshot) {
          const name =
            typeof entry?.name === 'string'
              ? entry.name.trim()
              : typeof entry?.id === 'string'
                ? entry.id.trim()
                : null;

          if (!name) {
            continue;
          }

          indexByName.set(name, { ...entry, name, source: 'opencode-runtime' });
        }
      }

      for (const name of fallbackNames) {
        if (indexByName.has(name)) {
          continue;
        }

        indexByName.set(name, {
          name,
          source: 'opencode-disk',
          config: getAgentConfigDep(name, directory || undefined),
        });
      }

      const agents = [...indexByName.values()].sort((a, b) => {
        const aName = typeof a.name === 'string' ? a.name : '';
        const bName = typeof b.name === 'string' ? b.name : '';
        return aName.localeCompare(bName);
      });

      return res.json({ agents, source: Array.isArray(snapshot) ? 'opencode-runtime' : 'unknown' });
    } catch {
      try {
        const { directory } = await resolveOptionalProjectDirectory(req);
        const names = collectDiskAgentNames(directory);
        const agents = names.map((name) => ({
          name,
          source: 'opencode-disk',
          config: getAgentConfigDep(name, directory || undefined),
        }));

        return res.json({ agents, source: 'opencode-disk-fallback' });
      } catch (error) {
        console.error('[OttoAPI] Failed to enumerate agents:', error);
        return res.status(500).json({ agents: [], error: 'Unable to enumerate agents without OpenCode' });
      }
    }
  });

  router.get('/agents/:name', async (req, res) => {
    const name = asNonEmptyString(req.params?.name ? decodeURIComponent(req.params.name) : null);
    if (!name) {
      return res.status(400).json({ error: 'agent name is required' });
    }

    try {
      const { directory, error } = await resolveOptionalProjectDirectory(req);
      const configPayload = getAgentConfigDep(name, directory || undefined);

      let runtimeMatch = null;
      try {
        const ocAgents = await fetchAgentsSnapshot();

        runtimeMatch =
          Array.isArray(ocAgents) ? ocAgents.find((entry) => entry?.name === name || entry?.id === name) : null;
      } catch {
        runtimeMatch = null;
      }

      if (error && !directory) {
        return res.status(400).json({ error });
      }

      if (configPayload.source === 'none' && !runtimeMatch) {
        return res.status(404).json({ error: `Agent "${name}" not found` });
      }

      const notice =
        directory
          ? null
          : 'Project directory headers are missing; returning user/global agent definitions only.';

      return res.json({
        name,
        directory,
        notice,
        config: configPayload,
        runtime: runtimeMatch,
      });
    } catch (error) {
      console.error('[OttoAPI] Failed to fetch agent:', error);
      return res.status(500).json({ error: 'Failed to load agent metadata' });
    }
  });

  router.put('/agents/:name', async (req, res) => {
    const name = asNonEmptyString(req.params?.name ? decodeURIComponent(req.params.name) : null);
    if (!name) {
      return res.status(400).json({ error: 'agent name is required' });
    }

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'JSON object body is required' });
    }

    try {
      const { directory, error } = await resolveProjectDirectory(req);

      if (!directory) {
        return res.status(400).json({ error: error || 'Project directory required to update agents' });
      }

      updateAgentDep(name, req.body, directory);
      await refreshOpenCodeAfterConfigChange('otto agent api update');

      return res.json({
        success: true,
        requiresReload: true,
        reloadDelayMs: clientReloadDelayMs,
        message: `Agent "${name}" updated via Otto API`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update agent';
      const statusCode = message.toLowerCase().includes('required')
        || message.toLowerCase().includes('missing')
        || message.toLowerCase().includes('invalid')
        ? 400
        : 500;

      if (statusCode === 500) {
        console.error('[OttoAPI] Failed to update agent:', error);
      }

      return res.status(statusCode).json({ error: message });
    }
  });

  const tasksListHandler = async (_req, res) => {
    return res.json({ tasks: getAllTasks(), source: 'task-store' });
  };

  router.get('/tasks', tasksListHandler);
  router.get('/schedule', tasksListHandler);

  const enqueueHandler = async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const title = asNonEmptyString(body.title || body.prompt);
    if (!title) {
      return res.status(400).json({ error: 'title (or prompt) is required' });
    }

    const task = createTask({
      title,
      description: body.description || '',
      owner: body.owner || body.ownerName || 'unknown',
      ownerType: body.ownerType || 'user',
      priority: body.priority || 'medium',
      dueAt: body.dueAt || body.dueDate || body.sendAt || null,
      source: body.source || 'web',
    });

    notifyDiscordRelay(task.id, 'task.create');

    return res.status(201).json({ ok: true, task });
  };

  router.post('/tasks', enqueueHandler);
  router.post('/schedule', enqueueHandler);

  const updateTaskHandler = async (req, res) => {
    const taskId = asNonEmptyString(req.params?.id);
    if (!taskId) {
      return res.status(400).json({ error: 'task id is required' });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const updated = updateTask(taskId, body);

    if (!updated) {
      return res.status(404).json({ error: `Task "${taskId}" not found` });
    }

    notifyDiscordRelay(updated.id, updated.status === 'done' ? 'task.complete' : 'task.update');

    return res.json({ ok: true, task: updated });
  };

  router.put('/tasks/:id', updateTaskHandler);
  router.put('/schedule/:id', updateTaskHandler);

  const deleteTaskHandler = async (req, res) => {
    const taskId = asNonEmptyString(req.params?.id);
    if (!taskId) {
      return res.status(400).json({ error: 'task id is required' });
    }

    const removed = deleteTask(taskId);
    if (!removed) {
      return res.status(404).json({ error: `Task "${taskId}" not found` });
    }

    return res.json({ ok: true, id: taskId });
  };

  router.delete('/tasks/:id', deleteTaskHandler);
  router.delete('/schedule/:id', deleteTaskHandler);

  // Discord relay bridge endpoint
  router.post('/tasks/sync', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (body.action === 'create') {
      const task = receiveExternalTask(body);
      return res.status(201).json({ ok: true, task });
    }
    if (body.action === 'update' && body.id) {
      const updated = handleDiscordTaskUpdate(body.id, body);
      if (!updated) return res.status(404).json({ error: 'Task not found' });
      return res.json({ ok: true, task: updated });
    }
    return res.status(400).json({ error: 'action (create|update) required' });
  });

  // Lists scheduled tasks managed by the Otto CLI (`otto send --send-at`),
  // mirroring the Discord /tasks command.
  router.get('/schedule/cli', async (req, res) => {
    const args = ['task', 'list'];
    if (req.query?.all === 'true' || req.query?.all === '1') {
      args.push('--all');
    }

    const { code, combined } = await runOttoCliAsync(args, { timeoutMs: 30_000 });

    if (code === null) {
      return res.status(503).json({
        tasks: [],
        source: 'otto-unavailable',
        error: 'Otto CLI is not installed or not on PATH',
      });
    }

    if (code !== 0) {
      return res.status(500).json({
        tasks: [],
        source: 'otto-error',
        error: stripOttoLogLines(combined) || 'otto task list failed',
      });
    }

    return res.json(parseScheduledTasksPayload(combined));
  });

  // Schedules a one-shot or cron prompt through the Otto CLI
  // (web equivalent of `otto send --send-at`).
  router.post('/schedule/cli', async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const prompt = asNonEmptyString(body.prompt || body.title);
    const sendAt = asNonEmptyString(body.sendAt || body.dueAt);

    if (!prompt || !sendAt) {
      return res.status(400).json({ error: 'prompt and sendAt are required' });
    }

    const args = buildSendScheduledArgs({
      prompt,
      sendAt,
      channelId: typeof body.channelId === 'string' ? body.channelId : undefined,
      projectDirectory: typeof body.projectDirectory === 'string' ? body.projectDirectory : undefined,
    });

    const { code, combined } = await runOttoCliAsync(args, { timeoutMs: 60_000 });

    if (code === null) {
      return res.status(503).json({
        ok: false,
        error: 'Otto CLI is not installed or not on PATH',
      });
    }

    if (code !== 0) {
      return res.status(500).json({
        ok: false,
        error: stripOttoLogLines(combined) || 'otto send --send-at failed',
      });
    }

    return res.status(201).json({ ok: true, output: stripOttoLogLines(combined) });
  });

  // Cancels a scheduled Otto CLI task (mirrors the Delete button on /tasks).
  router.delete('/schedule/cli/:id', async (req, res) => {
    const taskId = asNonEmptyString(req.params?.id);
    if (!taskId) {
      return res.status(400).json({ error: 'task id is required' });
    }

    const { code, combined } = await runOttoCliAsync(['task', 'delete', taskId], { timeoutMs: 30_000 });

    if (code === null) {
      return res.status(503).json({
        ok: false,
        error: 'Otto CLI is not installed or not on PATH',
      });
    }

    if (code !== 0) {
      return res.status(500).json({
        ok: false,
        error: stripOttoLogLines(combined) || 'otto task delete failed',
      });
    }

    return res.json({ ok: true, id: taskId });
  });

  router.get('/memory/search', (req, res) => {
    const query = asNonEmptyString(typeof req.query?.q === 'string' ? req.query.q : null);
    if (!query) {
      return res.status(400).json({ error: 'q query parameter is required' });
    }

    const rawLimit = typeof req.query?.limit === 'string' ? Number.parseInt(req.query.limit, 10) : 20;
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 20;

    const args = ['session', 'search', query, '--json', '--limit', String(limit)];

    if (typeof req.query?.project === 'string' && req.query.project.trim().length > 0) {
      args.push('--project', req.query.project.trim());
    } else if (typeof req.query?.cwd === 'string' && req.query.cwd.trim().length > 0) {
      args.push('--project', req.query.cwd.trim());
    }

    const { code, combined } = runOttoCli(args, {
      cwd: typeof req.query?.cwd === 'string' ? req.query.cwd : undefined,
    });

    const payload = parseOttoJsonObject(combined);

    if (!payload || typeof payload !== 'object') {
      return res.status(code === 0 ? 200 : 500).json({
        query,
        limit,
        results: [],
        source: code === 0 ? 'otto-unparsed' : 'otto-error',
        error: stripOttoLogLines(combined) || 'Unable to parse Otto session search output',
      });
    }

    return res.json({
      ...payload,
      source: 'otto-session-search',
      limit,
    });
  });

  router.get('/memory/graph', (_req, res) =>
    res.json({
      entities: [...memoryEntities.values()],
      relations: memoryRelations.slice(),
      source: 'local-knowledge-cache',
      ...(memoryEntities.size === 0
        ? { notice: 'No graph data yet; POST facts to hydrate this view.' }
        : {}),
    }));

  router.get('/memory/diary', (_req, res) =>
    res.json({
      entries: memoryDiary.slice(),
      source: 'local-session-cache',
    }));

  router.post('/memory/facts', (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'JSON body with subject/predicate/object is required' });
    }

    const { subject: rawSubject, predicate: rawPredicate, object: rawObject } = req.body;
    const subject = asNonEmptyString(typeof rawSubject === 'string' ? rawSubject : null);
    const predicate = asNonEmptyString(typeof rawPredicate === 'string' ? rawPredicate : null);
    const objectEntity = asNonEmptyString(typeof rawObject === 'string' ? rawObject : null);

    if (!subject || !predicate || !objectEntity) {
      return res.status(400).json({ error: 'subject, predicate, and object strings are required' });
    }

    const subjectId =
      typeof req.body.subjectId === 'string' && req.body.subjectId.trim().length > 0
        ? req.body.subjectId.trim()
        : `entity_${subject}`;
    const objectId =
      typeof req.body.objectId === 'string' && req.body.objectId.trim().length > 0
        ? req.body.objectId.trim()
        : `entity_${objectEntity}`;

    const subjectMeta = typeof req.body.subjectMeta === 'object' && req.body.subjectMeta !== null
      ? req.body.subjectMeta
      : {};

    memoryEntities.set(subjectId, {
      id: subjectId,
      label: subject,
      ...subjectMeta,
    });

    memoryEntities.set(objectId, {
      id: objectId,
      label: objectEntity,
    });

    const relationRecord = {
      id: `rel_${memoryRelations.length + 1}`,
      subject: subjectId,
      predicate,
      object: objectId,
      createdAt: new Date().toISOString(),
    };

    memoryRelations.push(relationRecord);
    pushDiaryLine(`${subject} -(${predicate})-> ${objectEntity}`);

    return res.status(201).json({
      ok: true,
      fact: relationRecord,
      diaryEntry: memoryDiary[memoryDiary.length - 1],
      graph: {
        entities: [...memoryEntities.values()],
        relations: memoryRelations.slice(),
      },
      source: 'local-knowledge-cache',
    });
  });

  app.use('/api/otto', router);
};
