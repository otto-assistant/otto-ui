import React from "react";
import { RiBarChart2Line, RiBrainLine, RiCheckboxCircleLine, RiChat3Line } from "@remixicon/react";

import type { DashboardStats } from "@/stores/useDashboardStore";
import type { AppActiveView } from "@/constants/agentNav";
import { useUIStore } from "@/stores/useUIStore";

export interface QuickStatsGridProps {
  stats: DashboardStats;
}

export const QuickStatsGrid: React.FC<QuickStatsGridProps> = ({ stats }) => {
  const setActiveView = useUIStore((s) => s.setActiveView);

  const tiles: { icon: typeof RiChat3Line; label: string; value: number; testId: string; target: AppActiveView }[] = [
    {
      icon: RiChat3Line,
      label: "Messages today",
      value: stats.messagesToday,
      testId: "dashboard-stat-messages",
      target: "chat",
    },
    {
      icon: RiCheckboxCircleLine,
      label: "Tasks completed",
      value: stats.tasksCompleted,
      testId: "dashboard-stat-tasks",
      target: "tasks",
    },
    {
      icon: RiBarChart2Line,
      label: "Active sessions",
      value: stats.activeSessions,
      testId: "dashboard-stat-sessions",
      target: "chat",
    },
    {
      icon: RiBrainLine,
      label: "Memory facts",
      value: stats.memoryFacts,
      testId: "dashboard-stat-memory",
      target: "memory",
    },
  ];

  return (
    <div className="space-y-2">
      <div className="typography-ui font-semibold text-foreground">Quick stats</div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <button
              key={tile.label}
              type="button"
              data-testid={tile.testId}
              onClick={() => setActiveView(tile.target)}
              className="rounded-lg border border-border bg-[var(--surface-elevated)] p-3 text-left transition-colors hover:bg-[var(--surface-elevated-hover,var(--surface-elevated))] hover:border-primary/30"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-muted-foreground">
                  <Icon size={18} aria-hidden />
                </div>
                <div className="typography-ui-header font-semibold tabular-nums text-foreground">
                  {tile.value}
                </div>
              </div>
              <div className="typography-micro mt-2 text-muted-foreground">{tile.label}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
