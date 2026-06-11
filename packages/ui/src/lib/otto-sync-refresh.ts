import type { MemoryTab } from '../stores/useMemoryStore';
import { useTasksStore } from '../stores/useTasksStore';
import { useDashboardStore } from '../stores/useDashboardStore';
import { useMemoryStore } from '../stores/useMemoryStore';
import { usePersonaStore } from '../stores/usePersonaStore';
import { useOttoEventsStore } from '../stores/useOttoEventsStore';

/** Normalized realtime event shape used by the domain refresh layer. */
export interface SyncEvent {
  id: string;
  type: string; // e.g. "task.create", "persona.update"
  payload: unknown;
  timestamp: number;
}

const PERSONA_HINT_KEYS = ['agent', 'agentId', 'agentName', 'name', 'id'] as const;

/** Matches an event type against a glob pattern (e.g. "task.*"). */
export function matchesEventPattern(pattern: string, eventType: string): boolean {
  if (pattern === '*' || pattern === eventType) return true;
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return prefix.length === 0 || eventType.startsWith(prefix);
  }
  return false;
}

/**
 * Best-effort extraction of which agent a persona-related WS event refers to.
 * Backends may use different payload shapes; we accept common aliases.
 */
export function extractPersonaAgentHint(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  for (const key of PERSONA_HINT_KEYS) {
    const value = record[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return null;
}

/**
 * After the agent list is refreshed from the server, choose which agent the UI should load.
 * Preference: explicit hint from the event → previous selection if still valid → first agent.
 */
export function pickPersonaTargetAgent(params: {
  agents: string[];
  previousSelection: string | null;
  hint: string | null;
}): string | null {
  const { agents, previousSelection, hint } = params;
  if (agents.length === 0) return null;
  if (hint && agents.includes(hint)) return hint;
  if (previousSelection && agents.includes(previousSelection)) return previousSelection;
  return agents[0] ?? null;
}

export type OttoSyncTaskGateway = {
  fetchTasks: () => Promise<void>;
};

export type OttoSyncDashboardGateway = {
  fetchDashboard: () => Promise<void>;
};

export type OttoSyncMemoryGateway = {
  getSnapshot: () => { activeTab: MemoryTab; searchQuery: string };
  fetchGraph: () => Promise<void>;
  fetchDiary: () => Promise<void>;
  searchMemory: (query: string) => Promise<void>;
};

export type OttoSyncPersonaGateway = {
  getAgents: () => string[];
  getSelectedAgent: () => string | null;
  fetchAgents: () => Promise<void>;
  selectAgent: (name: string) => Promise<void>;
};

export type OttoSyncScheduleGateway = {
  fetchSchedule: () => Promise<void>;
};

export type OttoSyncRefreshGateways = {
  tasks: OttoSyncTaskGateway;
  dashboard: OttoSyncDashboardGateway;
  memory: OttoSyncMemoryGateway;
  persona: OttoSyncPersonaGateway;
  schedule: OttoSyncScheduleGateway;
};

export async function refreshPersonaForRemoteEvent(
  event: SyncEvent,
  persona: OttoSyncPersonaGateway,
): Promise<void> {
  const hint = extractPersonaAgentHint(event.payload);
  const previousSelection = persona.getSelectedAgent();
  await persona.fetchAgents();
  const agents = persona.getAgents();
  const target = pickPersonaTargetAgent({ agents, previousSelection, hint });
  if (target) await persona.selectAgent(target);
}

/**
 * Memory graph is always refreshed. Diary and search views get a cheap follow-up when relevant
 * so open tabs do not show stale data after `memory.*` events.
 */
export async function refreshMemoryForRemoteEvent(memory: OttoSyncMemoryGateway): Promise<void> {
  const { activeTab, searchQuery } = memory.getSnapshot();
  await memory.fetchGraph();
  if (activeTab === 'diary') await memory.fetchDiary();
  const trimmed = searchQuery.trim();
  if (trimmed.length > 0) await memory.searchMemory(searchQuery);
}

function fireAndForget(promise: Promise<unknown>): void {
  void promise.catch(() => {
    // Realtime refresh must never surface as unhandled rejections in the UI shell.
    void 0;
  });
}

/**
 * Routes a realtime event to the matching domain refresh action.
 * Patterns mirror the event types broadcast by the server hub
 * (`task.*`, `agent.activity`, `memory.change`, `persona.update`, `schedule.trigger`).
 */
export function dispatchOttoSyncDomainRefresh(
  event: SyncEvent,
  gateways: OttoSyncRefreshGateways,
): void {
  if (matchesEventPattern('task.*', event.type)) {
    fireAndForget(gateways.tasks.fetchTasks());
  }

  if (matchesEventPattern('agent.*', event.type)) {
    fireAndForget(gateways.dashboard.fetchDashboard());
  }

  if (matchesEventPattern('memory.*', event.type)) {
    fireAndForget(refreshMemoryForRemoteEvent(gateways.memory));
  }

  if (matchesEventPattern('persona.*', event.type)) {
    fireAndForget(refreshPersonaForRemoteEvent(event, gateways.persona));
  }

  if (matchesEventPattern('schedule.*', event.type)) {
    fireAndForget(gateways.schedule.fetchSchedule());
  }
}

/**
 * Subscribes domain refresh actions to the live `/ws/otto/events` stream
 * (fed by `useOttoWebSocket`). Returns a dispose function.
 */
export function subscribeOttoSyncDomainRefresh(gateways: OttoSyncRefreshGateways): () => void {
  return useOttoEventsStore.getState().subscribeToEvents((event) => {
    dispatchOttoSyncDomainRefresh(
      {
        id: event.eventId,
        type: event.eventType,
        payload: event.data,
        timestamp: event.timestamp,
      },
      gateways,
    );
  });
}

/** Default gateways backed by Otto UI Zustand stores (browser). */
export function createDefaultOttoSyncGateways(): OttoSyncRefreshGateways {
  return {
    tasks: {
      fetchTasks: () => useTasksStore.getState().fetchTasks(),
    },
    dashboard: {
      fetchDashboard: () => useDashboardStore.getState().fetchDashboard(),
    },
    memory: {
      getSnapshot: () => {
        const s = useMemoryStore.getState();
        return { activeTab: s.activeTab, searchQuery: s.searchQuery };
      },
      fetchGraph: () => useMemoryStore.getState().fetchGraph(),
      fetchDiary: () => useMemoryStore.getState().fetchDiary(),
      searchMemory: (query) => useMemoryStore.getState().searchMemory(query),
    },
    persona: {
      getAgents: () => usePersonaStore.getState().agents,
      getSelectedAgent: () => usePersonaStore.getState().selectedAgent,
      fetchAgents: () => usePersonaStore.getState().fetchAgents(),
      selectAgent: (name) => usePersonaStore.getState().selectAgent(name),
    },
    schedule: {
      // Schedule is now the same data as Tasks — refresh both via fetchTasks.
      fetchSchedule: () => useTasksStore.getState().fetchTasks(),
    },
  };
}
