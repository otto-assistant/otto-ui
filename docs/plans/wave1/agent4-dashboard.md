# Wave 1 Agent 4: Dashboard View

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build Dashboard — the default landing page showing agent status and activity.

**Study:** `packages/ui/src/components/views/SettingsView.tsx` for patterns, `packages/ui/src/lib/theme/` for tokens.

**Create in `packages/ui/src/components/views/dashboard/`:**

1. **DashboardView.tsx** — 2-col grid desktop, 1-col mobile. Fetch from /api/otto/status + /api/otto/agents.

2. **AgentStatusCard.tsx** — name, status badge (Running=green/Idle=blue/Error=red), model, uptime.

3. **ActivityTimeline.tsx** — last 10 actions, icon+description+relative timestamp. Empty: "No recent activity"

4. **QuickStatsGrid.tsx** — 4 cards: Messages today, Tasks completed, Active sessions, Memory facts. Icon+number+label.

5. **RunningTasks.tsx** — active tasks with progress. Empty: "No running tasks"

6. **RecentSessions.tsx** — last 5 sessions, title+timestamp+click.

**Store:** `packages/ui/src/stores/useDashboardStore.ts` with status, agents, activity, stats, fetchDashboard(), isLoading.

**Rules:** ALL colors via theme tokens. Remixicon icons. Mock data OK if API unavailable. Export from views/index.ts. Run `bun run type-check`. Commit.
