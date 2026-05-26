import { useEffect } from 'react';
import { toast } from '@/components/ui/toast';
import { useTasksStore, type Task } from '@/stores/useTasksStore';
import { useUIStore } from '@/stores/useUIStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useConfigStore } from '@/stores/useConfigStore';
import { useProjectsStore } from '@/stores/useProjectsStore';

const POLL_INTERVAL_MS = 15_000;
const GRACE_PERIOD_MS = 60_000;

const isDue = (task: Task, now: number): boolean => {
  if (task.status === 'done' || task.status === 'cancelled') return false;
  if (!task.dueAt) return false;
  const due = new Date(task.dueAt).getTime();
  if (!Number.isFinite(due)) return false;
  if (due > now) return false;
  // Avoid re-firing within a short grace window after the last trigger.
  if (task.lastTriggeredAt) {
    const last = new Date(task.lastTriggeredAt).getTime();
    if (Number.isFinite(last) && now - last < GRACE_PERIOD_MS) return false;
  }
  return true;
};

const buildAgentPrompt = (task: Task): string => {
  const lines: string[] = [];
  lines.push(`# Task: ${task.title}`);
  if (task.description.trim()) {
    lines.push('');
    lines.push(task.description.trim());
  }
  lines.push('');
  lines.push(`**Priority:** ${task.priority}`);
  if (task.recurrence && task.recurrence !== 'none') {
    lines.push(`**Recurrence:** ${task.recurrence}`);
  }
  if (task.dueAt) {
    lines.push(`**Scheduled for:** ${new Date(task.dueAt).toLocaleString()}`);
  }
  lines.push('');
  lines.push('Please work on this task now.');
  return lines.join('\n');
};

const requestNotificationPermissionOnce = (() => {
  let requested = false;
  return () => {
    if (requested) return;
    if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') {
      requested = true;
      Notification.requestPermission().catch(() => { /* ignored */ });
    }
  };
})();

const showNativeNotification = (task: Task) => {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  try {
    const due = task.dueAt ? new Date(task.dueAt).toLocaleString() : '';
    new Notification(`Task due: ${task.title}`, {
      body: [task.description, due ? `Scheduled for ${due}` : null].filter(Boolean).join('\n') || 'Task is due now.',
      tag: `otto-task-${task.id}`,
      requireInteraction: task.priority === 'high',
    });
  } catch {
    // Notifications API can throw on some platforms (e.g. SecurityError).
  }
};

/** Trigger a single due task. Side-effects: toast/notification or chat draft. */
export const triggerTaskNow = (task: Task): void => {
  const setActiveView = useUIStore.getState().setActiveView;
  const openNewSessionDraft = useSessionUIStore.getState().openNewSessionDraft;
  const projects = useProjectsStore.getState().projects;
  const taskProject = task.projectId ? projects.find((p) => p.id === task.projectId) : null;
  const directory = task.projectPath ?? taskProject?.path ?? undefined;

  if (task.ownerType === 'user') {
    const dueText = task.dueAt ? ` (scheduled ${new Date(task.dueAt).toLocaleString()})` : '';
    toast.warning(`Task due: ${task.title}`, {
      description: (task.description || 'No description').slice(0, 200) + dueText,
      duration: 15000,
      action: {
        label: 'View',
        onClick: () => {
          useUIStore.getState().setActiveView('tasks');
          useTasksStore.getState().setSelectedTaskId(task.id);
          useTasksStore.getState().setDetailDrawerOpen(true);
        },
      },
    });
    showNativeNotification(task);
    return;
  }

  // Agent or cron task: open a new chat session draft with task info.
  if (task.agentName) {
    try {
      useConfigStore.getState().setAgent(task.agentName);
    } catch { /* config may not be ready */ }
  }

  setActiveView('chat');
  openNewSessionDraft({
    title: `Task: ${task.title}`,
    initialPrompt: buildAgentPrompt(task),
    directoryOverride: directory,
    syntheticParts: task.description
      ? [{ text: `Task details:\n${task.description}\n\nPriority: ${task.priority}`, synthetic: true }]
      : undefined,
  });

  toast.info(`Starting agent session for task: ${task.title}`, {
    description: task.agentName ? `Agent: ${task.agentName}` : undefined,
    duration: 6000,
  });
};

/**
 * Polls the task list on a fixed interval and fires due tasks.
 * Mount this once at the app shell.
 */
export const useTaskScheduler = (): void => {
  useEffect(() => {
    requestNotificationPermissionOnce();

    const tick = () => {
      const { tasks, markTaskTriggered } = useTasksStore.getState();
      const now = Date.now();
      for (const task of tasks) {
        if (!isDue(task, now)) continue;
        try {
          triggerTaskNow(task);
        } finally {
          markTaskTriggered(task.id);
        }
      }
    };

    // Fire any tasks that became due while the user was away, then schedule polling.
    tick();
    const handle = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, []);
};
