# Otto UI — Agent Reference

## What this is

**Otto UI** is a permanent fork of [OpenChamber](https://github.com/openchamber/openchamber), reorganized as an **agent-centric web interface** for the Otto AI assistant ecosystem.

- **Original:** OpenChamber = chat-centric UI for coding with OpenCode
- **Fork:** Otto UI = agent-centric control center for managing your AI assistant

See the original [AGENTS.openchamber.md](./AGENTS.openchamber.md) for OpenChamber-specific development rules.

## Otto-specific architecture

```
Otto UI (this repo)
    │
    ├── Navigation: agent-centric sidebar
    │   Dashboard, Projects, Persona, Memory, Tasks, Schedule, Chat+Code, Settings
    │
    ├── Otto API connection (replaces direct opencode connection)
    │   REST: /api/agents, /api/tasks, /api/memory, /api/schedule
    │   WebSocket: /ws/events (real-time sync)
    │
    └── Multi-space sync
        Discord ↔ Web UI ↔ Telegram (future)
```

## Design documents

- Design: [otto repo docs/plans/2026-04-28-otto-ui-design.md](https://github.com/otto-assistant/otto/blob/master/docs/plans/2026-04-28-otto-ui-design.md)
- Implementation plan: [otto repo docs/plans/2026-04-28-otto-ui-implementation-plan.md](https://github.com/otto-assistant/otto/blob/master/docs/plans/2026-04-28-otto-ui-implementation-plan.md)

## Upstream relationship

- **Upstream:** `https://github.com/openchamber/openchamber` (remote: `upstream`)
- **Strategy:** Permanent fork. Track upstream for infrastructure fixes only.
- **Divergence expected:** Navigation, layout, and Otto-specific views are incompatible with upstream.

## Key differences from OpenChamber

| Aspect | OpenChamber | Otto UI |
|--------|-------------|---------|
| Navigation center | Chat sessions | Agent context |
| Main view | Chat | Dashboard |
| Connection | Direct to opencode | Otto Backend API |
| Features | Coding-focused | Agent lifecycle (persona, memory, tasks, schedule, coding) |
| Sync | Single frontend | Multi-space (Discord, Web, Telegram) |

## Development setup

```bash
bun install
bun run dev          # web + ui dev servers
bun run build        # build all
bun run type-check   # TypeScript validation
bun run lint         # ESLint
```

## Repository

- **Org:** `otto-assistant`
- **Repo:** `otto-ui`
- **License:** MIT (inherited from OpenChamber)
- **Attribution:** Based on [OpenChamber](https://github.com/openchamber/openchamber) by Bohdan Triapitsyn

## Cursor Cloud specific instructions

### Runtime

- **Bun** is the package manager and runtime (`bun@1.3.5`). The update script installs it if missing.
- Node.js >= 20 is also available via nvm (`lts`).

### Running the dev servers

The main dev command is `bun run dev:web:hmr`, which starts:
- **Vite HMR dev server** on port `5173` (browse this for frontend development)
- **Express API server** on port `3001` (proxied from the Vite dev server at `/api`)

Since there is no OpenCode backend in the Cloud Agent environment, start the server with:
```bash
OPENCODE_SKIP_START=true OPENCODE_PORT=4096 bun run dev:web:hmr
```
This puts the server in "skip-start mode" — the UI loads fully, but AI/chat features that depend on a live OpenCode backend will show connection errors. This is expected.

### Validation commands

See `AGENTS.openchamber.md` and root `package.json` for the full list. Key commands:
- `bun run type-check` — TypeScript validation across all packages
- `bun run lint` — ESLint across all packages
- `bun run build` — production build of all packages

### Gotchas

- The `bun run dev` script (as opposed to `bun run dev:web:hmr`) also starts the UI type-check watcher via `concurrently`. Both work, but `dev:web:hmr` is sufficient for most development.
- Port `5173` is the Vite HMR port; port `3001` is the API port. Browse `http://localhost:5173` for HMR — not `http://localhost:3001`.
- If ports are occupied from a previous run, find and kill the processes before restarting (`lsof -ti:5173 -ti:3001 | xargs kill -9`).

### Module docs (upstream references)

- **quota**: `packages/web/server/lib/quota/DOCUMENTATION.md`
- **git**: `packages/web/server/lib/git/DOCUMENTATION.md`
- **github**: `packages/web/server/lib/github/DOCUMENTATION.md`
- **opencode**: `packages/web/server/lib/opencode/DOCUMENTATION.md`
- **notifications**: `packages/web/server/lib/notifications/DOCUMENTATION.md`
- **scheduled-tasks**: `packages/web/server/lib/scheduled-tasks/DOCUMENTATION.md`
- **text**: `packages/web/server/lib/text/DOCUMENTATION.md`
- **terminal**: `packages/web/server/lib/terminal/DOCUMENTATION.md`
- **tts**: `packages/web/server/lib/tts/DOCUMENTATION.md`
- **tunnels**: `packages/web/server/lib/tunnels/DOCUMENTATION.md`
- **ui-auth**: `packages/web/server/lib/ui-auth/DOCUMENTATION.md`
- **skills-catalog**: `packages/web/server/lib/skills-catalog/DOCUMENTATION.md`
- **sync**: `packages/ui/src/sync/DOCUMENTATION.md`
- **stores**: `packages/ui/src/stores/DOCUMENTATION.md`
- **session sidebar**: `packages/ui/src/components/session/sidebar/DOCUMENTATION.md`
- **message parts**: `packages/ui/src/components/chat/message/parts/DOCUMENTATION.md`
