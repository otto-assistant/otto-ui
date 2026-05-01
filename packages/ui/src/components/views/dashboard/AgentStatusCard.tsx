import React from "react";
import { cn } from "@/lib/utils";
import type { AgentRunStatus, DashboardAgentCard } from "@/stores/useDashboardStore";

const statusPresentation: Record<
  AgentRunStatus,
  {
    label: string;
    className: string;
  }
> = {
  Running: {
    label: "Running",
    className:
      "border-[color:var(--status-success-border)] bg-[color:var(--status-success-background)] text-[color:var(--status-success-foreground)]",
  },
  Idle: {
    label: "Idle",
    className:
      "border-[color:var(--status-info-border)] bg-[color:var(--status-info-background)] text-[color:var(--status-info-foreground)]",
  },
  Error: {
    label: "Error",
    className:
      "border-[color:var(--status-error-border)] bg-[color:var(--status-error-background)] text-[color:var(--status-error-foreground)]",
  },
};

function formatUptime(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 48) return `${Math.floor(h / 24)}d`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

export interface AgentStatusCardProps {
  agent: DashboardAgentCard;
}

export const AgentStatusCard: React.FC<AgentStatusCardProps> = ({ agent }) => {
  const preset = statusPresentation[agent.status];

  return (
    <div className={cn("rounded-lg border border-border bg-[var(--surface-elevated)] p-4")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="truncate typography-ui font-semibold text-foreground">{agent.name}</div>
          <div className="typography-micro text-muted-foreground">
            Model{" "}
            <span className="text-foreground">
              <span className="opacity-80">:</span> {agent.model ?? "Default"}
            </span>
          </div>
        </div>

        <span
          className={cn(
            "typography-micro inline-flex shrink-0 items-center rounded-full border px-2 py-0.5",
            preset.className,
          )}
        >
          {preset.label}
        </span>
      </div>

      <div className="typography-micro mt-3 text-muted-foreground">
        Uptime{" "}
        <span className="text-foreground">
          <span className="opacity-80">:</span> {formatUptime(agent.uptimeMs)}
        </span>
      </div>
    </div>
  );
};
