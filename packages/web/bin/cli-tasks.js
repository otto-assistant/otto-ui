/**
 * Scheduled-tasks CLI command.
 *
 * Provides a first-class `openchamber tasks` command surface over the
 * scheduled-tasks REST API of a running OpenChamber instance. The pure
 * helpers (schedule/execution builders, reference resolvers, formatters)
 * are exported so they can be unit-tested without a live server, while
 * `createTasksCommand` wires the behavior to injected CLI dependencies.
 *
 * Policy-first per AGENTS.md CLI parity rules: every validation runs in all
 * output modes (human/--json/--quiet) and prompts are presentation-only.
 */

const TASK_SUBCOMMANDS = ['list', 'show', 'status', 'run', 'enable', 'disable', 'create', 'delete'];

const SCHEDULE_KINDS = ['daily', 'weekly', 'once', 'cron'];

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// 0 = Sunday … 6 = Saturday (matches schedule.weekdays storage contract).
const WEEKDAY_TOKENS = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const asTrimmedString = (value) => (typeof value === 'string' ? value.trim() : '');

const flattenCsvList = (input) => {
  const source = Array.isArray(input) ? input : input == null ? [] : [input];
  const result = [];
  for (const entry of source) {
    if (typeof entry !== 'string') {
      continue;
    }
    for (const piece of entry.split(',')) {
      const trimmed = piece.trim();
      if (trimmed.length > 0) {
        result.push(trimmed);
      }
    }
  }
  return result;
};

const parseTimes = (input) => {
  const tokens = flattenCsvList(input);
  if (tokens.length === 0) {
    return [];
  }
  const seen = new Set();
  for (const token of tokens) {
    if (!TIME_PATTERN.test(token)) {
      throw new Error(`Invalid time "${token}". Use HH:mm (00:00-23:59).`);
    }
    seen.add(token);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
};

const parseWeekdays = (input) => {
  const tokens = flattenCsvList(input);
  if (tokens.length === 0) {
    return [];
  }
  const seen = new Set();
  for (const token of tokens) {
    const lower = token.toLowerCase();
    let day;
    if (/^\d+$/.test(lower)) {
      day = Number.parseInt(lower, 10);
    } else if (lower in WEEKDAY_TOKENS) {
      day = WEEKDAY_TOKENS[lower];
    } else {
      throw new Error(`Invalid weekday "${token}". Use 0-6 (0=Sunday) or names like mon,tue.`);
    }
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      throw new Error(`Invalid weekday "${token}". Use 0-6 (0=Sunday) or names like mon,tue.`);
    }
    seen.add(day);
  }
  return Array.from(seen).sort((a, b) => a - b);
};

const buildScheduleFromOptions = (options = {}) => {
  const kind = asTrimmedString(options.schedule).toLowerCase();
  if (!kind) {
    throw new Error('--schedule is required (one of daily, weekly, once, cron).');
  }
  if (!SCHEDULE_KINDS.includes(kind)) {
    throw new Error(`Invalid --schedule "${options.schedule}". Use one of: ${SCHEDULE_KINDS.join(', ')}.`);
  }

  const timezone = asTrimmedString(options.timezone);
  const withTimezone = (schedule) => (timezone ? { ...schedule, timezone } : schedule);

  if (kind === 'daily') {
    const times = parseTimes(options.at);
    if (times.length === 0) {
      throw new Error('Daily schedule requires at least one --at HH:mm value.');
    }
    return withTimezone({ kind, times });
  }

  if (kind === 'weekly') {
    const times = parseTimes(options.at);
    if (times.length === 0) {
      throw new Error('Weekly schedule requires at least one --at HH:mm value.');
    }
    const weekdays = parseWeekdays(options.weekdays);
    if (weekdays.length === 0) {
      throw new Error('Weekly schedule requires --weekdays (e.g. mon,wed,fri or 1,3,5).');
    }
    return withTimezone({ kind, times, weekdays });
  }

  if (kind === 'once') {
    const date = asTrimmedString(options.date);
    if (!date || !DATE_PATTERN.test(date)) {
      throw new Error('Once schedule requires --date YYYY-MM-DD.');
    }
    const times = parseTimes(options.at);
    if (times.length !== 1) {
      throw new Error('Once schedule requires exactly one --at HH:mm value.');
    }
    return withTimezone({ kind, date, time: times[0] });
  }

  const cron = asTrimmedString(options.cron);
  if (!cron) {
    throw new Error('Cron schedule requires --cron "<expression>".');
  }
  return withTimezone({ kind, cron });
};

const buildExecutionFromOptions = (options = {}) => {
  const prompt = asTrimmedString(options.prompt);
  const providerID = asTrimmedString(options.provider);
  const modelID = asTrimmedString(options.model);
  const agent = asTrimmedString(options.agent);
  const variant = asTrimmedString(options.variant);

  if (!prompt) {
    throw new Error('--prompt is required.');
  }
  if (!providerID) {
    throw new Error('--provider is required.');
  }
  if (!modelID) {
    throw new Error('--model is required.');
  }

  return {
    prompt,
    providerID,
    modelID,
    ...(agent ? { agent } : {}),
    ...(variant ? { variant } : {}),
  };
};

const buildTaskPayloadFromOptions = (options = {}) => {
  const name = asTrimmedString(options.name);
  if (!name) {
    throw new Error('--name is required.');
  }

  const schedule = buildScheduleFromOptions(options);
  const execution = buildExecutionFromOptions(options);

  const enabled = options.enabledFlag === false ? false : true;

  return {
    name,
    enabled,
    schedule,
    execution,
  };
};

const matchUnique = (items, predicate, describe, ref) => {
  const matches = items.filter(predicate);
  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length > 1) {
    throw new Error(`${describe} reference "${ref}" is ambiguous (${matches.length} matches). Use a more specific value.`);
  }
  return null;
};

const resolveProjectRef = (projects, ref) => {
  const list = Array.isArray(projects) ? projects : [];
  const value = asTrimmedString(ref);
  if (!value) {
    throw new Error('Project reference is required. Use --project <id|path|label>.');
  }

  const byId = list.find((project) => project?.id === value);
  if (byId) {
    return byId;
  }

  const byPath = list.find((project) => project?.path === value);
  if (byPath) {
    return byPath;
  }

  const lower = value.toLowerCase();
  const byLabel = matchUnique(
    list,
    (project) => typeof project?.label === 'string' && project.label.toLowerCase() === lower,
    'Project',
    value,
  );
  if (byLabel) {
    return byLabel;
  }

  const byIdPrefix = matchUnique(
    list,
    (project) => typeof project?.id === 'string' && project.id.startsWith(value),
    'Project',
    value,
  );
  if (byIdPrefix) {
    return byIdPrefix;
  }

  throw new Error(`No project matches "${value}". Run \`openchamber tasks list\` to see project ids.`);
};

const resolveTaskRef = (tasks, ref) => {
  const list = Array.isArray(tasks) ? tasks : [];
  const value = asTrimmedString(ref);
  if (!value) {
    throw new Error('Task reference is required. Use --task <id|name>.');
  }

  const byId = list.find((task) => task?.id === value);
  if (byId) {
    return byId;
  }

  const lower = value.toLowerCase();
  const byName = matchUnique(
    list,
    (task) => typeof task?.name === 'string' && task.name.toLowerCase() === lower,
    'Task',
    value,
  );
  if (byName) {
    return byName;
  }

  const byIdPrefix = matchUnique(
    list,
    (task) => typeof task?.id === 'string' && task.id.startsWith(value),
    'Task',
    value,
  );
  if (byIdPrefix) {
    return byIdPrefix;
  }

  throw new Error(`No task matches "${value}". Run \`openchamber tasks list\` to see task ids.`);
};

const formatScheduleSummary = (schedule) => {
  if (!schedule || typeof schedule !== 'object') {
    return 'unknown';
  }
  const tz = asTrimmedString(schedule.timezone);
  const suffix = tz ? ` (${tz})` : '';
  const times = Array.isArray(schedule.times) ? schedule.times.join(',') : '';

  if (schedule.kind === 'daily') {
    return `daily at ${times || '?'}${suffix}`;
  }
  if (schedule.kind === 'weekly') {
    const days = Array.isArray(schedule.weekdays)
      ? schedule.weekdays.map((day) => WEEKDAY_LABELS[day] || day).join(',')
      : '?';
    return `weekly ${days} at ${times || '?'}${suffix}`;
  }
  if (schedule.kind === 'once') {
    return `once ${asTrimmedString(schedule.date) || '?'} ${asTrimmedString(schedule.time) || '?'}${suffix}`;
  }
  if (schedule.kind === 'cron') {
    return `cron "${asTrimmedString(schedule.cron) || '?'}"${suffix}`;
  }
  return `${schedule.kind || 'unknown'}${suffix}`;
};

const formatTimestamp = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return '-';
  }
  try {
    return new Date(value).toISOString();
  } catch {
    return '-';
  }
};

const formatTaskLine = (task, projectID) => {
  const id = asTrimmedString(task?.id) || '?';
  const enabled = task?.enabled ? 'yes' : 'no';
  const kind = asTrimmedString(task?.schedule?.kind) || 'unknown';
  const last = asTrimmedString(task?.state?.lastStatus) || 'idle';
  const next = formatTimestamp(task?.state?.nextRunAt);
  const projectToken = projectID ? ` project=${projectID}` : '';
  return `task ${id}${projectToken} enabled=${enabled} schedule=${kind} last=${last} next=${next}`;
};

const formatTaskDetailLines = (task, projectID) => {
  const lines = [];
  lines.push(`id: ${asTrimmedString(task?.id) || '-'}`);
  lines.push(`name: ${asTrimmedString(task?.name) || '-'}`);
  if (projectID) {
    lines.push(`project: ${projectID}`);
  }
  lines.push(`enabled: ${task?.enabled ? 'yes' : 'no'}`);
  lines.push(`schedule: ${formatScheduleSummary(task?.schedule)}`);
  const execution = task?.execution || {};
  const model = `${asTrimmedString(execution.providerID) || '?'}/${asTrimmedString(execution.modelID) || '?'}`;
  lines.push(`model: ${model}`);
  if (asTrimmedString(execution.agent)) {
    lines.push(`agent: ${execution.agent}`);
  }
  if (asTrimmedString(execution.variant)) {
    lines.push(`variant: ${execution.variant}`);
  }
  const state = task?.state || {};
  lines.push(`last status: ${asTrimmedString(state.lastStatus) || 'idle'}`);
  lines.push(`last run: ${formatTimestamp(state.lastRunAt)}`);
  lines.push(`next run: ${formatTimestamp(state.nextRunAt)}`);
  if (asTrimmedString(state.lastError)) {
    lines.push(`last error: ${state.lastError}`);
  }
  const prompt = asTrimmedString(execution.prompt);
  if (prompt) {
    const condensed = prompt.length > 200 ? `${prompt.slice(0, 200)}…` : prompt;
    lines.push(`prompt: ${condensed.replace(/\s+/g, ' ')}`);
  }
  return lines;
};

const projectLabel = (project) => asTrimmedString(project?.label) || asTrimmedString(project?.path) || asTrimmedString(project?.id);

/**
 * Build the `openchamber tasks` command bound to injected CLI dependencies.
 *
 * @param {object} deps
 * @param {(port:number, endpoint:string, options?:object)=>Promise<{response:Response, body:any}>} deps.requestJson
 * @param {(options:object)=>Promise<{port:number}>} deps.resolveInstance
 * @param {object} deps.io  Output adapter (cli-output.js surface + clack primitives)
 * @param {object} deps.EXIT_CODE
 * @param {Function} deps.CliError
 */
const createTasksCommand = (deps) => {
  const { requestJson, resolveInstance, io, EXIT_CODE, CliError } = deps;
  const {
    isJsonMode,
    isQuietMode,
    shouldRenderHumanOutput,
    canPrompt,
    printJson,
    intro,
    outro,
    logStatus,
    confirm,
    isCancel,
    cancel,
  } = io;

  const fail = (message, exitCode = EXIT_CODE.GENERAL_ERROR) => {
    throw new CliError(message, exitCode);
  };

  const apiError = (body, response, fallback) => {
    const message = (body && typeof body === 'object' && typeof body.error === 'string' && body.error.trim())
      ? body.error.trim()
      : `${fallback} (HTTP ${response?.status ?? '???'})`;
    return message;
  };

  const fetchProjects = async (port) => {
    const { response, body } = await requestJson(port, '/api/config/settings');
    if (!response.ok) {
      fail(apiError(body, response, 'Failed to load projects'), EXIT_CODE.NETWORK_RUNTIME_ERROR);
    }
    return Array.isArray(body?.projects) ? body.projects : [];
  };

  const fetchTasks = async (port, projectID) => {
    const { response, body } = await requestJson(
      port,
      `/api/projects/${encodeURIComponent(projectID)}/scheduled-tasks`,
    );
    if (!response.ok) {
      fail(apiError(body, response, 'Failed to load scheduled tasks'), EXIT_CODE.NETWORK_RUNTIME_ERROR);
    }
    return Array.isArray(body?.tasks) ? body.tasks : [];
  };

  const resolveProject = async (port, ref) => {
    const projects = await fetchProjects(port);
    if (projects.length === 0) {
      fail('No projects are registered. Open a project in OpenChamber first.', EXIT_CODE.USAGE_ERROR);
    }
    try {
      return resolveProjectRef(projects, ref);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error), EXIT_CODE.USAGE_ERROR);
    }
    return null;
  };

  const resolveTask = (tasks, ref) => {
    try {
      return resolveTaskRef(tasks, ref);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error), EXIT_CODE.USAGE_ERROR);
    }
    return null;
  };

  const runList = async (options) => {
    const { port } = await resolveInstance(options);
    const projects = await fetchProjects(port);

    const targetProjects = options.project
      ? [(() => {
          try {
            return resolveProjectRef(projects, options.project);
          } catch (error) {
            fail(error instanceof Error ? error.message : String(error), EXIT_CODE.USAGE_ERROR);
          }
          return null;
        })()]
      : projects;

    const grouped = [];
    for (const project of targetProjects) {
      if (!project?.id) {
        continue;
      }
      const tasks = await fetchTasks(port, project.id);
      grouped.push({ project, tasks });
    }

    if (isJsonMode(options)) {
      printJson({
        projects: grouped.map(({ project, tasks }) => ({
          id: project.id,
          path: project.path,
          ...(project.label ? { label: project.label } : {}),
          tasks,
        })),
      });
      return;
    }

    if (isQuietMode(options)) {
      let count = 0;
      for (const { project, tasks } of grouped) {
        for (const task of tasks) {
          process.stdout.write(`${formatTaskLine(task, project.id)}\n`);
          count += 1;
        }
      }
      if (count === 0) {
        process.stdout.write('no scheduled tasks\n');
      }
      return;
    }

    intro('OpenChamber Scheduled Tasks');
    let total = 0;
    for (const { project, tasks } of grouped) {
      logStatus('info', `${projectLabel(project)}`, `id ${project.id}`);
      if (tasks.length === 0) {
        logStatus('neutral', '  (no scheduled tasks)');
        continue;
      }
      for (const task of tasks) {
        total += 1;
        const status = task.enabled ? 'success' : 'neutral';
        logStatus(
          status,
          `  ${task.enabled ? '●' : '○'} ${asTrimmedString(task.name) || task.id}`,
          `  ${formatScheduleSummary(task.schedule)} · last ${asTrimmedString(task.state?.lastStatus) || 'idle'} · next ${formatTimestamp(task.state?.nextRunAt)} · id ${task.id}`,
        );
      }
    }
    outro(total === 1 ? '1 task' : `${total} tasks`);
  };

  const runShow = async (options) => {
    const { port } = await resolveInstance(options);
    const project = await resolveProject(port, options.project);
    const tasks = await fetchTasks(port, project.id);
    const task = resolveTask(tasks, options.task);

    if (isJsonMode(options)) {
      printJson({ project: { id: project.id, path: project.path }, task });
      return;
    }

    if (isQuietMode(options)) {
      process.stdout.write(`${formatTaskLine(task, project.id)}\n`);
      return;
    }

    intro('Scheduled Task');
    for (const line of formatTaskDetailLines(task, project.id)) {
      logStatus('info', line);
    }
    outro('');
  };

  const runStatus = async (options) => {
    const { port } = await resolveInstance(options);
    const { response, body } = await requestJson(port, '/api/openchamber/scheduled-tasks/status');
    if (!response.ok) {
      fail(apiError(body, response, 'Failed to load scheduled task status'), EXIT_CODE.NETWORK_RUNTIME_ERROR);
    }
    const status = body && typeof body === 'object' ? body : {};

    if (isJsonMode(options)) {
      printJson({ ...status });
      return;
    }

    const enabled = Number(status.enabledScheduledTasksCount) || 0;
    const running = Number(status.runningScheduledTasksCount) || 0;

    if (isQuietMode(options)) {
      process.stdout.write(`scheduled-tasks enabled=${enabled} running=${running}\n`);
      return;
    }

    intro('Scheduled Tasks Status');
    logStatus(enabled > 0 ? 'success' : 'neutral', `enabled tasks: ${enabled}`);
    logStatus(running > 0 ? 'success' : 'neutral', `running tasks: ${running}`);
    outro('status complete');
  };

  const runRun = async (options) => {
    const { port } = await resolveInstance(options);
    const project = await resolveProject(port, options.project);
    const tasks = await fetchTasks(port, project.id);
    const task = resolveTask(tasks, options.task);

    const { response, body } = await requestJson(
      port,
      `/api/projects/${encodeURIComponent(project.id)}/scheduled-tasks/${encodeURIComponent(task.id)}/run`,
      { method: 'POST' },
    );

    if (!response.ok) {
      const exitCode = response.status === 409
        ? EXIT_CODE.GENERAL_ERROR
        : response.status === 404
          ? EXIT_CODE.USAGE_ERROR
          : EXIT_CODE.NETWORK_RUNTIME_ERROR;
      if (isJsonMode(options)) {
        printJson({ status: 'error', error: { message: apiError(body, response, 'Task run failed') }, task: { id: task.id } });
        throw new CliError(apiError(body, response, 'Task run failed'), exitCode);
      }
      fail(apiError(body, response, 'Task run failed'), exitCode);
    }

    const sessionId = asTrimmedString(body?.sessionId);
    if (isJsonMode(options)) {
      printJson({ ok: true, task: body?.task || { id: task.id }, sessionId: sessionId || undefined });
      return;
    }
    if (isQuietMode(options)) {
      process.stdout.write(`run ok task=${task.id}${sessionId ? ` session=${sessionId}` : ''}\n`);
      return;
    }
    intro('Run Scheduled Task');
    logStatus('success', `started ${asTrimmedString(task.name) || task.id}`, sessionId ? `session ${sessionId}` : undefined);
    outro('run complete');
  };

  const upsertTask = async (port, projectID, taskPayload) => {
    const { response, body } = await requestJson(
      port,
      `/api/projects/${encodeURIComponent(projectID)}/scheduled-tasks`,
      {
        method: 'PUT',
        body: JSON.stringify({ task: taskPayload }),
      },
    );
    if (!response.ok) {
      const exitCode = response.status === 400 ? EXIT_CODE.USAGE_ERROR : EXIT_CODE.NETWORK_RUNTIME_ERROR;
      fail(apiError(body, response, 'Failed to save scheduled task'), exitCode);
    }
    return body;
  };

  const runToggle = async (options, nextEnabled) => {
    const { port } = await resolveInstance(options);
    const project = await resolveProject(port, options.project);
    const tasks = await fetchTasks(port, project.id);
    const task = resolveTask(tasks, options.task);

    const verb = nextEnabled ? 'enabled' : 'disabled';
    if (task.enabled === nextEnabled) {
      if (isJsonMode(options)) {
        printJson({ ok: true, changed: false, task });
        return;
      }
      if (isQuietMode(options)) {
        process.stdout.write(`${verb} task=${task.id} changed=no\n`);
        return;
      }
      intro(nextEnabled ? 'Enable Task' : 'Disable Task');
      logStatus('info', `${asTrimmedString(task.name) || task.id} already ${verb}`);
      outro('no change');
      return;
    }

    const body = await upsertTask(port, project.id, { ...task, enabled: nextEnabled });
    const updated = body?.task || { ...task, enabled: nextEnabled };

    if (isJsonMode(options)) {
      printJson({ ok: true, changed: true, task: updated });
      return;
    }
    if (isQuietMode(options)) {
      process.stdout.write(`${verb} task=${task.id} changed=yes\n`);
      return;
    }
    intro(nextEnabled ? 'Enable Task' : 'Disable Task');
    logStatus('success', `${verb} ${asTrimmedString(updated.name) || updated.id}`);
    outro(`${verb}`);
  };

  const runCreate = async (options) => {
    let payload;
    try {
      payload = buildTaskPayloadFromOptions(options);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error), EXIT_CODE.USAGE_ERROR);
    }

    const { port } = await resolveInstance(options);
    const project = await resolveProject(port, options.project);

    const body = await upsertTask(port, project.id, payload);
    const created = body?.created !== false;
    const task = body?.task || payload;

    if (isJsonMode(options)) {
      printJson({ ok: true, created, project: { id: project.id }, task });
      return;
    }
    if (isQuietMode(options)) {
      process.stdout.write(`created task=${asTrimmedString(task.id) || '?'} project=${project.id}\n`);
      return;
    }
    intro('Create Scheduled Task');
    logStatus('success', `${created ? 'created' : 'updated'} ${asTrimmedString(task.name) || task.id}`, `id ${asTrimmedString(task.id) || '-'}`);
    logStatus('info', formatScheduleSummary(task.schedule));
    outro('create complete');
  };

  const runDelete = async (options) => {
    const { port } = await resolveInstance(options);
    const project = await resolveProject(port, options.project);
    const tasks = await fetchTasks(port, project.id);
    const task = resolveTask(tasks, options.task);

    if (!options.force && canPrompt(options)) {
      const confirmed = await confirm({
        message: `Delete scheduled task "${asTrimmedString(task.name) || task.id}"?`,
        initialValue: false,
      });
      if (isCancel(confirmed)) {
        cancel('Operation cancelled.');
        return;
      }
      if (!confirmed) {
        logStatus('info', 'Aborted.');
        return;
      }
    }

    const { response, body } = await requestJson(
      port,
      `/api/projects/${encodeURIComponent(project.id)}/scheduled-tasks/${encodeURIComponent(task.id)}`,
      { method: 'DELETE' },
    );
    if (!response.ok) {
      const exitCode = response.status === 404 ? EXIT_CODE.USAGE_ERROR : EXIT_CODE.NETWORK_RUNTIME_ERROR;
      fail(apiError(body, response, 'Failed to delete scheduled task'), exitCode);
    }

    if (isJsonMode(options)) {
      printJson({ ok: true, deleted: true, task: { id: task.id } });
      return;
    }
    if (isQuietMode(options)) {
      process.stdout.write(`deleted task=${task.id}\n`);
      return;
    }
    intro('Delete Scheduled Task');
    logStatus('success', `deleted ${asTrimmedString(task.name) || task.id}`);
    outro('delete complete');
  };

  return async function tasksCommand(options, subcommand) {
    const normalized = asTrimmedString(subcommand).toLowerCase() || 'list';
    if (!TASK_SUBCOMMANDS.includes(normalized)) {
      throw new CliError(
        `Unknown tasks subcommand '${subcommand}'. Run 'openchamber tasks --help'.`,
        EXIT_CODE.USAGE_ERROR,
      );
    }

    switch (normalized) {
      case 'list':
        return runList(options);
      case 'show':
        return runShow(options);
      case 'status':
        return runStatus(options);
      case 'run':
        return runRun(options);
      case 'enable':
        return runToggle(options, true);
      case 'disable':
        return runToggle(options, false);
      case 'create':
        return runCreate(options);
      case 'delete':
        return runDelete(options);
      default:
        return runList(options);
    }
  };
};

export {
  TASK_SUBCOMMANDS,
  SCHEDULE_KINDS,
  WEEKDAY_TOKENS,
  WEEKDAY_LABELS,
  parseTimes,
  parseWeekdays,
  buildScheduleFromOptions,
  buildExecutionFromOptions,
  buildTaskPayloadFromOptions,
  resolveProjectRef,
  resolveTaskRef,
  formatScheduleSummary,
  formatTimestamp,
  formatTaskLine,
  formatTaskDetailLines,
  createTasksCommand,
};
