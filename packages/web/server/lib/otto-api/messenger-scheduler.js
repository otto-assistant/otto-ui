/**
 * Scheduled prompts for the Discord ↔ OpenCode bridge.
 *
 * A scheduled task delivers a prompt at a future time, either:
 *   - into an EXISTING Discord thread/channel surface (continuing its bound
 *     session and streaming the answer back into Discord), or
 *   - as a NEW chat in a project (starter message + fresh thread + session),
 * optionally pinning the model (`provider/model`) and agent that must answer.
 *
 * Schedule spec (everything UTC):
 *   - one-time: ISO timestamp ending with `Z`, e.g. `2026-03-01T09:00:00Z`
 *   - recurring: 5-field cron expression evaluated in UTC, e.g. `0 9 * * 1`
 *
 * Persistence lives in the bridge SQLite store; the timer survives server
 * restarts by recomputing next runs from the stored specs at start().
 */

import crypto from 'node:crypto';
import parser from 'cron-parser';

const UTC_SEND_AT_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/;
const TICK_INTERVAL_MS = 15_000;
export const MAX_SCHEDULED_TASKS = 100;

/**
 * Parse a schedule spec into { kind, spec, nextRunAt } or { error }.
 * One-time dates must be UTC ISO and in the future; everything else falls
 * back to cron (UTC) for everything else.
 */
export function parseScheduleSpec(value, now = Date.now()) {
  const raw = String(value ?? '').trim();
  if (!raw) return { error: 'schedule is required — UTC ISO date ending with Z, or a cron expression.' };

  if (UTC_SEND_AT_DATE_REGEX.test(raw)) {
    const runAt = new Date(raw).getTime();
    if (!Number.isFinite(runAt)) {
      return { error: `Invalid UTC date: ${raw}` };
    }
    if (runAt <= now) {
      return { error: `the date must be in the future (UTC): ${raw}` };
    }
    return { kind: 'once', spec: raw, nextRunAt: runAt };
  }

  // Anything date-like that isn't valid UTC ISO gets a helpful error message.
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return {
      error: `dates must be UTC ISO format ending with Z (example: 2026-03-01T09:00:00Z). Received: ${raw}`,
    };
  }

  const nextRunAt = computeNextCronRun(raw, now);
  if (nextRunAt instanceof Error) {
    return { error: nextRunAt.message };
  }
  return { kind: 'cron', spec: raw, nextRunAt };
}

/** Next run (ms) for a cron expression in UTC, or an Error. */
export function computeNextCronRun(cronExpr, now = Date.now()) {
  try {
    const iterator = parser.parseExpression(String(cronExpr).trim(), {
      currentDate: new Date(now),
      utc: true,
    });
    return iterator.next().getTime();
  } catch (error) {
    return new Error(`Invalid cron expression: ${cronExpr}`, { cause: error });
  }
}

/** Compact human description of a task for Discord lists / the UI. */
export function describeSchedule(task) {
  const when =
    task.scheduleKind === 'once'
      ? `once at ${task.scheduleSpec}`
      : `cron \`${task.scheduleSpec}\` (UTC)`;
  const target = task.threadId
    ? `thread <#${task.threadId}>`
    : task.channelId
      ? `new chat in <#${task.channelId}>`
      : task.projectPath
        ? `new chat in ${task.projectPath}`
        : 'unbound';
  const pins = [
    task.modelOverride ? `model \`${task.modelOverride}\`` : null,
    task.agentOverride ? `agent \`${task.agentOverride}\`` : null,
  ].filter(Boolean);
  return `${when} → ${target}${pins.length ? ` (${pins.join(', ')})` : ''}`;
}

export function generateTaskId() {
  return `sched_${crypto.randomBytes(5).toString('hex')}`;
}

/**
 * Create the scheduler. `dispatch(task)` is injected by the bridge and is
 * responsible for actually delivering the prompt to the surface.
 */
export function createMessengerScheduler({ store, dispatch, log = console }) {
  let timer = null;
  let ticking = false;

  async function tick(now = Date.now()) {
    if (ticking) return;
    if (typeof store?.listScheduledTasks !== 'function') return;
    ticking = true;
    try {
      const due = store
        .listScheduledTasks({ enabledOnly: true })
        .filter((task) => typeof task.nextRunAt === 'number' && task.nextRunAt <= now);

      for (const task of due) {
        // Advance/disable BEFORE dispatching so a crash mid-dispatch can't
        // cause a rapid-fire loop on restart.
        if (task.scheduleKind === 'once') {
          store.updateScheduledTaskState(task.id, { enabled: false, nextRunAt: null });
        } else {
          const next = computeNextCronRun(task.scheduleSpec, now);
          store.updateScheduledTaskState(task.id, {
            nextRunAt: next instanceof Error ? null : next,
            enabled: next instanceof Error ? false : undefined,
          });
        }

        try {
          await dispatch(task);
          store.updateScheduledTaskState(task.id, { lastRunAt: now, lastStatus: 'ok' });
          log.log?.(`[SCHEDULER] Ran task ${task.id}: ${describeSchedule(task)}`);
        } catch (err) {
          store.updateScheduledTaskState(task.id, {
            lastRunAt: now,
            lastStatus: `error: ${String(err?.message ?? err).slice(0, 200)}`,
          });
          log.warn?.(`[SCHEDULER] Task ${task.id} failed:`, err?.message ?? err);
        }
      }

      // One-time tasks that already fired stay around (disabled) for `list`
      // visibility; prune anything disabled and older than a week.
      const cutoff = now - 7 * 86_400_000;
      for (const task of store.listScheduledTasks()) {
        if (!task.enabled && (task.lastRunAt ?? 0) < cutoff && (task.nextRunAt ?? 0) < cutoff) {
          store.deleteScheduledTask(task.id);
        }
      }
    } catch (err) {
      log.warn?.('[SCHEDULER] tick failed:', err?.message ?? err);
    } finally {
      ticking = false;
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => void tick(), TICK_INTERVAL_MS);
      timer.unref?.();
      // Catch up on anything that came due while the server was down.
      void tick();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    /** Test seam — run one scheduling pass at a given "now". */
    _tick: tick,

    create({ type = 'discord', botTokenHash = '', channelId, threadId, projectPath, prompt, when, modelOverride, agentOverride, createdBy }) {
      if (typeof store?.addScheduledTask !== 'function') {
        return { ok: false, error: 'scheduling is not supported by this store.' };
      }
      const text = String(prompt ?? '').trim();
      if (!text) return { ok: false, error: 'prompt is required.' };
      const parsed = parseScheduleSpec(when);
      if (parsed.error) return { ok: false, error: parsed.error };
      const active = store.listScheduledTasks({ enabledOnly: true });
      if (active.length >= MAX_SCHEDULED_TASKS) {
        return { ok: false, error: `too many scheduled tasks (max ${MAX_SCHEDULED_TASKS}).` };
      }
      const task = store.addScheduledTask({
        id: generateTaskId(),
        type,
        botTokenHash,
        channelId: channelId ?? null,
        threadId: threadId ?? null,
        projectPath: projectPath ?? null,
        prompt: text,
        scheduleKind: parsed.kind,
        scheduleSpec: parsed.spec,
        modelOverride: modelOverride ?? null,
        agentOverride: agentOverride ?? null,
        nextRunAt: parsed.nextRunAt,
        createdBy: createdBy ?? null,
      });
      return { ok: true, task };
    },

    list() {
      return typeof store?.listScheduledTasks === 'function' ? store.listScheduledTasks() : [];
    },

    delete(id) {
      return typeof store?.deleteScheduledTask === 'function' ? store.deleteScheduledTask(id) : false;
    },
  };
}
