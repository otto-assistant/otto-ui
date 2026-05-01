import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { apiUrl } from '../lib/api-base';
import { useOttoEventsStore } from './useOttoEventsStore';

export type TaskPriority = 'high' | 'medium' | 'low';
export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'cancelled';
export type TaskOwnerType = 'user' | 'agent' | 'cron';
export type TaskFilter = 'all' | 'my_tasks' | 'agent' | 'scheduled' | 'done';
export type TaskSource = 'web' | 'discord' | 'cli';

export interface Task {
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  ownerType: TaskOwnerType;
  ownerName: string;
  owner?: string;
  dueDate: string | null;
  dueAt?: string | null;
  createdAt: string;
  updatedAt: string;
  source?: TaskSource;
  history: { timestamp: string; action: string }[];
}

interface TasksStore {
  tasks: Task[];
  filter: TaskFilter;
  isLoading: boolean;
  selectedTaskId: string | null;
  createDialogOpen: boolean;
  detailDrawerOpen: boolean;
  _wsSubscribed: boolean;

  setFilter: (filter: TaskFilter) => void;
  setSelectedTaskId: (id: string | null) => void;
  setCreateDialogOpen: (open: boolean) => void;
  setDetailDrawerOpen: (open: boolean) => void;
  fetchTasks: () => Promise<void>;
  createTask: (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'history' | 'status'>) => Promise<void>;
  updateTask: (id: string, updates: Partial<Task>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  subscribeToWebSocket: () => void;
  _applyRemoteTask: (eventType: string, data: Task) => void;
}

const MOCK_TASKS: Task[] = [
  {
    id: '1',
    title: 'Review PR #142 — auth refactor',
    description: 'Check the new token refresh logic and ensure backward compatibility with existing sessions.',
    priority: 'high',
    status: 'in_progress',
    ownerType: 'user',
    ownerName: 'You',
    dueDate: new Date(Date.now() + 86400000).toISOString(),
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    updatedAt: new Date(Date.now() - 1800000).toISOString(),
    history: [{ timestamp: new Date(Date.now() - 3600000).toISOString(), action: 'Created' }],
  },
  {
    id: '2',
    title: 'Deploy staging environment',
    description: 'Run the deploy pipeline for staging with the latest main branch.',
    priority: 'medium',
    status: 'pending',
    ownerType: 'agent',
    ownerName: 'Otto',
    dueDate: new Date(Date.now() + 172800000).toISOString(),
    createdAt: new Date(Date.now() - 7200000).toISOString(),
    updatedAt: new Date(Date.now() - 7200000).toISOString(),
    history: [{ timestamp: new Date(Date.now() - 7200000).toISOString(), action: 'Created' }],
  },
  {
    id: '3',
    title: 'Nightly backup verification',
    description: 'Automated check that nightly DB backup completed successfully.',
    priority: 'low',
    status: 'done',
    ownerType: 'cron',
    ownerName: 'Cron: backup-check',
    dueDate: null,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 43200000).toISOString(),
    history: [
      { timestamp: new Date(Date.now() - 86400000).toISOString(), action: 'Created' },
      { timestamp: new Date(Date.now() - 43200000).toISOString(), action: 'Completed' },
    ],
  },
  {
    id: '4',
    title: 'Update dependencies',
    description: 'Run bun update and check for breaking changes.',
    priority: 'medium',
    status: 'pending',
    ownerType: 'user',
    ownerName: 'You',
    dueDate: new Date(Date.now() + 604800000).toISOString(),
    createdAt: new Date(Date.now() - 172800000).toISOString(),
    updatedAt: new Date(Date.now() - 172800000).toISOString(),
    history: [{ timestamp: new Date(Date.now() - 172800000).toISOString(), action: 'Created' }],
  },
  {
    id: '5',
    title: 'Sync memory palace indexes',
    description: 'Scheduled re-index of memory palace embeddings.',
    priority: 'low',
    status: 'pending',
    ownerType: 'cron',
    ownerName: 'Cron: reindex',
    dueDate: new Date(Date.now() + 259200000).toISOString(),
    createdAt: new Date(Date.now() - 259200000).toISOString(),
    updatedAt: new Date(Date.now() - 259200000).toISOString(),
    history: [{ timestamp: new Date(Date.now() - 259200000).toISOString(), action: 'Created' }],
  },
];

const API_BASE = () => apiUrl('/api/otto/tasks');

export const useTasksStore = create<TasksStore>()(
  devtools(
    (set, get) => ({
      tasks: MOCK_TASKS,
      filter: 'all',
      isLoading: false,
      selectedTaskId: null,
      createDialogOpen: false,
      detailDrawerOpen: false,
      _wsSubscribed: false,

      setFilter: (filter) => set({ filter }),
      setSelectedTaskId: (id) => set({ selectedTaskId: id }),
      setCreateDialogOpen: (open) => set({ createDialogOpen: open }),
      setDetailDrawerOpen: (open) => set({ detailDrawerOpen: open }),

      _applyRemoteTask: (eventType, data) => {
        if (!data?.id) return;
        set((state) => {
          if (eventType === 'task.create') {
            const exists = state.tasks.some((t) => t.id === data.id);
            if (exists) return state;
            return { tasks: [data, ...state.tasks] };
          }
          if (eventType === 'task.update' || eventType === 'task.complete') {
            return { tasks: state.tasks.map((t) => (t.id === data.id ? { ...t, ...data } : t)) };
          }
          if (eventType === 'task.delete') {
            return { tasks: state.tasks.filter((t) => t.id !== data.id) };
          }
          return state;
        });
      },

      subscribeToWebSocket: () => {
        if (get()._wsSubscribed) return;
        set({ _wsSubscribed: true });

        const eventsStore = useOttoEventsStore.getState();
        if (typeof eventsStore.subscribe === 'function') {
          eventsStore.subscribe('task.*', (event: { eventType: string; data: Task }) => {
            get()._applyRemoteTask(event.eventType, event.data);
          });
        }
      },

      fetchTasks: async () => {
        set({ isLoading: true });
        try {
          const res = await fetch(API_BASE());
          if (res.ok) {
            const json = await res.json();
            const tasks = Array.isArray(json.tasks) ? json.tasks : Array.isArray(json) ? json : [];
            if (tasks.length > 0) set({ tasks });
          }
        } catch {
          // Use mock data on failure
        } finally {
          set({ isLoading: false });
        }
        // Subscribe to real-time updates after first fetch
        get().subscribeToWebSocket();
      },

      createTask: async (task) => {
        const newTask: Task = {
          ...task,
          id: crypto.randomUUID(),
          status: 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          source: 'web',
          history: [{ timestamp: new Date().toISOString(), action: 'Created' }],
        };
        // Optimistic: show immediately
        set((state) => ({ tasks: [newTask, ...state.tasks], createDialogOpen: false }));
        try {
          const res = await fetch(API_BASE(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...task, source: 'web' }) });
          if (res.ok) {
            const json = await res.json();
            if (json.task?.id) {
              // Replace optimistic with server-confirmed
              set((state) => ({ tasks: state.tasks.map((t) => (t.id === newTask.id ? { ...t, ...json.task } : t)) }));
            }
          }
        } catch {
          // offline — keep optimistic
        }
      },

      updateTask: async (id, updates) => {
        const updatedAt = new Date().toISOString();
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id
              ? { ...t, ...updates, updatedAt, history: [...t.history, { timestamp: updatedAt, action: `Updated: ${Object.keys(updates).join(', ')}` }] }
              : t,
          ),
        }));
        try {
          await fetch(`${API_BASE()}/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) });
        } catch {
          // offline
        }
      },

      deleteTask: async (id) => {
        set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id), detailDrawerOpen: false, selectedTaskId: null }));
        try {
          await fetch(`${API_BASE()}/${id}`, { method: 'DELETE' });
        } catch {
          // offline
        }
      },
    }),
    { name: 'tasks-store' },
  ),
);
