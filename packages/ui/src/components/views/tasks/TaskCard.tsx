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

function relativeDate(iso: string | null): string {
  if (!iso) return '';
  const diff = new Date(iso).getTime() - Date.now();
  const days = Math.round(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 0) return `In ${days}d`;
  return `${Math.abs(days)}d ago`;
}

export const TaskCard: React.FC<{ task: Task }> = ({ task }) => {
  const setSelectedTaskId = useTasksStore((s) => s.setSelectedTaskId);
  const setDetailDrawerOpen = useTasksStore((s) => s.setDetailDrawerOpen);

  const handleClick = () => {
    setSelectedTaskId(task.id);
    setDetailDrawerOpen(true);
  };

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
        <div className="mt-1 flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${OWNER_COLORS[task.ownerType]}`}>
            {task.ownerName}
          </span>
          {task.dueDate && (
            <span className="text-[10px] text-muted-foreground">{relativeDate(task.dueDate)}</span>
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
