import { create } from "zustand";

export type AgentRunStatus = "Running" | "Idle" | "Error";

export type DashboardAgentCard = {
  id: string;
  name: string;
  status: AgentRunStatus;
  model: string | null;
  uptimeMs: number | null;
};

export type DashboardActivity = {
  id: string;
  kind: string;
  description: string;
  at: number;
};

export type DashboardStats = {
  messagesToday: number;
  tasksCompleted: number;
  activeSessions: number;
  memoryFacts: number;
};

export type DashboardRunningTask = {
  id: string;
  title: string;
  progress: number;
};

export type DashboardRecentSession = {
  id: string;
  title: string;
  at: number;
};

export type OttoDashboardStatus = {
  version?: string;
  healthy?: boolean;
  updatedAt?: number;
};

type DashboardStoreState = {
  status: OttoDashboardStatus | null;
  agents: DashboardAgentCard[];
  activity: DashboardActivity[];
  stats: DashboardStats;
  runningTasks: DashboardRunningTask[];
  recentSessions: DashboardRecentSession[];
  isLoading: boolean;
  error: string | null;
};

type DashboardStore = DashboardStoreState & {
  fetchDashboard: () => Promise<void>;
};

const defaultStats: DashboardStats = {
  messagesToday: 0,
  tasksCompleted: 0,
  activeSessions: 0,
  memoryFacts: 0,
};

function clampProgress(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function mapAgentStatus(raw: unknown): AgentRunStatus {
  const s = String(raw ?? "").toLowerCase();
  if (s === "running" || s === "active") return "Running";
  if (s === "error" || s === "failed" || s === "errored") return "Error";
  return "Idle";
}

function normalizeAgent(entry: unknown): DashboardAgentCard | null {
  if (!entry || typeof entry !== "object") return null;
  const obj = entry as Record<string, unknown>;
  const idRaw = obj.id ?? obj.agentId ?? obj.name ?? "";
  const nameRaw = obj.name ?? obj.title ?? idRaw ?? "Agent";
  const id = String(idRaw).trim();
  const name = String(nameRaw).trim() || id || "Agent";

  let uptimeMs: number | null = null;
  if (typeof obj.uptimeMs === "number" && Number.isFinite(obj.uptimeMs)) {
    uptimeMs = obj.uptimeMs;
  } else if (typeof obj.uptime_ms === "number" && Number.isFinite(obj.uptime_ms)) {
    uptimeMs = obj.uptime_ms;
  } else if (typeof obj.uptime === "number" && Number.isFinite(obj.uptime)) {
    uptimeMs = obj.uptime >= 1000 ? obj.uptime : obj.uptime * 1000;
  }

  return {
    id: id || name,
    name,
    status: mapAgentStatus(obj.status ?? obj.state),
    model: obj.model != null ? String(obj.model) : null,
    uptimeMs,
  };
}

function normalizeActivity(entry: unknown, index: number): DashboardActivity | null {
  if (!entry || typeof entry !== "object") return null;
  const obj = entry as Record<string, unknown>;
  const description = String(obj.description ?? obj.message ?? obj.text ?? "").trim();
  if (!description) return null;
  const id = String(obj.id ?? obj.eventId ?? `activity-${index}`);
  let at = typeof obj.at === "number" ? obj.at : NaN;
  if (!Number.isFinite(at)) {
    at =
      typeof obj.timestamp === "number"
        ? obj.timestamp
        : typeof obj.createdAt === "number"
          ? obj.createdAt
          : Date.now() - index * 60_000;
  }
  const kind =
    typeof obj.kind === "string"
      ? obj.kind
      : typeof obj.type === "string"
        ? obj.type
        : "system";
  return { id, kind, description, at };
}

function normalizeTask(entry: unknown, index: number): DashboardRunningTask | null {
  if (!entry || typeof entry !== "object") return null;
  const obj = entry as Record<string, unknown>;
  const titleRaw = obj.title ?? obj.name ?? "";
  const title = String(titleRaw).trim() || "Task";
  const idRaw = obj.id ?? "";
  const id = String(idRaw).trim() || `${title}-${index}`;
  return {
    id,
    title,
    progress: clampProgress(obj.progress ?? obj.percent),
  };
}

function normalizeSession(entry: unknown, index: number): DashboardRecentSession | null {
  if (!entry || typeof entry !== "object") return null;
  const obj = entry as Record<string, unknown>;
  const idRaw = obj.id ?? obj.sessionId ?? "";
  const id = String(idRaw).trim();
  if (!id) return null;
  const title = String(obj.title ?? obj.name ?? "Untitled session").trim() || "Untitled session";
  let at =
    typeof obj.at === "number"
      ? obj.at
      : typeof obj.updatedAt === "number"
        ? obj.updatedAt
        : typeof obj.createdAt === "number"
          ? obj.createdAt
          : NaN;
  if (!Number.isFinite(at)) {
    at = Date.now() - index * 120_000;
  }
  return { id, title, at };
}

function normalizeStats(raw: unknown): DashboardStats {
  if (!raw || typeof raw !== "object") return { ...defaultStats };
  const obj = raw as Record<string, unknown>;
  const num = (v: unknown): number => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    messagesToday: Math.max(0, Math.floor(num(obj.messagesToday ?? obj.messages))),
    tasksCompleted: Math.max(0, Math.floor(num(obj.tasksCompleted ?? obj.tasks))),
    activeSessions: Math.max(0, Math.floor(num(obj.activeSessions ?? obj.sessions))),
    memoryFacts: Math.max(0, Math.floor(num(obj.memoryFacts ?? obj.facts))),
  };
}

async function safeFetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const text = await res.text();
  if (!text.trim()) return null;
  return JSON.parse(text) as unknown;
}

function extractAgentsPayload(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.agents)) return obj.agents;
    if (Array.isArray(obj.items)) return obj.items;
    if (Array.isArray(obj.data)) return obj.data;
  }
  return [];
}

function normalizeStatus(statusObj: Record<string, unknown> | null): OttoDashboardStatus | null {
  if (!statusObj) return null;
  return {
    version: typeof statusObj.version === "string" ? statusObj.version : undefined,
    healthy: typeof statusObj.healthy === "boolean" ? statusObj.healthy : undefined,
    updatedAt:
      typeof statusObj.updatedAt === "number"
        ? statusObj.updatedAt
        : typeof statusObj.timestamp === "number"
          ? statusObj.timestamp
          : typeof statusObj.time === "number"
            ? statusObj.time
            : undefined,
  };
}

function buildMockState(): Pick<
  DashboardStoreState,
  "status" | "agents" | "activity" | "stats" | "runningTasks" | "recentSessions"
> {
  const now = Date.now();
  return {
    status: { healthy: true, updatedAt: now, version: "mock" },
    agents: [
      { id: "agent-demo-ops", name: "Ops", status: "Running", model: "gpt-5", uptimeMs: 3_600_000 },
      {
        id: "agent-demo-research",
        name: "Research",
        status: "Idle",
        model: "claude-opus-4",
        uptimeMs: null,
      },
      { id: "agent-demo-health", name: "Healthchecks", status: "Error", model: null, uptimeMs: 12_000 },
    ],
    activity: [
      { id: "activity-1", kind: "chat", description: "Summarized sprint goals for the workspace", at: now - 90_000 },
      {
        id: "activity-2",
        kind: "task",
        description: "Queued housekeeping: reconcile session titles",
        at: now - 12 * 60_000,
      },
      { id: "activity-3", kind: "memory", description: "Remembered routing preference for this device", at: now - 50 * 60_000 },
    ],
    stats: { messagesToday: 42, tasksCompleted: 7, activeSessions: 3, memoryFacts: 128 },
    runningTasks: [
      { id: "task-dashboard", title: "Ship dashboard scaffolding", progress: 64 },
      { id: "task-ci", title: "Run type-check for packages/ui", progress: 18 },
    ],
    recentSessions: [
      { id: "mock-session-1", title: "Architecture notes", at: now - 20 * 60_000 },
      { id: "mock-session-2", title: "Bug sweep: notifications", at: now - 2 * 60 * 60_000 },
      { id: "mock-session-3", title: "Weekly retro", at: now - 26 * 60 * 60_000 },
    ],
  };
}

export const useDashboardStore = create<DashboardStore>((set) => ({
  status: null,
  agents: [],
  activity: [],
  stats: { ...defaultStats },
  runningTasks: [],
  recentSessions: [],
  isLoading: false,
  error: null,

  fetchDashboard: async () => {
    set({ isLoading: true, error: null });
    try {
      const [statusRaw, agentsRaw] = await Promise.all([
        safeFetchJson("/api/otto/status"),
        safeFetchJson("/api/otto/agents"),
      ]);

      const statusObj =
        statusRaw && typeof statusRaw === "object" ? (statusRaw as Record<string, unknown>) : null;

      const activityRaw = statusObj?.activity ?? statusObj?.recentActivity;
      const activity: DashboardActivity[] = Array.isArray(activityRaw)
        ? activityRaw
            .map((e, i) => normalizeActivity(e, i))
            .filter((item): item is DashboardActivity => Boolean(item))
            .slice(0, 10)
        : [];

      const statsPayload = statusObj?.stats ?? statusObj?.quickStats;
      const stats = normalizeStats(statsPayload ?? {});

      const tasksRaw = statusObj?.runningTasks ?? statusObj?.tasks;
      const runningTasks: DashboardRunningTask[] = Array.isArray(tasksRaw)
        ? tasksRaw
            .map((e, i) => normalizeTask(e, i))
            .filter((item): item is DashboardRunningTask => Boolean(item))
        : [];

      const sessionsRaw = statusObj?.recentSessions ?? statusObj?.sessions;
      const recentSessions: DashboardRecentSession[] = Array.isArray(sessionsRaw)
        ? sessionsRaw
            .map((e, i) => normalizeSession(e, i))
            .filter((item): item is DashboardRecentSession => Boolean(item))
            .slice(0, 5)
        : [];

      const agentsFromApi = extractAgentsPayload(agentsRaw)
        .map((e) => normalizeAgent(e))
        .filter((a): a is DashboardAgentCard => Boolean(a));

      set({
        status: normalizeStatus(statusObj),
        agents: agentsFromApi,
        activity,
        stats,
        runningTasks,
        recentSessions,
        isLoading: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load dashboard';
      set({ ...buildMockState(), isLoading: false, error: msg });
    }
  },
}));
