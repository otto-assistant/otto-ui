import { describe, expect, it, vi } from 'vitest';

import { parseArgs } from './cli.js';
import {
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
  createTasksCommand,
} from './cli-tasks.js';

const EXIT_CODE = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  USAGE_ERROR: 2,
  NETWORK_RUNTIME_ERROR: 5,
};

class CliError extends Error {
  constructor(message, exitCode = EXIT_CODE.GENERAL_ERROR) {
    super(message);
    this.exitCode = exitCode;
  }
}

describe('tasks arg parsing', () => {
  it('parses tasks list with project and json', () => {
    const parsed = parseArgs(['tasks', 'list', '--project', 'my-app', '--json']);
    expect(parsed.command).toBe('tasks');
    expect(parsed.subcommand).toBe('list');
    expect(parsed.options.project).toBe('my-app');
    expect(parsed.options.json).toBe(true);
  });

  it('defaults tasks subcommand to list', () => {
    const parsed = parseArgs(['tasks']);
    expect(parsed.command).toBe('tasks');
    expect(parsed.subcommand).toBe('list');
  });

  it('accumulates repeated --at values and parses schedule flags', () => {
    const parsed = parseArgs([
      'tasks', 'create',
      '--name', 'Daily digest',
      '--schedule', 'daily',
      '--at', '09:00',
      '--at', '18:00',
      '--provider', 'anthropic',
      '--model', 'claude-sonnet-4',
      '--prompt', 'do the thing',
    ]);
    expect(parsed.options.at).toEqual(['09:00', '18:00']);
    expect(parsed.options.schedule).toBe('daily');
    expect(parsed.options.name).toBe('Daily digest');
    expect(parsed.options.provider).toBe('anthropic');
    expect(parsed.options.model).toBe('claude-sonnet-4');
  });

  it('parses --disabled and --tz aliases', () => {
    const parsed = parseArgs(['tasks', 'create', '--disabled', '--tz', 'America/New_York']);
    expect(parsed.options.enabledFlag).toBe(false);
    expect(parsed.options.timezone).toBe('America/New_York');
  });

  it('does not report new task flags as unknown options', () => {
    const parsed = parseArgs([
      'tasks', 'create', '--task', 't1', '--weekdays', 'mon,tue',
      '--cron', '0 9 * * *', '--date', '2026-01-01', '--agent', 'build', '--variant', 'fast',
    ]);
    expect(parsed.removedFlagErrors).toEqual([]);
  });
});

describe('parseTimes', () => {
  it('parses comma-separated and array inputs and dedupes/sorts', () => {
    expect(parseTimes(['18:00', '09:00'])).toEqual(['09:00', '18:00']);
    expect(parseTimes('09:00,09:00')).toEqual(['09:00']);
    expect(parseTimes([])).toEqual([]);
  });

  it('rejects malformed times', () => {
    expect(() => parseTimes(['9:00'])).toThrow(/Invalid time/);
    expect(() => parseTimes(['25:00'])).toThrow(/Invalid time/);
  });
});

describe('parseWeekdays', () => {
  it('accepts names and numbers, dedupes and sorts', () => {
    expect(parseWeekdays('mon,tue,1')).toEqual([1, 2]);
    expect(parseWeekdays(['sun', 'sat'])).toEqual([0, 6]);
  });

  it('rejects invalid weekdays', () => {
    expect(() => parseWeekdays('funday')).toThrow(/Invalid weekday/);
    expect(() => parseWeekdays('7')).toThrow(/Invalid weekday/);
  });
});

describe('buildScheduleFromOptions', () => {
  it('builds a daily schedule', () => {
    expect(buildScheduleFromOptions({ schedule: 'daily', at: ['09:00'] })).toEqual({
      kind: 'daily',
      times: ['09:00'],
    });
  });

  it('builds a weekly schedule with timezone', () => {
    expect(buildScheduleFromOptions({
      schedule: 'weekly',
      at: ['08:30'],
      weekdays: 'mon,fri',
      timezone: 'UTC',
    })).toEqual({
      kind: 'weekly',
      times: ['08:30'],
      weekdays: [1, 5],
      timezone: 'UTC',
    });
  });

  it('builds a once schedule', () => {
    expect(buildScheduleFromOptions({ schedule: 'once', date: '2026-01-02', at: ['10:15'] })).toEqual({
      kind: 'once',
      date: '2026-01-02',
      time: '10:15',
    });
  });

  it('builds a cron schedule', () => {
    expect(buildScheduleFromOptions({ schedule: 'cron', cron: '0 9 * * *' })).toEqual({
      kind: 'cron',
      cron: '0 9 * * *',
    });
  });

  it('validates required fields per kind', () => {
    expect(() => buildScheduleFromOptions({})).toThrow(/--schedule is required/);
    expect(() => buildScheduleFromOptions({ schedule: 'nope' })).toThrow(/Invalid --schedule/);
    expect(() => buildScheduleFromOptions({ schedule: 'daily', at: [] })).toThrow(/requires at least one --at/);
    expect(() => buildScheduleFromOptions({ schedule: 'weekly', at: ['09:00'] })).toThrow(/requires --weekdays/);
    expect(() => buildScheduleFromOptions({ schedule: 'once', at: ['09:00'] })).toThrow(/requires --date/);
    expect(() => buildScheduleFromOptions({ schedule: 'once', date: '2026-01-02', at: ['09:00', '10:00'] })).toThrow(/exactly one --at/);
    expect(() => buildScheduleFromOptions({ schedule: 'cron' })).toThrow(/requires --cron/);
  });
});

describe('buildExecutionFromOptions', () => {
  it('builds a full execution payload', () => {
    expect(buildExecutionFromOptions({
      prompt: 'hi',
      provider: 'anthropic',
      model: 'claude',
      agent: 'build',
      variant: 'fast',
    })).toEqual({
      prompt: 'hi',
      providerID: 'anthropic',
      modelID: 'claude',
      agent: 'build',
      variant: 'fast',
    });
  });

  it('requires prompt, provider, and model', () => {
    expect(() => buildExecutionFromOptions({ provider: 'a', model: 'b' })).toThrow(/--prompt is required/);
    expect(() => buildExecutionFromOptions({ prompt: 'x', model: 'b' })).toThrow(/--provider is required/);
    expect(() => buildExecutionFromOptions({ prompt: 'x', provider: 'a' })).toThrow(/--model is required/);
  });
});

describe('buildTaskPayloadFromOptions', () => {
  it('assembles a full task payload, enabled by default', () => {
    const payload = buildTaskPayloadFromOptions({
      name: 'Nightly',
      schedule: 'daily',
      at: ['23:00'],
      prompt: 'run cleanup',
      provider: 'anthropic',
      model: 'claude',
    });
    expect(payload).toEqual({
      name: 'Nightly',
      enabled: true,
      schedule: { kind: 'daily', times: ['23:00'] },
      execution: { prompt: 'run cleanup', providerID: 'anthropic', modelID: 'claude' },
    });
  });

  it('honors --disabled', () => {
    const payload = buildTaskPayloadFromOptions({
      name: 'Nightly',
      schedule: 'cron',
      cron: '0 0 * * *',
      prompt: 'x',
      provider: 'a',
      model: 'b',
      enabledFlag: false,
    });
    expect(payload.enabled).toBe(false);
  });

  it('requires a name', () => {
    expect(() => buildTaskPayloadFromOptions({ schedule: 'daily', at: ['09:00'] })).toThrow(/--name is required/);
  });
});

describe('resolveProjectRef', () => {
  const projects = [
    { id: 'abc123', path: '/home/me/app', label: 'My App' },
    { id: 'def456', path: '/home/me/site', label: 'Site' },
  ];

  it('matches by id, path, label, and id prefix', () => {
    expect(resolveProjectRef(projects, 'abc123').id).toBe('abc123');
    expect(resolveProjectRef(projects, '/home/me/site').id).toBe('def456');
    expect(resolveProjectRef(projects, 'my app').id).toBe('abc123');
    expect(resolveProjectRef(projects, 'abc').id).toBe('abc123');
  });

  it('throws on missing and empty refs', () => {
    expect(() => resolveProjectRef(projects, '')).toThrow(/reference is required/);
    expect(() => resolveProjectRef(projects, 'zzz')).toThrow(/No project matches/);
  });

  it('throws when a prefix is ambiguous', () => {
    const ambiguous = [{ id: 'aa1', path: '/a' }, { id: 'aa2', path: '/b' }];
    expect(() => resolveProjectRef(ambiguous, 'aa')).toThrow(/ambiguous/);
  });
});

describe('resolveTaskRef', () => {
  const tasks = [
    { id: 'task_1', name: 'Nightly cleanup' },
    { id: 'task_2', name: 'Weekly report' },
  ];

  it('matches by id, name, id prefix, and name substring', () => {
    expect(resolveTaskRef(tasks, 'task_1').id).toBe('task_1');
    expect(resolveTaskRef(tasks, 'nightly cleanup').id).toBe('task_1');
    expect(resolveTaskRef(tasks, 'task_2').id).toBe('task_2');
    expect(resolveTaskRef(tasks, 'nightly').id).toBe('task_1');
  });

  it('throws when a name substring is ambiguous', () => {
    const many = [{ id: 'a', name: 'Report daily' }, { id: 'b', name: 'Report weekly' }];
    expect(() => resolveTaskRef(many, 'report')).toThrow(/ambiguous/);
  });

  it('throws on no match', () => {
    expect(() => resolveTaskRef(tasks, 'missing')).toThrow(/No task matches/);
  });
});

describe('formatters', () => {
  it('summarizes schedules', () => {
    expect(formatScheduleSummary({ kind: 'daily', times: ['09:00'] })).toBe('daily at 09:00');
    expect(formatScheduleSummary({ kind: 'weekly', weekdays: [1, 5], times: ['08:30'], timezone: 'UTC' }))
      .toBe('weekly Mon,Fri at 08:30 (UTC)');
    expect(formatScheduleSummary({ kind: 'cron', cron: '0 9 * * *' })).toBe('cron "0 9 * * *"');
  });

  it('formats timestamps and missing values', () => {
    expect(formatTimestamp(0)).toBe('-');
    expect(formatTimestamp(undefined)).toBe('-');
    expect(formatTimestamp(1_700_000_000_000)).toMatch(/^20\d\d-/);
  });

  it('formats compact task lines', () => {
    const line = formatTaskLine({ id: 't1', enabled: true, schedule: { kind: 'daily' }, state: { lastStatus: 'success' } }, 'p1');
    expect(line).toBe('task t1 project=p1 enabled=yes schedule=daily last=success next=-');
  });
});

describe('createTasksCommand integration (faked transport)', () => {
  const project = { id: 'proj1', path: '/home/me/app', label: 'App' };
  const task = {
    id: 'task1',
    name: 'Nightly',
    enabled: true,
    schedule: { kind: 'daily', times: ['23:00'] },
    execution: { prompt: 'x', providerID: 'a', modelID: 'b' },
    state: { lastStatus: 'idle' },
  };

  const makeDeps = (handlers) => {
    const requestJson = vi.fn(async (port, endpoint, options = {}) => {
      const key = `${options.method || 'GET'} ${endpoint.split('?')[0]}`;
      const handler = handlers[key];
      if (!handler) {
        throw new Error(`unexpected request: ${key}`);
      }
      return handler(options);
    });
    const io = {
      isJsonMode: (o) => Boolean(o?.json),
      isQuietMode: (o) => Boolean(o?.quiet),
      shouldRenderHumanOutput: (o) => !o?.json && !o?.quiet,
      canPrompt: () => false,
      printJson: vi.fn(),
      intro: vi.fn(),
      outro: vi.fn(),
      logStatus: vi.fn(),
      confirm: vi.fn(),
      isCancel: () => false,
      cancel: vi.fn(),
    };
    const run = createTasksCommand({
      requestJson,
      resolveInstance: async () => ({ port: 3000 }),
      io,
      EXIT_CODE,
      CliError,
    });
    return { run, requestJson, io };
  };

  it('lists tasks as JSON', async () => {
    const { run, io } = makeDeps({
      'GET /api/config/settings': () => ({ response: { ok: true, status: 200 }, body: { projects: [project] } }),
      'GET /api/projects/proj1/scheduled-tasks': () => ({ response: { ok: true, status: 200 }, body: { tasks: [task] } }),
    });
    await run({ json: true }, 'list');
    expect(io.printJson).toHaveBeenCalledTimes(1);
    const payload = io.printJson.mock.calls[0][0];
    expect(payload.projects[0].tasks[0].id).toBe('task1');
  });

  it('creates a task via PUT and reports created', async () => {
    let putBody = null;
    const { run, io } = makeDeps({
      'GET /api/config/settings': () => ({ response: { ok: true, status: 200 }, body: { projects: [project] } }),
      'PUT /api/projects/proj1/scheduled-tasks': (options) => {
        putBody = JSON.parse(options.body);
        return { response: { ok: true, status: 200 }, body: { created: true, task: { ...putBody.task, id: 'task_new' } } };
      },
    });
    await run({
      json: true,
      project: 'proj1',
      name: 'New',
      schedule: 'daily',
      at: ['09:00'],
      prompt: 'p',
      provider: 'a',
      model: 'b',
    }, 'create');
    expect(putBody.task.schedule).toEqual({ kind: 'daily', times: ['09:00'] });
    expect(io.printJson.mock.calls[0][0]).toMatchObject({ ok: true, created: true });
  });

  it('disable sends full task with enabled=false', async () => {
    let putBody = null;
    const { run } = makeDeps({
      'GET /api/config/settings': () => ({ response: { ok: true, status: 200 }, body: { projects: [project] } }),
      'GET /api/projects/proj1/scheduled-tasks': () => ({ response: { ok: true, status: 200 }, body: { tasks: [task] } }),
      'PUT /api/projects/proj1/scheduled-tasks': (options) => {
        putBody = JSON.parse(options.body);
        return { response: { ok: true, status: 200 }, body: { task: putBody.task } };
      },
    });
    await run({ json: true, project: 'proj1', task: 'task1' }, 'disable');
    expect(putBody.task.enabled).toBe(false);
    expect(putBody.task.execution).toEqual(task.execution);
  });

  it('run surfaces 409 as a CliError', async () => {
    const { run } = makeDeps({
      'GET /api/config/settings': () => ({ response: { ok: true, status: 200 }, body: { projects: [project] } }),
      'GET /api/projects/proj1/scheduled-tasks': () => ({ response: { ok: true, status: 200 }, body: { tasks: [task] } }),
      'POST /api/projects/proj1/scheduled-tasks/task1/run': () => ({ response: { ok: false, status: 409 }, body: { error: 'Task already running' } }),
    });
    await expect(run({ project: 'proj1', task: 'task1' }, 'run')).rejects.toThrow(/already running/);
  });

  it('delete without force and no prompt proceeds via DELETE', async () => {
    const { run, requestJson } = makeDeps({
      'GET /api/config/settings': () => ({ response: { ok: true, status: 200 }, body: { projects: [project] } }),
      'GET /api/projects/proj1/scheduled-tasks': () => ({ response: { ok: true, status: 200 }, body: { tasks: [task] } }),
      'DELETE /api/projects/proj1/scheduled-tasks/task1': () => ({ response: { ok: true, status: 200 }, body: { tasks: [] } }),
    });
    await run({ quiet: true, project: 'proj1', task: 'task1' }, 'delete');
    const deleteCall = requestJson.mock.calls.find(([, endpoint, opts]) => opts?.method === 'DELETE');
    expect(deleteCall).toBeTruthy();
  });

  it('rejects unknown subcommand', async () => {
    const { run } = makeDeps({});
    await expect(run({}, 'frobnicate')).rejects.toThrow(/Unknown tasks subcommand/);
  });
});
