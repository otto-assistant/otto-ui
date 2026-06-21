# Scheduled Tasks module

Server-owned scheduled task runtime and routes for OpenChamber-only automation.

## Scope

- Per-project scheduled task persistence is owned by `packages/web/server/lib/projects/project-config.js`.
- Runtime orchestration and execution is owned by this module.
- This module is OpenChamber feature logic; it is intentionally separate from OpenCode proxy/runtime internals.

## Files

- `packages/web/server/lib/scheduled-tasks/runtime.js`
  - Next-run computation (daily/weekly/cron compatibility)
  - Timer scheduling and queueing
  - Concurrency controls
  - Session create + prompt_async execution
  - Emits OpenChamber task-run events

- `packages/web/server/lib/scheduled-tasks/routes.js`
  - Scheduled task CRUD endpoints
  - Manual run endpoint
  - OpenChamber events SSE stream endpoint

## Public exports (runtime.js)

- `createScheduledTasksRuntime(dependencies)`
- Returned API:
  - `start()`
  - `stop()`
  - `syncAllProjects()`
  - `syncProject(projectId)`
  - `runNow(projectId, taskId)`

## Public exports (routes.js)

- `registerScheduledTaskRoutes(app, dependencies)`
- Registers:
  - `GET /api/projects/:projectId/scheduled-tasks`
  - `PUT /api/projects/:projectId/scheduled-tasks`
  - `DELETE /api/projects/:projectId/scheduled-tasks/:taskId`
  - `POST /api/projects/:projectId/scheduled-tasks/:taskId/run`
  - `GET /api/openchamber/scheduled-tasks/status`
  - `GET /api/openchamber/events`

## CLI surface

The `openchamber tasks` command is a first-class CLI over these routes for
managing scheduled tasks without crafting raw API calls. It talks to a running
local instance (discovered via the CLI instance registry, or `--port`).

- Command implementation: `packages/web/bin/cli-tasks.js`
  - Pure, unit-tested helpers: schedule/execution/task builders, project/task
    reference resolvers, and output formatters.
  - `createTasksCommand(deps)` wires those helpers to injected CLI transport
    (`requestJson`), instance resolution, and the `cli-output.js` adapter.
- Wiring (flags, dispatch, help): `packages/web/bin/cli.js`
- Tests: `packages/web/bin/cli-tasks.test.js`

Subcommands: `list`, `show`, `status`, `run`, `enable`, `disable`, `create`,
`delete`. All subcommands honor the CLI parity contract (human / `--json` /
`--quiet`), validate inputs in every mode, and only prompt (delete
confirmation) when interactive. See `openchamber tasks --help` for full usage.

- `create` maps flags to the task contract: `--name`, `--prompt`,
  `--provider`, `--model`, optional `--agent`/`--variant`, and a schedule via
  `--schedule daily|weekly|once|cron` plus `--at`, `--weekdays`, `--date`,
  `--cron`, and `--tz`/`--timezone`.
- `enable`/`disable` re-send the full existing task with the flipped `enabled`
  flag because `PUT` upserts validate the whole task payload.
