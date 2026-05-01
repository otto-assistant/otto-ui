import { createTask, updateTask, getTaskById } from './task-store.js';

/**
 * Receive a task from an external source (Discord relay, CLI) and add to the store.
 * Returns the created task.
 */
export function receiveExternalTask({ title, description, owner, ownerType, priority, dueAt, source }) {
  return createTask({ title, description, owner, ownerType, priority, dueAt, source });
}

/**
 * Notify the Discord relay when a task status changes.
 * Currently logs; replace with actual HTTP call to discord-relay when available.
 */
export function notifyDiscordRelay(taskId, event) {
  const task = getTaskById(taskId);
  if (!task) return;

  const payload = { event, task };

  // TODO: Replace with actual HTTP POST to discord-relay service
  console.log('[TaskSyncBridge] Would notify discord-relay:', JSON.stringify(payload));
}

/**
 * Handle incoming webhook from discord-relay for task status updates.
 */
export function handleDiscordTaskUpdate(taskId, updates) {
  const result = updateTask(taskId, updates);
  return result;
}
