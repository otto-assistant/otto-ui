import React from 'react';
import type { Task } from '@/stores/useTasksStore';
import { useTasksStore } from '@/stores/useTasksStore';

const OWNER_COLORS: Record<string, string> = {
  user: 'bg-blue-500/20 text-blue-400',
  agent: 'bg-green-500/20 text-green-400',
  cron: 'bg-orange-500/20 text-orange-400',
};

const PRIORITY_COLORS: Record<string, string> = {
  high: 'bg-red-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-400',
};

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  in_progress: 'bg-blue-500/20 text-blue-400',
  done: 'bg-green-500/20 text-green-400',
  cancelled: 'bg-red-500/20 text-red-400',
};

function formatDueAt(iso: string | null | undefined): { text: string; isOverdue: boolean } | null {
  if (!iso) return null;
  const d = new Date(iso);
  const diffMs = d.getTime() - Date.now();
  const isOverdue = diffMs < 0;
  const absMs = Math.abs(diffMs);
  const mins = Math.round(absMs / 60000);
  const hours = Math.round(absMs / 3600000);
  const days = Math.round(absMs / 86400000);
  let rel: string;
  if (mins < 1) rel = 'now';
  else if (mins < 60) rel = `${mins}m`;
  else if (hours < 24) rel = `${hours}h`;
  else rel = `${days}d`;
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const date = d.toLocaleDateString();
  const text = isOverdue
    ? `Overdue ${rel} (${date} ${time})`
    : `In ${rel} (${date} ${time})`;
  return { text, isOverdue };
}

export const TaskCard: React.FC<{ task: Task }> = ({ task }) => {
  const setSelectedTaskId = useTasksStore((s) => s.setSelectedTaskId);
  const setDetailDrawerOpen = useTasksStore((s) => s.setDetailDrawerOpen);

  const handleClick = () => {
    setSelectedTaskId(task.id);
    setDetailDrawerOpen(true);
  };

  const due = formatDueAt(task.dueAt ?? task.dueDate ?? null);

  return (
    <button
      onClick={handleClick}
      className="flex w-full items-center gap-3 rounded-lg border border-border/50 bg-card p-3 text-left transition-colors hover:bg-accent/50"
    >
      {/* Priority dot */}
      <span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_COLORS[task.priority]}`} />

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{task.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${OWNER_COLORS[task.ownerType]}`}>
            {task.ownerName}
          </span>
          {due && (
            <span className={`text-[10px] ${due.isOverdue && task.status !== 'done' ? 'text-red-400' : 'text-muted-foreground'}`}>
              {due.text}
            </span>
          )}
          {task.recurrence && task.recurrence !== 'none' && (
            <span className="text-[10px] text-muted-foreground">↻ {task.recurrence}</span>
          )}
          {task.agentName && (
            <span className="text-[10px] text-muted-foreground">🤖 {task.agentName}</span>
          )}
          {task.projectPath && (
            <span className="text-[10px] text-muted-foreground">📁 {task.projectPath.split('/').pop()}</span>
          )}
        </div>
      </div>

      {/* Status chip */}
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[task.status]}`}>
        {task.status.replace('_', ' ')}
      </span>
    </button>
  );
};
