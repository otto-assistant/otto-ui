# Wave 1 Agent 1: Navigation Restructure

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform sidebar from session-centric to agent-centric navigation.

**Files to study:**
- `packages/ui/src/components/layout/Sidebar.tsx`
- `packages/ui/src/components/layout/MainLayout.tsx`
- `packages/ui/src/stores/useUIStore.ts`

**Build:**

1. New nav items in sidebar: Dashboard (ri-dashboard-line), Projects (ri-folder-line), Persona (ri-user-settings-line), Memory (ri-brain-line), Tasks (ri-task-line), Schedule (ri-calendar-line), Chat+Code (ri-chat-3-line), Settings (ri-settings-3-line)

2. Create placeholder views:
   - `packages/ui/src/components/views/DashboardView.tsx`
   - `packages/ui/src/components/views/ProjectsView.tsx`
   - `packages/ui/src/components/views/PersonaView.tsx`
   - `packages/ui/src/components/views/MemoryView.tsx`
   - `packages/ui/src/components/views/TasksView.tsx`
   - `packages/ui/src/components/views/ScheduleView.tsx`

3. Add `activeView` to UI store. Dashboard = default. Persist in localStorage. Clicking nav item switches view.

4. Use theme tokens, Remixicon icons. Keep sidebar collapsible/resizable. Do NOT break Chat or Settings.

Run `bun run type-check` before committing.
