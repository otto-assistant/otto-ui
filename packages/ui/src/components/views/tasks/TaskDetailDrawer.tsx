import React from 'react';
import { useTasksStore, type TaskStatus } from '@/stores/useTasksStore';

const STATUS_OPTIONS: TaskStatus[] = ['pending', 'in_progress', 'done', 'cancelled'];

export const TaskDetailDrawer: React.FC = () => {
  const open = useTasksStore((s) => s.detailDrawerOpen);
  const setOpen = useTasksStore((s) => s.setDetailDrawerOpen);
  const selectedId = useTasksStore((s) => s.selectedTaskId);
  const tasks = useTasksStore((s) => s.tasks);
  const updateTask = useTasksStore((s) => s.updateTask);
  const deleteTask = useTasksStore((s) => s.deleteTask);

  const task = tasks.find((t) => t.id === selectedId);

  if (!open || !task) return null;

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

        <p className="mb-4 text-sm text-muted-foreground">{task.description || 'No description'}</p>

        <div className="mb-4 flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
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
          <div className="flex justify-between">
            <span className="text-muted-foreground">Priority</span>
            <span className="text-foreground">{task.priority}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Owner</span>
            <span className="text-foreground">{task.ownerName}</span>
          </div>
          {task.dueDate && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Due</span>
              <span className="text-foreground">{new Date(task.dueDate).toLocaleDateString()}</span>
            </div>
          )}
        </div>

        {/* History */}
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

        <div className="flex gap-2">
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
