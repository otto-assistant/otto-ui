import React from "react";
import { RiBarChart2Line, RiBrainLine, RiCheckboxCircleLine, RiChat3Line } from "@remixicon/react";

import type { DashboardStats } from "@/stores/useDashboardStore";
import type { AppActiveView } from "@/constants/agentNav";
import { useUIStore } from "@/stores/useUIStore";
import { openMemorySettings } from "@/lib/navigation/openMemorySettings";

export interface QuickStatsGridProps {
  stats: DashboardStats;
}

type Tile = {
  icon: typeof RiChat3Line;
  label: string;
  value: number;
  testId: string;
  onClick: () => void;
};

export const QuickStatsGrid: React.FC<QuickStatsGridProps> = ({ stats }) => {
  const setActiveView = useUIStore((s) => s.setActiveView);
  const goTo = (view: AppActiveView) => () => setActiveView(view);

  const tiles: Tile[] = [
    {
      icon: RiChat3Line,
      label: "Messages today",
      value: stats.messagesToday,
      testId: "dashboard-stat-messages",
      onClick: goTo("chat"),
    },
    {
      icon: RiCheckboxCircleLine,
      label: "Tasks completed",
      value: stats.tasksCompleted,
      testId: "dashboard-stat-tasks",
      onClick: goTo("tasks"),
    },
    {
      icon: RiBarChart2Line,
      label: "Active sessions",
      value: stats.activeSessions,
      testId: "dashboard-stat-sessions",
      onClick: goTo("chat"),
    },
    {
      icon: RiBrainLine,
      label: "Memory facts",
      value: stats.memoryFacts,
      testId: "dashboard-stat-memory",
      onClick: openMemorySettings,
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
              onClick={tile.onClick}
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
