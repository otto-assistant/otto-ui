import React, { useState } from "react";
import { useTasksStore, type Task } from "@/stores/useTasksStore";
import { triggerTaskNow } from "@/hooks/useTaskScheduler";

const statusColors: Record<string, string> = {
  pending: "bg-muted-foreground",
  in_progress: "bg-blue-500",
  done: "bg-green-500",
  cancelled: "bg-red-500",
};

interface ScheduleTaskCardProps {
  task: Task;
  compact?: boolean;
}

/**
 * Renders a Task as a calendar item. The schedule view now renders tasks
 * directly — the previous `ScheduleEvent` model has been retired and tasks
 * are the single source of truth for both list and calendar views.
 */
export const ScheduleTaskCard: React.FC<ScheduleTaskCardProps> = ({ task, compact }) => {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const setSelectedTaskId = useTasksStore((s) => s.setSelectedTaskId);
  const setDetailDrawerOpen = useTasksStore((s) => s.setDetailDrawerOpen);
  const deleteTask = useTasksStore((s) => s.deleteTask);
  const markTaskTriggered = useTasksStore((s) => s.markTaskTriggered);

  const status = statusColors[task.status] ?? statusColors.pending;
  const isRecurring = task.recurrence && task.recurrence !== "none";

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => {
          setSelectedTaskId(task.id);
          setDetailDrawerOpen(true);
        }}
        className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-xs bg-muted/50 hover:bg-muted transition-colors text-left"
        title={task.title}
      >
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${status}`} />
        <span className="truncate text-foreground">{task.title}</span>
        {task.hidden && <span className="text-[10px] text-purple-400">🔒</span>}
      </button>
    );
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    deleteTask(task.id);
  };

  const handleRunNow = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    triggerTaskNow(task);
    markTaskTriggered(task.id);
  };

  const handleOpen = () => {
    setSelectedTaskId(task.id);
    setDetailDrawerOpen(true);
  };

  return (
    <div
      onClick={handleOpen}
      className="group flex cursor-pointer flex-col gap-1 rounded-lg border border-border bg-card p-3 hover:bg-muted/30 transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`h-2 w-2 rounded-full shrink-0 ${status}`} />
          <span className="text-muted-foreground" title={isRecurring ? "Recurring" : "One-time"}>
            {isRecurring ? "🔄" : "⏱"}
          </span>
          <span className="truncate font-medium text-sm text-foreground">{task.title}</span>
          {task.hidden && (
            <span
              className="rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-medium text-purple-400"
              title="Hidden run — conversation hidden until REPORT:"
            >
              🔒 Hidden
            </span>
          )}
        </div>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {task.status !== "done" && task.status !== "cancelled" && (
            <button
              onClick={handleRunNow}
              className="rounded px-1.5 py-0.5 text-[10px] font-medium text-primary bg-primary/10 hover:bg-primary/20"
            >
              Run now
            </button>
          )}
          <button
            onClick={handleDelete}
            className={`text-xs ${confirmDelete ? "text-destructive font-medium" : "text-muted-foreground hover:text-destructive"}`}
          >
            {confirmDelete ? "Confirm?" : "✕"}
          </button>
        </div>
      </div>
      <div className="text-xs text-muted-foreground pl-6 flex flex-wrap gap-x-3 gap-y-0.5">
        {task.dueAt && <span>{new Date(task.dueAt).toLocaleString()}</span>}
        {isRecurring && <span>↻ {task.recurrence}</span>}
        {task.agentName && <span>🤖 {task.agentName}</span>}
        {task.projectPath && <span>📁 {task.projectPath.split("/").pop()}</span>}
      </div>
    </div>
  );
};

// Backwards-compat alias — some code may still import ScheduleEventCard.
export const ScheduleEventCard = ScheduleTaskCard;
