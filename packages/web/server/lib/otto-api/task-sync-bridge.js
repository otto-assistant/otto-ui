import { createTask, updateTask, getTaskById } from './task-store.js';

/** @typedef {{ action: string; id?: string; title?: string; description?: string; owner?: string; ownerType?: string; priority?: string; dueAt?: string | null; source?: string }} TaskRelayInboundBody */

const relayTimeoutMs = () => {
  const raw = process.env.OTTO_DISCORD_TASK_RELAY_TIMEOUT_MS;
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : 10_000;
};

/**
 * Best-effort notify toward a relay implementing the Otto UI `/api/otto/tasks/sync` JSON contract
 * (`packages/web/server/lib/otto-api/routes.js`: `action` create|update, task fields).
 * No undocumented fields beyond what that handler already accepts for create/update.
 *
 * Configure with `OTTO_DISCORD_TASK_RELAY_URL` (POST target, e.g. `https://…/api/otto/tasks/sync`).
 */
async function postTaskRelay(payload) {
  const urlEnv = process.env.OTTO_DISCORD_TASK_RELAY_URL;
  if (typeof urlEnv !== 'string' || urlEnv.trim().length === 0) {
    return null;
  }
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), relayTimeoutMs());
  try {
    const headers = /** @type {Record<string, string>} */ ({ 'Content-Type': 'application/json' });
    const bearer = process.env.OTTO_DISCORD_TASK_RELAY_BEARER_TOKEN;
    if (typeof bearer === 'string' && bearer.trim().length > 0) {
      headers.Authorization = `Bearer ${bearer.trim()}`;
    }

    await fetch(urlEnv.trim(), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch {
    // Silent: outbound notify must not block task UX; operators watch relay logs/metrics instead.
  } finally {
    globalThis.clearTimeout(timer);
  }
  return null;
}

/**
 * Receive a task from an external source (Discord relay, CLI) and add to the store.
 */
export function receiveExternalTask({ title, description, owner, ownerType, priority, dueAt, source }) {
  return createTask({ title, description, owner, ownerType, priority, dueAt, source });
}

/**
 * Notify relay when task status changes in the Web UI store.
 * Mirrors `routes.js` `POST /api/otto/tasks/sync` payloads only (action + documented task fields).
 */
export function notifyDiscordRelay(taskId, event) {
  const task = getTaskById(taskId);
  if (!task) return;

  /** @type {TaskRelayInboundBody} */
  let payload;

  if (event === 'task.create') {
    payload = {
      action: 'create',
      title: task.title,
      description: task.description,
      owner: task.owner,
      ownerType: task.ownerType,
      priority: task.priority,
      dueAt: task.dueAt,
      source: task.source,
    };
  } else {
    payload = {
      action: 'update',
      id: task.id,
      title: task.title,
      description: task.description,
      owner: task.owner,
      ownerType: task.ownerType,
      priority: task.priority,
      status: task.status,
      dueAt: task.dueAt,
      source: task.source,
    };
  }

  void postTaskRelay(payload);
}

/**
 * Handle incoming webhook from discord-relay for task status updates.
 */
export function handleDiscordTaskUpdate(taskId, updates) {
  const result = updateTask(taskId, updates);
  return result;
}
