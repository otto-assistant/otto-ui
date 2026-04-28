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
