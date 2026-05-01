import crypto from 'crypto';
import { broadcast } from './websocket.js';

/** @type {import('./task-store.js').Task[]} */
const tasks = [];

/**
 * @typedef {{
 *   id: string;
 *   title: string;
 *   description: string;
 *   owner: string;
 *   ownerType: 'user' | 'agent' | 'cron';
 *   priority: 'high' | 'medium' | 'low';
 *   status: 'pending' | 'in_progress' | 'done' | 'cancelled';
 *   createdAt: string;
 *   updatedAt: string;
 *   dueAt: string | null;
 *   source: 'web' | 'discord' | 'cli';
 * }} Task
 */

export function getAllTasks() {
  return tasks.slice();
}

export function getTaskById(id) {
  return tasks.find((t) => t.id === id) ?? null;
}

export function createTask({ title, description, owner, ownerType, priority, dueAt, source }) {
  const now = new Date().toISOString();
  const task = {
    id: crypto.randomUUID(),
    title,
    description: description ?? '',
    owner: owner ?? 'unknown',
    ownerType: ownerType ?? 'user',
    priority: priority ?? 'medium',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    dueAt: dueAt ?? null,
    source: source ?? 'web',
  };
  tasks.unshift(task);
  broadcast('task.create', task);
  return task;
}

export function updateTask(id, updates) {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return null;

  const now = new Date().toISOString();
  const allowed = ['title', 'description', 'owner', 'ownerType', 'priority', 'status', 'dueAt'];
  const patch = {};
  for (const key of allowed) {
    if (key in updates) patch[key] = updates[key];
  }

  tasks[index] = { ...tasks[index], ...patch, updatedAt: now };
  const eventType = tasks[index].status === 'done' ? 'task.complete' : 'task.update';
  broadcast(eventType, tasks[index]);
  return tasks[index];
}

export function deleteTask(id) {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return false;
  const [removed] = tasks.splice(index, 1);
  broadcast('task.delete', removed);
  return true;
}
