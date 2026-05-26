import { create } from 'zustand';
import { devtools, persist, createJSONStorage } from 'zustand/middleware';
import { apiUrl } from '../lib/api-base';
import { safeRandomUUID } from '../lib/uuid';
import { useOttoEventsStore } from './useOttoEventsStore';
import { getSafeStorage } from './utils/safeStorage';

export type TaskPriority = 'high' | 'medium' | 'low';
export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'cancelled';
export type TaskOwnerType = 'user' | 'agent' | 'cron';
export type TaskFilter = 'all' | 'my_tasks' | 'agent' | 'scheduled' | 'done';
export type TaskSource = 'web' | 'discord' | 'cli';
export type TaskRecurrence = 'none' | 'daily' | 'weekly' | 'monthly';

export interface Task {
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  ownerType: TaskOwnerType;
  ownerName: string;
  owner?: string;
  /** ISO timestamp (date + time) the task is due to fire. */
  dueAt: string | null;
  /** @deprecated kept for backwards-compat with older payloads — mirrors dueAt. */
  dueDate?: string | null;
  /** Repeat cadence; 'none' for one-off tasks. */
  recurrence: TaskRecurrence;
  /** ISO timestamp of the last time the task was triggered. */
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
  source?: TaskSource;
  projectId?: string | null;
  projectPath?: string | null;
  agentName?: string | null;
  modelId?: string | null;
  providerId?: string | null;
  history: { timestamp: string; action: string }[];
}

interface TasksStore {
  tasks: Task[];
  filter: TaskFilter;
  isLoading: boolean;
  error: string | null;
  selectedTaskId: string | null;
  createDialogOpen: boolean;
  detailDrawerOpen: boolean;
  _wsSubscribed: boolean;
  _lastFetchedAt: number;

  setFilter: (filter: TaskFilter) => void;
  setSelectedTaskId: (id: string | null) => void;
  setCreateDialogOpen: (open: boolean) => void;
  setDetailDrawerOpen: (open: boolean) => void;
  fetchTasks: () => Promise<void>;
  createTask: (
    task: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'history' | 'status' | 'lastTriggeredAt'>,
  ) => Promise<Task>;
  updateTask: (id: string, updates: Partial<Task>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  /** Mark a task as triggered now; advance dueAt if recurrent, else mark done. */
  markTaskTriggered: (id: string) => void;
  subscribeToWebSocket: () => void;
  _applyRemoteTask: (eventType: string, data: Task) => void;
}

/** Add one cadence step to an ISO datetime. Returns ISO or null. */
export function advanceRecurrence(iso: string | null, recurrence: TaskRecurrence): string | null {
  if (!iso || recurrence === 'none') return null;
  const base = new Date(iso);
  if (Number.isNaN(base.getTime())) return null;
  // Advance forward until the new time is strictly in the future (handles missed runs).
  const now = Date.now();
  const next = new Date(base.getTime());
  let safety = 0;
  do {
    if (recurrence === 'daily') {
      next.setDate(next.getDate() + 1);
    } else if (recurrence === 'weekly') {
      next.setDate(next.getDate() + 7);
    } else if (recurrence === 'monthly') {
      next.setMonth(next.getMonth() + 1);
    }
    safety += 1;
  } while (next.getTime() <= now && safety < 366);
  return next.toISOString();
}

const MOCK_TASKS: Task[] = [
  {
    id: 'demo-1',
    title: 'Review PR #142 — auth refactor',
    description: 'Check the new token refresh logic and ensure backward compatibility with existing sessions.',
    priority: 'high',
    status: 'in_progress',
    ownerType: 'user',
    ownerName: 'You',
    dueAt: new Date(Date.now() + 86400000).toISOString(),
    recurrence: 'none',
    lastTriggeredAt: null,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    updatedAt: new Date(Date.now() - 1800000).toISOString(),
    history: [{ timestamp: new Date(Date.now() - 3600000).toISOString(), action: 'Created' }],
  },
  {
    id: 'demo-2',
    title: 'Deploy staging environment',
    description: 'Run the deploy pipeline for staging with the latest main branch.',
    priority: 'medium',
    status: 'pending',
    ownerType: 'agent',
    ownerName: 'Otto',
    dueAt: new Date(Date.now() + 172800000).toISOString(),
    recurrence: 'none',
    lastTriggeredAt: null,
    createdAt: new Date(Date.now() - 7200000).toISOString(),
    updatedAt: new Date(Date.now() - 7200000).toISOString(),
    history: [{ timestamp: new Date(Date.now() - 7200000).toISOString(), action: 'Created' }],
  },
  {
    id: 'demo-3',
    title: 'Nightly backup verification',
    description: 'Automated check that nightly DB backup completed successfully.',
    priority: 'low',
    status: 'pending',
    ownerType: 'cron',
    ownerName: 'Cron: backup-check',
    dueAt: new Date(Date.now() + 6 * 3600000).toISOString(),
    recurrence: 'daily',
    lastTriggeredAt: null,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 43200000).toISOString(),
    history: [{ timestamp: new Date(Date.now() - 86400000).toISOString(), action: 'Created' }],
  },
];

const API_BASE = () => apiUrl('/api/otto/tasks');

/** Normalize any task-like shape (from API, persisted state, etc.) into a Task. */
function normalizeTask(input: Partial<Task> & { id?: string; title?: string }): Task {
  const id = typeof input.id === 'string' && input.id ? input.id : safeRandomUUID();
  const due = (typeof input.dueAt === 'string' && input.dueAt)
    ? input.dueAt
    : (typeof input.dueDate === 'string' && input.dueDate ? input.dueDate : null);
  return {
    id,
    title: input.title ?? '(untitled)',
    description: input.description ?? '',
    priority: (input.priority as TaskPriority) ?? 'medium',
    status: (input.status as TaskStatus) ?? 'pending',
    ownerType: (input.ownerType as TaskOwnerType) ?? 'user',
    ownerName: input.ownerName ?? input.owner ?? 'You',
    owner: input.owner,
    dueAt: due,
    dueDate: due,
    recurrence: (input.recurrence as TaskRecurrence) ?? 'none',
    lastTriggeredAt: input.lastTriggeredAt ?? null,
    createdAt: input.createdAt ?? new Date().toISOString(),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    source: input.source,
    projectId: input.projectId ?? null,
    projectPath: input.projectPath ?? null,
    agentName: input.agentName ?? null,
    modelId: input.modelId ?? null,
    providerId: input.providerId ?? null,
    history: Array.isArray(input.history) ? input.history : [
      { timestamp: new Date().toISOString(), action: 'Created' },
    ],
  };
}

export const useTasksStore = create<TasksStore>()(
  devtools(
    persist(
      (set, get) => ({
        tasks: MOCK_TASKS,
        filter: 'all',
        isLoading: false,
        error: null,
        selectedTaskId: null,
        createDialogOpen: false,
        detailDrawerOpen: false,
        _wsSubscribed: false,
        _lastFetchedAt: 0,

        setFilter: (filter) => set({ filter }),
        setSelectedTaskId: (id) => set({ selectedTaskId: id }),
        setCreateDialogOpen: (open) => set({ createDialogOpen: open }),
        setDetailDrawerOpen: (open) => set({ detailDrawerOpen: open }),

        _applyRemoteTask: (eventType, data) => {
          if (!data?.id) return;
          const normalized = normalizeTask(data);
          set((state) => {
            if (eventType === 'task.create') {
              const exists = state.tasks.some((t) => t.id === normalized.id);
              if (exists) return state;
              return { tasks: [normalized, ...state.tasks] };
            }
            if (eventType === 'task.update' || eventType === 'task.complete') {
              return { tasks: state.tasks.map((t) => (t.id === normalized.id ? { ...t, ...normalized } : t)) };
            }
            if (eventType === 'task.delete') {
              return { tasks: state.tasks.filter((t) => t.id !== normalized.id) };
            }
            return state;
          });
        },

        subscribeToWebSocket: () => {
          if (get()._wsSubscribed) return;
          set({ _wsSubscribed: true });

          const eventsStore = useOttoEventsStore.getState();
          if (typeof eventsStore.subscribeToEvents === 'function') {
            eventsStore.subscribeToEvents((event) => {
              if (event.eventType.startsWith('task.')) {
                get()._applyRemoteTask(event.eventType, event.data as Task);
              }
            });
          }
        },

        fetchTasks: async () => {
          const STALE_MS = 30_000;
          const cur = get();
          if (cur.tasks.length > 0 && cur._lastFetchedAt && Date.now() - cur._lastFetchedAt < STALE_MS) {
            return;
          }
          set({ isLoading: true, error: null });
          try {
            const res = await fetch(API_BASE());
            if (res.ok) {
              const json = await res.json();
              const raw = Array.isArray(json.tasks) ? json.tasks : Array.isArray(json) ? json : [];
              if (raw.length > 0) {
                // Merge: keep locally-created tasks the server doesn't know about (offline-first).
                const local = get().tasks;
                const serverIds = new Set(raw.map((t: { id: string }) => t.id));
                const localOnly = local.filter((t) => !serverIds.has(t.id) && t.source === 'web');
                const merged = [...raw.map((t: Partial<Task>) => normalizeTask(t)), ...localOnly];
                set({ tasks: merged });
              }
            } else if (res.status >= 500) {
              set({ error: `Server error (${res.status})` });
            }
          } catch {
            // keep existing tasks (mock or previously loaded) on network failure
          } finally {
            set({ isLoading: false, _lastFetchedAt: Date.now() });
          }
          // Subscribe to real-time updates after first fetch
          get().subscribeToWebSocket();
        },

        createTask: async (task) => {
          const now = new Date().toISOString();
          const newTask: Task = normalizeTask({
            ...task,
            id: safeRandomUUID(),
            status: 'pending',
            createdAt: now,
            updatedAt: now,
            source: 'web',
            lastTriggeredAt: null,
            history: [{ timestamp: now, action: 'Created' }],
          });
          // Optimistic: show immediately
          set((state) => ({ tasks: [newTask, ...state.tasks], createDialogOpen: false }));
          try {
            const res = await fetch(API_BASE(), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...task,
                source: 'web',
                dueAt: newTask.dueAt,
                dueDate: newTask.dueAt,
              }),
            });
            if (res.ok) {
              const json = await res.json();
              if (json.task?.id) {
                // Replace optimistic with server-confirmed (preserve fields the server may not echo back)
                set((state) => ({
                  tasks: state.tasks.map((t) =>
                    t.id === newTask.id
                      ? normalizeTask({ ...t, ...json.task, id: t.id })
                      : t,
                  ),
                }));
              }
            }
          } catch {
            // offline — keep optimistic
          }
          return newTask;
        },

        updateTask: async (id, updates) => {
          const updatedAt = new Date().toISOString();
          set((state) => ({
            tasks: state.tasks.map((t) => {
              if (t.id !== id) return t;
              // Mirror dueAt <-> dueDate on update
              const mirroredUpdates: Partial<Task> = { ...updates };
              if ('dueAt' in updates) mirroredUpdates.dueDate = updates.dueAt;
              if ('dueDate' in updates && !('dueAt' in updates)) mirroredUpdates.dueAt = updates.dueDate ?? null;
              const changedKeys = Object.keys(mirroredUpdates).filter((k) => k !== 'history' && k !== 'updatedAt');
              const action = changedKeys.length > 0
                ? `Updated: ${changedKeys.join(', ')}`
                : 'Updated';
              return {
                ...t,
                ...mirroredUpdates,
                updatedAt,
                history: [...t.history, { timestamp: updatedAt, action }],
              };
            }),
          }));
          try {
            await fetch(`${API_BASE()}/${id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(updates),
            });
          } catch {
            // offline
          }
        },

        deleteTask: async (id) => {
          set((state) => ({
            tasks: state.tasks.filter((t) => t.id !== id),
            detailDrawerOpen: false,
            selectedTaskId: null,
          }));
          try {
            await fetch(`${API_BASE()}/${id}`, { method: 'DELETE' });
          } catch {
            // offline
          }
        },

        markTaskTriggered: (id) => {
          const now = new Date().toISOString();
          set((state) => ({
            tasks: state.tasks.map((t) => {
              if (t.id !== id) return t;
              const isRecurrent = t.recurrence && t.recurrence !== 'none';
              const nextDueAt = isRecurrent ? advanceRecurrence(t.dueAt, t.recurrence) : null;
              const nextStatus: TaskStatus = isRecurrent
                ? 'pending'
                : (t.ownerType === 'user' ? 'in_progress' : 'done');
              return {
                ...t,
                lastTriggeredAt: now,
                dueAt: nextDueAt,
                dueDate: nextDueAt,
                status: nextStatus,
                updatedAt: now,
                history: [
                  ...t.history,
                  { timestamp: now, action: isRecurrent ? 'Triggered (recurring)' : 'Triggered' },
                ],
              };
            }),
          }));
          // Fire-and-forget remote update
          const updated = get().tasks.find((t) => t.id === id);
          if (updated) {
            fetch(`${API_BASE()}/${id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                status: updated.status,
                dueAt: updated.dueAt,
                lastTriggeredAt: updated.lastTriggeredAt,
              }),
            }).catch(() => { /* offline */ });
          }
        },
      }),
      {
        name: 'otto-tasks-store',
        version: 1,
        storage: createJSONStorage(() => getSafeStorage()),
        partialize: (state) => ({
          tasks: state.tasks,
          filter: state.filter,
        }),
        onRehydrateStorage: () => (state) => {
          if (!state) return;
          // Normalize legacy entries that only have `dueDate`.
          state.tasks = state.tasks.map((t) => normalizeTask(t));
        },
      },
    ),
    { name: 'tasks-store' },
  ),
);
