# Wave 1 Agent 3: WebSocket Event Hub

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Real-time WebSocket for UI updates on `/ws/otto/events`.

**Study:** `packages/web/server/lib/event-stream/` and `packages/ui/src/hooks/useEventStream.ts`

**Server (`packages/web/server/lib/otto-api/websocket.js`):**
- WebSocket on `/ws/otto/events` path (upgrade handler)
- Protocol: subscribe, ping/pong, event broadcast
- Events: agent.activity, task.create, task.update, message.new, memory.change, persona.update, schedule.trigger
- Heartbeat 30s, ring buffer last 100 events, replay from lastEventId
- Export `broadcast(eventType, data)` for other modules

**Client (`packages/ui/src/hooks/useOttoWebSocket.ts`):**
- Auto-connect, reconnect with backoff (1s→30s max)
- Subscribe to event patterns
- Track connection status
- Replay missed events

**Store (`packages/ui/src/stores/useOttoEventsStore.ts`):**
- Connection status, last N events, subscribe mechanism

**Wire:** Attach WS to HTTP server in index.js. No new deps (use existing `ws`). Run `bun run type-check`. Commit.
