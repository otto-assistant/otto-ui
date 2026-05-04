import React from "react";
import { RiDashboardLine } from "@remixicon/react";

import { ActivityTimeline } from "./ActivityTimeline";
import { AgentStatusCard } from "./AgentStatusCard";
import { QuickStatsGrid } from "./QuickStatsGrid";
import { RecentSessions } from "./RecentSessions";
import { RunningTasks } from "./RunningTasks";
import { useDashboardStore } from "@/stores/useDashboardStore";
import { useSessionUIStore } from "@/sync/session-ui-store";
import { useUIStore } from "@/stores/useUIStore";
import { cn } from "@/lib/utils";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";

export const DashboardView: React.FC = () => {
  const status = useDashboardStore((state) => state.status);
  const agents = useDashboardStore((state) => state.agents);
  const activity = useDashboardStore((state) => state.activity);
  const stats = useDashboardStore((state) => state.stats);
  const runningTasks = useDashboardStore((state) => state.runningTasks);
  const recentSessions = useDashboardStore((state) => state.recentSessions);
  const isLoading = useDashboardStore((state) => state.isLoading);
  const error = useDashboardStore((state) => state.error);
  const fetchDashboard = useDashboardStore((state) => state.fetchDashboard);

  const setCurrentSession = useSessionUIStore((s) => s.setCurrentSession);
  const setActiveMainTab = useUIStore((s) => s.setActiveMainTab);

  React.useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  if (isLoading && !status) {
    return <LoadingSpinner size="lg" text="Loading dashboard…" className="h-full" />;
  }

  if (error && !status) {
    return <ErrorState message={error} onRetry={fetchDashboard} variant="full-page" />;
  }

  const statusLabel =
    typeof status?.healthy === "boolean" ? (status.healthy ? "Healthy" : "Degraded") : "Unknown";

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <div
              className="flex items-center gap-2 typography-ui-header font-semibold text-foreground"
              data-testid="view-dashboard-heading"
            >
              <RiDashboardLine size={22} aria-hidden />
              Dashboard
            </div>
            <div className="typography-ui text-muted-foreground">
              Agent status and recent activity.{status?.version ? ` Server v${status.version}` : ""}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div
              className={cn(
                "typography-micro inline-flex items-center rounded-full border px-2 py-1",
                status?.healthy === true &&
                  "border-[color:var(--status-success-border)] bg-[color:var(--status-success-background)] text-[color:var(--status-success-foreground)]",
                status?.healthy === false &&
                  "border-[color:var(--status-warning-border)] bg-[color:var(--status-warning-background)] text-[color:var(--status-warning-foreground)]",
                status?.healthy == null &&
                  "border-border bg-[var(--surface-elevated)] text-muted-foreground",
              )}
            >
              Status:{" "}
              <span className="ml-1 font-medium text-[color:inherit] opacity-95">{statusLabel}</span>
            </div>
          </div>
        </div>

        <div className="mt-6 space-y-6">
          <QuickStatsGrid stats={stats} />

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <section className="space-y-3">
              <div className="typography-ui font-semibold text-foreground">Agents</div>
              {agents.length === 0 ? (
                <EmptyState title="No agents" description="Agents will appear here once connected." />
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {agents.map((agent) => (
                    <AgentStatusCard key={agent.id} agent={agent} />
                  ))}
                </div>
              )}

              <div className="pt-3">
                <RunningTasks tasks={runningTasks} />
              </div>
            </section>

            <section className="space-y-6">
              <ActivityTimeline items={activity} />
              <RecentSessions
                sessions={recentSessions}
                onSelectSession={(sessionId) => {
                  setCurrentSession(sessionId);
                  setActiveMainTab("chat");
                }}
              />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};
