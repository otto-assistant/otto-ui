# Wave 1 Agent 2: Otto REST API

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create Otto API routes in `packages/web/server/lib/otto-api/`.

**Study:** `packages/web/server/lib/scheduled-tasks/routes.js` for pattern.

**Endpoints (Express router mounted at /api/otto):**
- GET /status → { version, uptime, health }
- GET /agents → list from opencode config
- GET /agents/:name → single agent
- PUT /agents/:name → update config
- GET /tasks → list tasks
- POST /tasks → create task
- PUT /tasks/:id → update
- DELETE /tasks/:id → delete
- GET /schedule → list scheduled
- POST /schedule → create
- DELETE /schedule/:id → remove
- GET /memory/search?q= → search
- GET /memory/graph → entities+relations
- GET /memory/diary → entries
- POST /memory/facts → add fact

**Data:** Try `otto` CLI --json, fallback to config files, last resort mock data.

**Wire:** Import in `packages/web/server/index.js`, mount router.

**Constraints:** Follow existing patterns. child_process only for otto CLI. All JSON. Run `bun run type-check`. Commit when done.
