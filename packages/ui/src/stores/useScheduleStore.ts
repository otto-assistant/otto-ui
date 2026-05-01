import { create } from "zustand";

export type ScheduleEventType = "one-time" | "recurring";
export type ScheduleEventStatus = "active" | "paused" | "completed" | "failed";

export interface ScheduleEvent {
  id: string;
  title: string;
  prompt: string;
  type: ScheduleEventType;
  /** ISO datetime for one-time events */
  datetime?: string;
  /** Cron expression for recurring events */
  cron?: string;
  status: ScheduleEventStatus;
  agentId?: string;
  createdAt: string;
}

export type ViewMode = "month" | "week";

interface ScheduleState {
  events: ScheduleEvent[];
  viewMode: ViewMode;
  currentDate: Date;
  loading: boolean;
  setViewMode: (mode: ViewMode) => void;
  setCurrentDate: (date: Date) => void;
  fetchSchedule: () => Promise<void>;
  createEvent: (event: Omit<ScheduleEvent, "id" | "createdAt">) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
}

// Mock data for development
const MOCK_EVENTS: ScheduleEvent[] = [
  {
    id: "1",
    title: "Daily standup summary",
    prompt: "Summarize yesterday's git commits and open PRs",
    type: "recurring",
    cron: "0 9 * * 1-5",
    status: "active",
    createdAt: "2026-04-28T10:00:00Z",
  },
  {
    id: "2",
    title: "Weekly dependency check",
    prompt: "Check for outdated dependencies and security advisories",
    type: "recurring",
    cron: "0 10 * * 1",
    status: "active",
    createdAt: "2026-04-25T08:00:00Z",
  },
  {
    id: "3",
    title: "Deploy staging",
    prompt: "Run staging deployment pipeline",
    type: "one-time",
    datetime: "2026-05-02T14:00:00Z",
    status: "active",
    createdAt: "2026-04-30T12:00:00Z",
  },
  {
    id: "4",
    title: "Backup database",
    prompt: "Run full database backup to S3",
    type: "recurring",
    cron: "0 2 * * *",
    status: "paused",
    createdAt: "2026-04-20T09:00:00Z",
  },
];

export const useScheduleStore = create<ScheduleState>((set, get) => ({
  events: MOCK_EVENTS,
  viewMode: "month",
  currentDate: new Date(),
  loading: false,

  setViewMode: (mode) => set({ viewMode: mode }),
  setCurrentDate: (date) => set({ currentDate: date }),

  fetchSchedule: async () => {
    set({ loading: true });
    try {
      const res = await fetch("/api/otto/schedule");
      if (res.ok) {
        const data = await res.json();
        set({ events: data.events ?? data });
      }
    } catch {
      // Use mock data on failure
    } finally {
      set({ loading: false });
    }
  },

  createEvent: async (event) => {
    try {
      const res = await fetch("/api/otto/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      });
      if (res.ok) {
        const created = await res.json();
        set({ events: [...get().events, created] });
        return;
      }
    } catch {
      // fallback: add locally with generated id
    }
    const newEvent: ScheduleEvent = {
      ...event,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    set({ events: [...get().events, newEvent] });
  },

  deleteEvent: async (id) => {
    try {
      await fetch(`/api/otto/schedule/${id}`, { method: "DELETE" });
    } catch {
      // delete locally regardless
    }
    set({ events: get().events.filter((e) => e.id !== id) });
  },
}));
