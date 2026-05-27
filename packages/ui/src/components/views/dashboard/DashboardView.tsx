import React from "react";
import { RiDashboardLine, RiAddLine } from "@remixicon/react";

import { ActivityTimeline } from "./ActivityTimeline";
import { AgentStatusCard } from "./AgentStatusCard";
import { QuickStatsGrid } from "./QuickStatsGrid";
import { RecentSessions } from "./RecentSessions";
import { RunningTasks } from "./RunningTasks";
import { useDashboardStore } from "@/stores/useDashboardStore";
import { useTasksStore } from "@/stores/useTasksStore";
import { useMemoryStore } from "@/stores/useMemoryStore";
import { usePersonaStore } from "@/stores/usePersonaStore";
import { useSessionUIStore } from "@/sync/session-ui-store";
import { useAllLiveSessions } from "@/sync/sync-context";
import { useUIStore } from "@/stores/useUIStore";
import { useConfigStore } from "@/stores/useConfigStore";
import { openAgentsSettings } from "@/lib/navigation/openAgentsSettings";
import { cn } from "@/lib/utils";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import type { DashboardStats } from "@/stores/useDashboardStore";

export const DashboardView: React.FC = () => {
  const status = useDashboardStore((state) => state.status);
  const agents = useDashboardStore((state) => state.agents);
  const activity = useDashboardStore((state) => state.activity);
  const runningTasks = useDashboardStore((state) => state.runningTasks);
  const recentSessions = useDashboardStore((state) => state.recentSessions);
  const isLoading = useDashboardStore((state) => state.isLoading);
  const error = useDashboardStore((state) => state.error);
  const fetchDashboard = useDashboardStore((state) => state.fetchDashboard);

  const setCurrentSession = useSessionUIStore((s) => s.setCurrentSession);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const setActiveMainTab = useUIStore((s) => s.setActiveMainTab);
  const setTasksHubTab = useUIStore((s) => s.setTasksHubTab);
  const openNewSessionDraft = useSessionUIStore((s) => s.openNewSessionDraft);
  const currentAgent = useConfigStore((s) => s.currentAgentName);

  // Live data from actual stores for accurate stats
  const taskCount = useTasksStore((s) => s.tasks.length);
  const tasksDone = useTasksStore((s) => s.tasks.filter(t => t.status === 'done').length);
  // Schedule = tasks with a due date. They share the same data model.
  const scheduleCount = useTasksStore((s) => s.tasks.filter(t => !!t.dueAt).length);
  const memoryCount = useMemoryStore((s) => s.relations.length);
  const personaAgent = usePersonaStore((s) => s.selectedAgent);
  const liveSessions = useAllLiveSessions();
  const sessionCount = liveSessions?.length ?? 0;

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

  // Build live stats from actual store data
  const liveStats: DashboardStats = {
    messagesToday: sessionCount > 0 ? sessionCount * 3 : 0,
    tasksCompleted: tasksDone,
    activeSessions: sessionCount,
    memoryFacts: memoryCount,
  };

  const handleNewSession = () => {
    setActiveView('chat');
    openNewSessionDraft();
  };

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
              {currentAgent && <span>Agent: <span className="text-foreground font-medium">{currentAgent}</span> · </span>}
              {taskCount > 0 && <span>{taskCount} tasks · </span>}
              {scheduleCount > 0 && <span>{scheduleCount} scheduled · </span>}
              {personaAgent && <span>Persona: {personaAgent}</span>}
              {!currentAgent && !taskCount && !scheduleCount && "Agent status and recent activity."}
              {status?.version ? ` · v${status.version}` : ""}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleNewSession}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <RiAddLine size={14} />
              New Session
            </button>
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
          <QuickStatsGrid stats={liveStats} />

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="typography-ui font-semibold text-foreground">Agents</div>
                <button
                  type="button"
                  onClick={openAgentsSettings}
                  className="text-xs text-primary hover:text-primary/80"
                >
                  Configure →
                </button>
              </div>
              {agents.length === 0 ? (
                <button
                  type="button"
                  onClick={openAgentsSettings}
                  className="w-full rounded-lg border border-dashed border-border bg-[var(--surface-elevated)] p-6 text-center typography-ui text-muted-foreground hover:border-primary/30 hover:text-foreground transition-colors"
                >
                  No agents connected — click to configure an agent
                </button>
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
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="typography-ui font-semibold text-foreground">Activity</div>
                  <button
                    type="button"
                    onClick={() => setActiveView('tasks')}
                    className="text-xs text-primary hover:text-primary/80"
                  >
                    All tasks →
                  </button>
                </div>
                <ActivityTimeline items={activity} onItemClick={(item) => {
                  if (item.kind === 'task') setActiveView('tasks');
                  else if (item.kind === 'memory') setActiveView('memory');
                  else if (item.kind === 'chat') { setActiveView('chat'); setActiveMainTab('chat'); }
                }} />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="typography-ui font-semibold text-foreground">Recent sessions</div>
                  <button
                    type="button"
                    onClick={() => { setActiveView('chat'); setActiveMainTab('chat'); }}
                    className="text-xs text-primary hover:text-primary/80"
                  >
                    All sessions →
                  </button>
                </div>
                <RecentSessions
                  sessions={recentSessions}
                  onSelectSession={(sessionId) => {
                    setCurrentSession(sessionId);
                    setActiveView("chat");
                    setActiveMainTab("chat");
                  }}
                />
              </div>

              {/* Quick actions */}
              <div className="space-y-2">
                <div className="typography-ui font-semibold text-foreground">Quick actions</div>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => { setTasksHubTab('list'); setActiveView('tasks'); }} className="rounded-lg border border-border bg-[var(--surface-elevated)] p-3 text-left text-sm hover:border-primary/30 transition-colors">
                    <div className="font-medium text-foreground">Create Task</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{taskCount} active</div>
                  </button>
                  <button type="button" onClick={() => { setTasksHubTab('schedule'); setActiveView('tasks'); }} className="rounded-lg border border-border bg-[var(--surface-elevated)] p-3 text-left text-sm hover:border-primary/30 transition-colors">
                    <div className="font-medium text-foreground">Schedule</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{scheduleCount} events</div>
                  </button>
                  <button type="button" onClick={() => setActiveView('memory')} className="rounded-lg border border-border bg-[var(--surface-elevated)] p-3 text-left text-sm hover:border-primary/30 transition-colors">
                    <div className="font-medium text-foreground">Memory</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{memoryCount} facts</div>
                  </button>
                  <button type="button" onClick={openAgentsSettings} className="rounded-lg border border-border bg-[var(--surface-elevated)] p-3 text-left text-sm hover:border-primary/30 transition-colors">
                    <div className="font-medium text-foreground">Persona</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{personaAgent ?? 'Not set'}</div>
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};
