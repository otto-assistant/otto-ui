import React from "react";
import { RiBarChart2Line, RiBrainLine, RiCheckboxCircleLine, RiChat3Line } from "@remixicon/react";

import type { DashboardStats } from "@/stores/useDashboardStore";

export interface QuickStatsGridProps {
  stats: DashboardStats;
}

export const QuickStatsGrid: React.FC<QuickStatsGridProps> = ({ stats }) => {
  const tiles = [
    {
      icon: RiChat3Line,
      label: "Messages today",
      value: stats.messagesToday,
      testId: "dashboard-stat-messages",
    },
    {
      icon: RiCheckboxCircleLine,
      label: "Tasks completed",
      value: stats.tasksCompleted,
      testId: "dashboard-stat-tasks",
    },
    {
      icon: RiBarChart2Line,
      label: "Active sessions",
      value: stats.activeSessions,
      testId: "dashboard-stat-sessions",
    },
    {
      icon: RiBrainLine,
      label: "Memory facts",
      value: stats.memoryFacts,
      testId: "dashboard-stat-memory",
    },
  ] as const;

  return (
    <div className="space-y-2">
      <div className="typography-ui font-semibold text-foreground">Quick stats</div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <div
              key={tile.label}
              data-testid={tile.testId}
              className="rounded-lg border border-border bg-[var(--surface-elevated)] p-3"
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
            </div>
          );
        })}
      </div>
    </div>
  );
};
