import React from 'react';
import { useTasksStore, type TaskStatus, type TaskRecurrence } from '@/stores/useTasksStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { triggerTaskNow } from '@/hooks/useTaskScheduler';

const STATUS_OPTIONS: TaskStatus[] = ['pending', 'in_progress', 'done', 'cancelled'];
const RECURRENCE_OPTIONS: { value: TaskRecurrence; label: string }[] = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

/** Convert ISO -> `YYYY-MM-DDTHH:mm` (local) for a datetime-local input. */
function isoToLocalDatetime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const TaskDetailDrawer: React.FC = () => {
  const open = useTasksStore((s) => s.detailDrawerOpen);
  const setOpen = useTasksStore((s) => s.setDetailDrawerOpen);
  const selectedId = useTasksStore((s) => s.selectedTaskId);
  const tasks = useTasksStore((s) => s.tasks);
  const updateTask = useTasksStore((s) => s.updateTask);
  const deleteTask = useTasksStore((s) => s.deleteTask);
  const markTaskTriggered = useTasksStore((s) => s.markTaskTriggered);
  const projects = useProjectsStore((s) => s.projects);

  const task = tasks.find((t) => t.id === selectedId);

  if (!open || !task) return null;

  const taskProject = task.projectId ? projects.find(p => p.id === task.projectId) : null;
  const dueLocal = isoToLocalDatetime(task.dueAt ?? task.dueDate ?? null);

  const handleTriggerNow = () => {
    setOpen(false);
    triggerTaskNow(task);
    markTaskTriggered(task.id);
  };

  const handleDueChange = (value: string) => {
    if (!value) {
      updateTask(task.id, { dueAt: null, dueDate: null });
      return;
    }
    const iso = new Date(value).toISOString();
    updateTask(task.id, { dueAt: iso, dueDate: iso });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setOpen(false)}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full max-w-md overflow-y-auto border-l border-border bg-card p-6 shadow-xl"
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-base font-semibold text-foreground">{task.title}</h2>
          <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>

        <p className="mb-4 text-sm text-muted-foreground whitespace-pre-wrap">{task.description || 'No description'}</p>

        <div className="mb-4 flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Status</span>
            <select
              value={task.status}
              onChange={(e) => updateTask(task.id, { status: e.target.value as TaskStatus })}
              className="rounded border border-border bg-background px-2 py-0.5 text-xs text-foreground"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Priority</span>
            <span className="text-foreground">{task.priority}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Owner</span>
            <span className="text-foreground">{task.ownerName}</span>
          </div>
          {(taskProject || task.projectPath) && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Project</span>
              <span className="text-foreground">{taskProject?.label || task.projectPath?.split('/').pop()}</span>
            </div>
          )}
          {task.agentName && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Agent</span>
              <span className="text-foreground">{task.agentName}</span>
            </div>
          )}
          {task.modelId && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Model</span>
              <span className="text-foreground">{task.modelId}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Due</span>
            <input
              type="datetime-local"
              value={dueLocal}
              onChange={(e) => handleDueChange(e.target.value)}
              className="rounded border border-border bg-background px-2 py-0.5 text-xs text-foreground"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Recurrence</span>
            <select
              value={task.recurrence ?? 'none'}
              onChange={(e) => updateTask(task.id, { recurrence: e.target.value as TaskRecurrence })}
              className="rounded border border-border bg-background px-2 py-0.5 text-xs text-foreground"
            >
              {RECURRENCE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
          {task.lastTriggeredAt && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Last triggered</span>
              <span className="text-foreground">{new Date(task.lastTriggeredAt).toLocaleString()}</span>
            </div>
          )}
        </div>

        <div className="mb-6">
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">History</h3>
          <div className="flex flex-col gap-1">
            {task.history.map((h, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{new Date(h.timestamp).toLocaleString()}</span>
                <span className="text-foreground">{h.action}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {task.status !== 'done' && task.status !== 'cancelled' && (
            <button
              onClick={handleTriggerNow}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              title={task.ownerType === 'user' ? 'Show the alert immediately (for testing)' : 'Start the agent session immediately'}
            >
              {task.ownerType === 'user' ? 'Trigger alert now' : 'Start session now'}
            </button>
          )}
          <button
            onClick={() => deleteTask(task.id)}
            className="rounded-md border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};
