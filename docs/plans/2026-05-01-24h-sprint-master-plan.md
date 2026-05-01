# Otto UI — 24-Hour Sprint Master Plan

**Date:** 2026-05-01
**Goal:** Fully functional hybrid openchamber/otto platform with ALL features from design doc.
**Strategy:** 5 waves of parallel agents, each wave ~4-6 hours.

---

## Status Check

### Already Done (Phase 1 partial):
- ✅ Fork OpenChamber → otto-assistant/otto-ui
- ✅ Initial rebrand (commit `244e62be`)
- ✅ Repo structure with packages/web, packages/ui, packages/desktop

### Wave 0 (In Progress — Subagents 1-4):
- 🟡 Security hardening (IPC auth, path traversal)
- 🟡 Desktop autostart (tauri-plugin-autostart)
- ✅ Discord relay package (committed)
- 🟡 Streaming hooks (SSE → Discord)

---

## Wave 1: Navigation & API Foundation (Hours 0-5)

> **Parallel capacity:** 4 agents in worktrees

### Agent 1.1: Navigation Restructure
**Worktree:** `wave1-navigation`
**Scope:** Transform sidebar from session-centric to agent-centric

**Tasks:**
1. Modify `packages/ui/src/components/layout/Sidebar.tsx` → agent-centric nav
2. Create navigation items:
   - Dashboard (default landing, icon: activity)
   - Projects (icon: folder)
   - Persona (icon: user-circle)
   - Memory (icon: brain)
   - Tasks (icon: check-square)
   - Schedule (icon: calendar)
   - Chat + Code (existing chat, icon: message-square)
   - Settings (existing, icon: settings)
3. Create route definitions in `packages/ui/src/App.tsx` or router config
4. Create placeholder view components for each nav item
5. Make Dashboard the default landing page (not Chat)
6. Persist active nav item in localStorage
7. Update `packages/ui/src/components/layout/MainLayout.tsx` to render based on active nav

**Key files:**
- `packages/ui/src/components/layout/Sidebar.tsx`
- `packages/ui/src/components/layout/MainLayout.tsx`
- `packages/ui/src/stores/useUIStore.ts`
- Create: `packages/ui/src/components/views/DashboardView.tsx`
- Create: `packages/ui/src/components/views/PersonaView.tsx`
- Create: `packages/ui/src/components/views/MemoryView.tsx`
- Create: `packages/ui/src/components/views/TasksView.tsx`
- Create: `packages/ui/src/components/views/ScheduleView.tsx`
- Create: `packages/ui/src/components/views/ProjectsView.tsx`

**Acceptance:** Navigation renders, clicking items switches views, Chat+Code still works, type-check passes.

---

### Agent 1.2: Otto REST API Skeleton
**Worktree:** `wave1-api`
**Scope:** Create Otto API routes in packages/web/server

**Tasks:**
1. Create `packages/web/server/lib/otto-api/index.js` — router
2. Create `packages/web/server/lib/otto-api/routes/` directory
3. Implement endpoints (can return mock data initially):
   ```
   GET  /api/otto/status        → { version, packages, health }
   GET  /api/otto/agents        → [{ name, status, lastActive }]
   GET  /api/otto/agents/:name  → { name, systemPrompt, skills, behavior }
   PUT  /api/otto/agents/:name  → update agent config
   GET  /api/otto/tasks         → [{ id, title, owner, status, priority }]
   POST /api/otto/tasks         → create task
   PUT  /api/otto/tasks/:id     → update task
   DELETE /api/otto/tasks/:id   → delete task
   GET  /api/otto/schedule      → [{ id, prompt, sendAt, recurring }]
   POST /api/otto/schedule      → create scheduled item
   DELETE /api/otto/schedule/:id → delete
   GET  /api/otto/memory/search → semantic search
   GET  /api/otto/memory/graph  → { entities, relations }
   GET  /api/otto/memory/diary  → [{ entry, timestamp, topic }]
   POST /api/otto/memory/facts  → add fact
   ```
4. Wire router into `packages/web/server/index.js`
5. Each endpoint calls otto CLI or reads otto config files to get real data where possible

**Key integration points:**
- `otto task list --json` → Tasks endpoint
- `otto session list --json` → Agents/sessions
- `~/.config/opencode/config.json` → Agent configs
- `~/.otto/` directory → Otto state

**Acceptance:** All endpoints respond (200 with data or placeholder), type-check passes, existing routes not broken.

---

### Agent 1.3: WebSocket Event Hub
**Worktree:** `wave1-websocket`
**Scope:** Real-time WebSocket server for UI sync

**Tasks:**
1. Create `packages/web/server/lib/otto-api/websocket.js`
2. Implement WebSocket server on path `/ws/otto/events`
3. Event types:
   ```
   agent.activity    — agent started/stopped/error
   task.create       — new task
   task.update       — task status change
   message.new       — new message in any session
   memory.change     — fact added/removed
   persona.update    — agent config changed
   schedule.trigger  — scheduled task fired
   ```
4. Client subscription protocol:
   ```json
   { "type": "subscribe", "events": ["*"] }
   { "type": "subscribe", "events": ["task.*", "agent.activity"] }
   ```
5. Broadcast mechanism (server-side publish to all connected clients)
6. Reconnection support (client sends `lastEventId`, server replays missed)
7. Heartbeat/ping every 30s

**Key files:**
- Create: `packages/web/server/lib/otto-api/websocket.js`
- Modify: `packages/web/server/index.js` (attach WS to HTTP server)
- Create: `packages/ui/src/hooks/useOttoEvents.ts` (client-side hook)

**Acceptance:** WebSocket connects, subscribes, receives test events, auto-reconnects.

---

### Agent 1.4: Dashboard View
**Worktree:** `wave1-dashboard`
**Scope:** Real-time agent activity dashboard

**Tasks:**
1. Create `packages/ui/src/components/views/dashboard/DashboardView.tsx`
2. Components:
   - **AgentStatusCard** — running/idle/error indicator, current model, uptime
   - **ActivityTimeline** — last 10 actions (messages, tool calls, tasks completed)
   - **QuickStats** — cards: tasks today, messages today, memory size, active sessions
   - **RunningTasks** — list of currently executing tasks with progress
   - **RecentSessions** — last 5 sessions with links to Chat+Code
3. Create Zustand store: `packages/ui/src/stores/useDashboardStore.ts`
4. Connect to WebSocket for real-time updates
5. Fetch initial data from `/api/otto/status` and `/api/otto/agents`
6. Auto-refresh every 30s as fallback

**Styling:**
- Use existing theme tokens (load theme-system skill)
- Grid layout: 2 columns on desktop, 1 on mobile
- Cards with subtle borders, icons from Remixicon

**Acceptance:** Dashboard renders with real or mock data, auto-refreshes, responsive layout, type-check passes.

---

## Wave 2: Core Features (Hours 5-11)

> After Wave 1 merges. 4 parallel agents.

### Agent 2.1: Persona Editor
**Worktree:** `wave2-persona`
**Scope:** Full agent persona management UI

**Tasks:**
1. Create `packages/ui/src/components/views/persona/` directory
2. **PersonaView.tsx** — main container with agent selector
3. **AgentSelector.tsx** — dropdown/tabs to switch between agents
4. **SystemPromptEditor.tsx** — CodeMirror or textarea with markdown preview
   - Split pane: editor left, rendered preview right
   - Syntax highlighting for markdown
   - Character count, token estimate
5. **SkillsToggles.tsx** — grid of skill cards with on/off switches
   - Reads available skills from `/api/otto/agents/:name`
   - Toggle saves immediately
6. **BehaviorSliders.tsx** — sliders for:
   - Proactivity (0-100)
   - Verbosity (0-100)
   - Tone (formal ↔ casual)
7. **LanguageSelector.tsx** — dropdown for agent language
8. **AgentTemplates.tsx** — preset templates (coding, research, creative)
9. Create store: `packages/ui/src/stores/usePersonaStore.ts`
10. API integration: GET/PUT `/api/otto/agents/:name`
11. Save → writes to opencode.json agents config

**Acceptance:** Can view/edit system prompt, toggle skills, adjust sliders, switch agents, save config.

---

### Agent 2.2: Memory Browser
**Worktree:** `wave2-memory`
**Scope:** Knowledge graph visualization, list view, diary, search

**Tasks:**
1. Create `packages/ui/src/components/views/memory/` directory
2. **MemoryView.tsx** — tabs: Graph | List | Diary | Search
3. **GraphView.tsx** — force-directed graph (use `react-force-graph-2d`)
   - Nodes = entities (colored by type: person=blue, project=green, concept=purple)
   - Edges = relations (labeled)
   - Click node → side panel with entity details
   - Zoom, pan, filter controls
4. **ListView.tsx** — table with columns:
   - Entity, Predicate, Object, Valid From, Valid To
   - Sort by any column
   - Filter row (text inputs per column)
   - Inline edit (double-click cell)
   - Add new fact row
   - Delete with confirmation
5. **DiaryView.tsx** — chronological entries
   - Date headers
   - AAAK decode to human-readable
   - Filter by topic, date range
6. **SearchView.tsx** — semantic search
   - Search input with debounce
   - Results list with relevance score
   - Click result → navigate to fact in list view
7. Create store: `packages/ui/src/stores/useMemoryStore.ts`
8. API: GET `/api/otto/memory/graph`, `/api/otto/memory/diary`, `/api/otto/memory/search`

**Dependencies:** Add `react-force-graph-2d` to packages/ui

**Acceptance:** Graph renders with sample data, list view with CRUD, diary displays entries, search returns results.

---

### Agent 2.3: Tasks View
**Worktree:** `wave2-tasks`
**Scope:** Unified task center with filtering, CRUD, bidirectional flow

**Tasks:**
1. Create `packages/ui/src/components/views/tasks/` directory
2. **TasksView.tsx** — main container with filter tabs
3. **TaskFilterTabs.tsx** — All | My Tasks | Agent Tasks | Scheduled | Done
4. **TaskList.tsx** — list of task cards
5. **TaskCard.tsx** — individual task:
   - Title, description preview
   - Owner badge (user=blue, agent=green, cron=orange)
   - Priority indicator (high=red, medium=yellow, low=blue circle)
   - Due date (relative: "in 2h", "tomorrow")
   - Status chip (pending, in_progress, done, cancelled)
6. **TaskCreateDialog.tsx** — modal form:
   - Title (required)
   - Description (textarea)
   - Priority selector
   - Due date picker
   - Assign to (user/agent dropdown)
7. **TaskDetailDrawer.tsx** — slide-out panel:
   - Full description
   - History timeline (created, started, completed)
   - Linked session/thread
   - Edit/delete buttons
8. Create store: `packages/ui/src/stores/useTasksStore.ts`
9. API: GET/POST/PUT/DELETE `/api/otto/tasks`
10. WebSocket: subscribe to `task.*` events for real-time updates

**Acceptance:** Tasks render with filtering, create/edit/delete works, real-time updates via WS.

---

### Agent 2.4: Schedule/Calendar View
**Worktree:** `wave2-schedule`
**Scope:** Calendar visualization of scheduled tasks, cron jobs, reminders

**Tasks:**
1. Create `packages/ui/src/components/views/schedule/` directory
2. **ScheduleView.tsx** — month/week toggle + create button
3. **CalendarMonth.tsx** — month grid:
   - Day cells with event dots
   - Click day → show day's events in sidebar
   - Highlight today
   - Navigate months (prev/next arrows)
4. **CalendarWeek.tsx** — 7-column layout:
   - Hour rows (7am-11pm)
   - Events as colored blocks
   - Drag to reschedule (stretch goal)
5. **ScheduleEventCard.tsx** — event display:
   - Title/prompt preview
   - Time
   - Type indicator (one-time=circle, recurring=repeat-icon)
   - Status (pending=grey, fired=green, failed=red)
6. **CreateScheduleDialog.tsx** — form:
   - Prompt/description
   - Type: one-time | recurring (cron)
   - Date/time picker (one-time)
   - Cron expression builder (recurring) with human-readable preview
   - Agent selector
7. Create store: `packages/ui/src/stores/useScheduleStore.ts`
8. API: GET/POST/DELETE `/api/otto/schedule`
9. Parse cron expressions for display (use `cronstrue` for human-readable)

**Dependencies:** Add `cronstrue` to packages/ui

**Acceptance:** Calendar renders, events display on correct dates, create/delete works, cron shows human-readable schedule.

---

## Wave 3: Sync & Integration (Hours 11-17)

> After Wave 2 merges. 4 parallel agents.

### Agent 3.1: WebSocket Sync Layer (Full Implementation)
**Worktree:** `wave3-sync`
**Scope:** Production WebSocket with event replay, optimistic updates, conflict resolution

**Tasks:**
1. Enhance WebSocket server from Wave 1 with:
   - Event persistence (last N events in memory ring buffer)
   - Replay from `lastEventId` on reconnect
   - Client authentication (IPC token in WS upgrade)
2. Create `packages/ui/src/lib/otto-sync.ts` — sync client:
   - Auto-connect on app mount
   - Exponential backoff reconnection
   - Event dispatcher to relevant stores
   - Optimistic update support (apply immediately, rollback on server rejection)
3. Hook integration:
   - `useDashboardStore` subscribes to `agent.*`
   - `useTasksStore` subscribes to `task.*`
   - `useMemoryStore` subscribes to `memory.*`
   - `usePersonaStore` subscribes to `persona.*`
4. Conflict resolution:
   - Config changes: last-write-wins with version counter
   - Messages: append-only (no conflicts)
   - Tasks: merge (concurrent edits to different fields merge, same field = last-write)

**Acceptance:** WebSocket auto-connects, stores update in real-time, reconnection replays missed events, optimistic updates work.

---

### Agent 3.2: Discord ↔ Web UI Message Sync
**Worktree:** `wave3-discord-sync`
**Scope:** Messages from Discord appear in Web UI and vice versa

**Tasks:**
1. Map Discord threads → Otto UI sessions:
   - Each Discord thread has a `sessionId`
   - Otto API stores mapping: `{ threadId, sessionId, channelId }`
2. Create API endpoints:
   ```
   GET  /api/otto/threads          → list thread mappings
   GET  /api/otto/threads/:id/messages → messages for thread
   POST /api/otto/threads/:id/send → send message from Web UI to Discord thread
   ```
3. Modify discord-relay to publish events when messages arrive:
   - Emit `message.new` event via internal channel
   - Include: text, author, timestamp, threadId, attachments
4. Web UI Chat+Code view:
   - Show Discord messages alongside regular session messages
   - "Sent from Discord" badge on messages
   - Type in Web UI → sends to Discord thread via API
5. File attachments:
   - Discord images/files → download URL accessible from Web UI
   - Web UI file uploads → send to Discord as attachments

**Acceptance:** Messages from Discord appear in Web UI chat, sending from Web UI appears in Discord, attachments sync.

---

### Agent 3.3: Cross-Space Task Sync
**Worktree:** `wave3-task-sync`
**Scope:** Tasks created anywhere are visible everywhere

**Tasks:**
1. Unified task storage:
   - Create `packages/web/server/lib/otto-api/task-store.js`
   - SQLite-backed (use existing OpenCode internal SQLite pattern)
   - Schema: `id, title, description, owner, priority, status, created_at, due_at, source`
2. Task sources:
   - Web UI (POST /api/otto/tasks)
   - Discord (parse "task:" prefix or slash command)
   - Otto CLI (otto task create)
   - Cron/scheduled (auto-created)
3. Sync events:
   - Create → broadcast `task.create` via WebSocket + post to Discord channel
   - Update → broadcast `task.update`
   - Complete → broadcast `task.complete` + notify in Discord
4. Bidirectional flow:
   - User creates task in Web UI → agent sees it in context
   - Agent creates task → appears in Web UI with "agent" badge
   - Task completed → notification in both Web UI and Discord

**Acceptance:** Create task in Web UI → appears in Discord (or vice versa), status updates sync, completion notifications work.

---

### Agent 3.4: Settings View Enhancement
**Worktree:** `wave3-settings`
**Scope:** Otto-specific settings: status, upgrade, connections, theme

**Tasks:**
1. Extend existing `packages/ui/src/components/views/SettingsView.tsx`
2. Add sections:
   - **Otto Status** — package versions, health indicators, uptime
   - **Connections** — Discord (connected/disconnected), future: Telegram
   - **Agent Management** — list agents, create/delete
   - **Upgrade** — current version, check for updates, upgrade button
   - **Tunnel** — Cloudflare tunnel status, URL, QR code
   - **Security** — IPC token info, allowed Discord users
3. API integration:
   - GET `/api/otto/status` for version/health
   - POST `/api/otto/upgrade` triggers otto upgrade
   - GET `/api/otto/connections` for Discord/Telegram status
4. Keep existing OpenChamber settings (themes, shortcuts, etc.)

**Acceptance:** Settings page shows Otto status, connections section shows Discord link status, upgrade button works.

---

## Wave 4: Polish & Production (Hours 17-24)

> After Wave 3 merges. 4 parallel agents.

### Agent 4.1: Responsive & Mobile
**Worktree:** `wave4-responsive`
**Scope:** All views work on mobile (≤768px)

**Tasks:**
1. Sidebar: collapsible on mobile, hamburger menu
2. Dashboard: single column on mobile, cards stack
3. Persona: tabs instead of split pane, editor full-width
4. Memory: graph defaults to list on mobile (graph too complex for touch)
5. Tasks: cards full-width, create dialog as full-screen sheet
6. Schedule: only list view on mobile (no calendar grid)
7. Chat: already responsive (inherited from OpenChamber)
8. Settings: already responsive

Test at 375px, 768px, 1024px, 1440px breakpoints.

**Acceptance:** All views usable on mobile, no horizontal scroll, touch-friendly tap targets.

---

### Agent 4.2: Error States & UX Polish
**Worktree:** `wave4-ux`
**Scope:** Loading, error, empty states for all views

**Tasks:**
1. Create shared components:
   - `LoadingSpinner.tsx` — consistent loading indicator
   - `EmptyState.tsx` — illustration + message + action button
   - `ErrorState.tsx` — error message + retry button
2. Apply to all views:
   - Dashboard: skeleton loading, "No activity yet" empty state
   - Persona: loading agent config, "No agents configured" empty
   - Memory: loading graph, "No memories yet" empty, search "No results"
   - Tasks: loading list, "No tasks" empty, filtered "No matching tasks"
   - Schedule: loading events, "Nothing scheduled" empty
3. Toast notifications for:
   - Task created/completed
   - Persona saved
   - Memory fact added/removed
   - Connection lost/restored
4. Keyboard shortcuts:
   - `Ctrl+1-7` switch views
   - `Ctrl+N` new task
   - `Ctrl+F` search (context-dependent)
   - `Escape` close dialogs/drawers

**Acceptance:** All views handle loading/error/empty gracefully, toasts work, keyboard shortcuts functional.

---

### Agent 4.3: Otto API Integration (Real Data)
**Worktree:** `wave4-api-real`
**Scope:** Connect API endpoints to real Otto/OpenCode data instead of mocks

**Tasks:**
1. Agents endpoint → read from `~/.config/opencode/config.json` agents section
2. Tasks endpoint → call `otto task list --json` and parse
3. Schedule endpoint → call `otto task list --json` (scheduled tasks)
4. Memory endpoints → call MemPalace MCP tools (search, graph, diary)
5. Status endpoint → call `otto status --json`, check process health
6. Persona PUT → write to opencode.json, trigger agent hot-reload
7. Error handling:
   - Otto CLI not installed → graceful error with install instructions
   - MemPalace not connected → "Memory unavailable" state
   - OpenCode not running → health check failure notification
8. Caching:
   - Agent list: cache 30s
   - Tasks: cache 5s (real-time via WS updates)
   - Memory graph: cache 60s
   - Status: cache 10s

**Acceptance:** All endpoints return real data from Otto ecosystem, graceful fallbacks when components unavailable.

---

### Agent 4.4: Integration Testing & Final Build
**Worktree:** `wave4-testing`
**Scope:** E2E flow validation, build verification, documentation

**Tasks:**
1. Verify full build: `bun run type-check && bun run lint && bun run build`
2. Manual E2E test flows:
   - Launch app → Dashboard renders with status
   - Navigate to Persona → Edit system prompt → Save
   - Navigate to Memory → Search → View graph
   - Navigate to Tasks → Create task → See in list
   - Navigate to Schedule → Create scheduled item
   - Open Chat+Code → Send message → Response streams
   - Discord relay: send message → appears in UI
3. Fix any type errors from merged branches
4. Performance check: bundle size, initial load time
5. Create `CHANGELOG.md` entry for v2.0.0 (Otto UI initial release)
6. Update `README.md` with Otto UI description, screenshots placeholder

**Acceptance:** Full build passes, all views render without errors, no console errors, <5s initial load.

---

## Merge Strategy

Each wave merges sequentially:
```
Wave 0 (current) → merge all 4 branches → tag: v1.9.0-infra
Wave 1 → merge all 4 branches → tag: v1.9.0-foundation
Wave 2 → merge all 4 branches → tag: v1.9.0-features
Wave 3 → merge all 4 branches → tag: v1.9.0-sync
Wave 4 → merge all 4 branches → tag: v2.0.0-otto
```

Between waves:
1. `bun run type-check && bun run lint && bun run build` must pass
2. Resolve any merge conflicts
3. Verify no regressions (existing Chat+Code still works)

---

## Timeline

| Wave | Hours | Parallel Agents | Key Deliverable |
|------|-------|-----------------|-----------------|
| 0 | 0-2 | 4 | Security, Autostart, Relay, Streaming |
| 1 | 2-6 | 4 | Navigation, API, WebSocket, Dashboard |
| 2 | 6-12 | 4 | Persona, Memory, Tasks, Schedule |
| 3 | 12-18 | 4 | Sync, Discord↔UI, Task sync, Settings |
| 4 | 18-24 | 4 | Responsive, UX, Real data, Testing |

**Total: 20 agents across 5 waves = full platform in 24 hours.**

---

## Dependencies Between Waves

```
Wave 0 ─┐
         ├── Wave 1 ─┐
Wave 0 ─┘            ├── Wave 2 ─┐
                     │            ├── Wave 3 ─── Wave 4
                     └────────────┘
```

- Wave 1 needs Wave 0's security middleware (for API auth)
- Wave 2 needs Wave 1's API endpoints + navigation
- Wave 3 needs Wave 2's stores + views
- Wave 4 needs Wave 3's sync layer

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Agent takes too long | Set 2-hour timeout, if not done → manual intervention |
| Merge conflicts between parallel agents | Each agent touches different directories/files |
| API not ready for UI | UI uses mock data initially, swaps to real API in Wave 4 |
| react-force-graph too heavy | Fall back to simple list/tree view if bundle too large |
| Otto CLI not available in dev | Mock CLI responses, test with real CLI in Wave 4 |
