import React from "react";

import type { DashboardRunningTask } from "@/stores/useDashboardStore";
import { useUIStore } from "@/stores/useUIStore";

export interface RunningTasksProps {
  tasks: DashboardRunningTask[];
}

export const RunningTasks: React.FC<RunningTasksProps> = ({ tasks }) => {
  const setActiveView = useUIStore((s) => s.setActiveView);

  if (tasks.length === 0) {
    return (
      <button
        type="button"
        onClick={() => setActiveView('tasks')}
        className="w-full rounded-lg border border-border bg-[var(--surface-elevated)] p-4 typography-ui text-muted-foreground text-left transition-colors hover:border-primary/30"
      >
        No running tasks
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <div className="typography-ui font-semibold text-foreground">Running tasks</div>
      <button
        type="button"
        onClick={() => setActiveView('tasks')}
        className="w-full space-y-3 rounded-lg border border-border bg-[var(--surface-elevated)] p-4 text-left transition-colors hover:border-primary/30"
      >
        {tasks.map((task) => (
          <div key={task.id} className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 typography-ui font-medium text-foreground">{task.title}</div>
              <div className="typography-micro tabular-nums text-muted-foreground">{task.progress}%</div>
            </div>

            <div className="h-2 rounded-full bg-[color:var(--surface-muted)]">
              <div
                className="h-2 rounded-full bg-[color:var(--primary-base)]"
                style={{ width: `${Math.min(100, Math.max(0, task.progress))}%` }}
              />
            </div>
          </div>
        ))}
      </button>
    </div>
  );
};
