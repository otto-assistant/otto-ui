import { describe, it, expect, vi } from 'vitest';
import {
  parseScheduleSpec,
  computeNextCronRun,
  describeSchedule,
  createMessengerScheduler,
  MAX_SCHEDULED_TASKS,
} from './messenger-scheduler.js';

const NOW = Date.parse('2026-06-11T12:00:00Z');

describe('parseScheduleSpec', () => {
  it('accepts a future UTC ISO date as a one-time schedule', () => {
    const r = parseScheduleSpec('2026-06-12T09:00:00Z', NOW);
    expect(r).toMatchObject({ kind: 'once', spec: '2026-06-12T09:00:00Z' });
    expect(r.nextRunAt).toBe(Date.parse('2026-06-12T09:00:00Z'));
  });

  it('accepts the short form without seconds', () => {
    const r = parseScheduleSpec('2026-06-12T09:00Z', NOW);
    expect(r.kind).toBe('once');
  });

  it('rejects past dates', () => {
    const r = parseScheduleSpec('2026-06-10T09:00:00Z', NOW);
    expect(r.error).toContain('future');
  });

  it('rejects date-like strings that are not UTC ISO with Z', () => {
    const r = parseScheduleSpec('2026-06-12 09:00', NOW);
    expect(r.error).toContain('UTC ISO format ending with Z');
  });

  it('accepts a 5-field cron expression evaluated in UTC', () => {
    const r = parseScheduleSpec('0 9 * * 1', NOW);
    expect(r.kind).toBe('cron');
    // Next Monday 09:00 UTC after Thu 2026-06-11 is 2026-06-15.
    expect(new Date(r.nextRunAt).toISOString()).toBe('2026-06-15T09:00:00.000Z');
  });

  it('rejects garbage', () => {
    expect(parseScheduleSpec('whenever', NOW).error).toContain('Invalid cron expression');
    expect(parseScheduleSpec('', NOW).error).toContain('required');
  });
});

describe('computeNextCronRun', () => {
  it('computes the next fire time in UTC', () => {
    const next = computeNextCronRun('*/15 * * * *', NOW);
    expect(next).toBe(Date.parse('2026-06-11T12:15:00Z'));
  });
  it('returns an Error for invalid expressions', () => {
    expect(computeNextCronRun('not cron', NOW)).toBeInstanceOf(Error);
  });
});

describe('describeSchedule', () => {
  it('describes targets and pinned model/agent', () => {
    expect(
      describeSchedule({
        scheduleKind: 'cron', scheduleSpec: '0 9 * * 1',
        threadId: 't1', modelOverride: 'anthropic/claude', agentOverride: null,
      }),
    ).toBe('cron `0 9 * * 1` (UTC) → thread <#t1> (model `anthropic/claude`)');
    expect(
      describeSchedule({ scheduleKind: 'once', scheduleSpec: '2026-06-12T09:00:00Z', channelId: 'c1' }),
    ).toContain('new chat in <#c1>');
  });
});

function makeMemoryStore() {
  const tasks = new Map();
  return {
    addScheduledTask(row) {
      const task = { enabled: 1, lastRunAt: null, lastStatus: null, ...row };
      tasks.set(row.id, task);
      return task;
    },
    getScheduledTask: (id) => tasks.get(id) ?? null,
    listScheduledTasks({ enabledOnly = false } = {}) {
      return [...tasks.values()].filter((t) => !enabledOnly || t.enabled);
    },
    deleteScheduledTask: (id) => tasks.delete(id),
    updateScheduledTaskState(id, patch) {
      const t = tasks.get(id);
      if (!t) return;
      for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined) t[k] = v;
      }
    },
    _tasks: tasks,
  };
}

describe('createMessengerScheduler', () => {
  it('creates, lists and deletes tasks', () => {
    const store = makeMemoryStore();
    const scheduler = createMessengerScheduler({ store, dispatch: vi.fn() });
    const r = scheduler.create({ channelId: 'c1', prompt: 'hello', when: '0 9 * * 1' });
    expect(r.ok).toBe(true);
    expect(scheduler.list()).toHaveLength(1);
    expect(scheduler.delete(r.task.id)).toBe(true);
    expect(scheduler.list()).toHaveLength(0);
  });

  it('rejects invalid schedules and empty prompts', () => {
    const store = makeMemoryStore();
    const scheduler = createMessengerScheduler({ store, dispatch: vi.fn() });
    expect(scheduler.create({ channelId: 'c1', prompt: '', when: '0 9 * * 1' }).ok).toBe(false);
    expect(scheduler.create({ channelId: 'c1', prompt: 'x', when: 'nope' }).ok).toBe(false);
  });

  it('enforces the active-task cap', () => {
    const store = makeMemoryStore();
    const scheduler = createMessengerScheduler({ store, dispatch: vi.fn() });
    for (let i = 0; i < MAX_SCHEDULED_TASKS; i += 1) {
      expect(scheduler.create({ channelId: 'c1', prompt: `p${i}`, when: '0 9 * * 1' }).ok).toBe(true);
    }
    expect(scheduler.create({ channelId: 'c1', prompt: 'overflow', when: '0 9 * * 1' }).ok).toBe(false);
  });

  it('dispatches due one-time tasks exactly once and disables them', async () => {
    const store = makeMemoryStore();
    const dispatch = vi.fn(async () => {});
    const scheduler = createMessengerScheduler({ store, dispatch, log: { log() {}, warn() {} } });
    const r = scheduler.create({ threadId: 't1', prompt: 'remind me', when: '2026-06-12T09:00:00Z' });

    await scheduler._tick(Date.parse('2026-06-12T08:59:00Z'));
    expect(dispatch).not.toHaveBeenCalled();

    await scheduler._tick(Date.parse('2026-06-12T09:00:01Z'));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0]).toMatchObject({ threadId: 't1', prompt: 'remind me' });

    const stored = store.getScheduledTask(r.task.id);
    expect(stored.enabled).toBe(false);
    expect(stored.lastStatus).toBe('ok');

    await scheduler._tick(Date.parse('2026-06-12T09:05:00Z'));
    expect(dispatch).toHaveBeenCalledTimes(1); // never re-fires
  });

  it('re-arms cron tasks for the next occurrence after firing', async () => {
    const store = makeMemoryStore();
    const dispatch = vi.fn(async () => {});
    const scheduler = createMessengerScheduler({ store, dispatch, log: { log() {}, warn() {} } });
    const r = scheduler.create({ channelId: 'c1', prompt: 'weekly run', when: '0 9 * * 1' });

    const monday = Date.parse('2026-06-15T09:00:30Z');
    await scheduler._tick(monday);
    expect(dispatch).toHaveBeenCalledTimes(1);

    const stored = store.getScheduledTask(r.task.id);
    expect(stored.enabled).toBe(1);
    expect(new Date(stored.nextRunAt).toISOString()).toBe('2026-06-22T09:00:00.000Z');
  });

  it('records dispatch failures without killing the task', async () => {
    const store = makeMemoryStore();
    const dispatch = vi.fn(async () => { throw new Error('discord down'); });
    const scheduler = createMessengerScheduler({ store, dispatch, log: { log() {}, warn() {} } });
    const r = scheduler.create({ channelId: 'c1', prompt: 'x', when: '0 9 * * 1' });
    await scheduler._tick(Date.parse('2026-06-15T09:00:30Z'));
    const stored = store.getScheduledTask(r.task.id);
    expect(stored.lastStatus).toContain('error: discord down');
    expect(stored.enabled).toBe(1);
  });
});
