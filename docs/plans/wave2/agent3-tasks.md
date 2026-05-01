# Wave 2 Agent 3: Tasks View

**Goal:** Unified task center at `packages/ui/src/components/views/tasks/`

**Study:** `packages/ui/src/components/views/TasksView.tsx` (placeholder), existing stores pattern

**Build:**

1. **TasksView.tsx** — filter tabs (All|My Tasks|Agent|Scheduled|Done) + create button + task list
2. **TaskFilterTabs.tsx** — horizontal tab buttons with counts
3. **TaskList.tsx** — scrollable list of TaskCard components
4. **TaskCard.tsx** — title, owner badge (user=blue, agent=green, cron=orange), priority dot (high=red, medium=yellow, low=blue), due date relative, status chip
5. **TaskCreateDialog.tsx** — modal: title input, description textarea, priority select, due date input, assign-to dropdown. Save calls POST /api/otto/tasks
6. **TaskDetailDrawer.tsx** — slide-out panel: full description, history, edit/delete buttons
7. **TasksStore** — `packages/ui/src/stores/useTasksStore.ts`: tasks[], filter, createTask(), updateTask(), deleteTask(), fetchTasks()

**API:** GET/POST/PUT/DELETE `/api/otto/tasks`

**Rules:** Theme tokens. Responsive. Toast on create/complete. Mock data if API unavailable. Commit.
