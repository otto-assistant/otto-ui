import { create } from "zustand";

export interface OttoStatus {
  version: string;
  uptime: number;
  healthy: boolean;
  services: {
    name: string;
    healthy: boolean;
  }[];
}

export interface OttoConnections {
  discord: {
    connected: boolean;
    username?: string;
    guildCount?: number;
  };
  serverUrl: string;
  relay: {
    connected: boolean;
    latencyMs?: number;
  };
}

export interface OttoSecurity {
  ipcToken: string;
  allowedDiscordUsers: string[];
}

export interface AvailableUpdate {
  version: string;
  releaseNotes?: string;
}

interface OttoSettingsState {
  status: OttoStatus | null;
  connections: OttoConnections | null;
  security: OttoSecurity | null;
  availableUpdate: AvailableUpdate | null;
  loading: boolean;
  error: string | null;
  _lastFetchedAt: number;

  fetchStatus: () => Promise<void>;
  checkForUpdates: () => Promise<void>;
  triggerUpgrade: () => Promise<void>;
}

export const useOttoSettingsStore = create<OttoSettingsState>((set, get) => ({
  status: null,
  connections: null,
  security: null,
  availableUpdate: null,
  loading: false,
  error: null,
  _lastFetchedAt: 0,

  fetchStatus: async () => {
    const STALE_MS = 30_000;
    const cur = get();
    if (cur.status && cur._lastFetchedAt && Date.now() - cur._lastFetchedAt < STALE_MS) {
      return;
    }
    set({ loading: true, error: null });
    try {
      const res = await fetch("/api/otto/status");
      if (!res.ok) throw new Error(`Failed to fetch status: ${res.status}`);
      const data = await res.json();
      set({
        status: data.status,
        connections: data.connections,
        security: data.security,
        loading: false,
        _lastFetchedAt: Date.now(),
      });
    } catch {
      set({
        status: {
          version: 'dev',
          uptime: 0,
          healthy: false,
          services: [
            { name: 'opencode', healthy: false },
            { name: 'otto-api', healthy: false },
          ],
        },
        connections: {
          discord: { connected: false },
          serverUrl: window.location.origin,
          relay: { connected: false },
        },
        loading: false,
        error: null,
      });
    }
  },

  checkForUpdates: async () => {
    try {
      const res = await fetch("/api/otto/status");
      if (!res.ok) throw new Error(`Failed to check updates: ${res.status}`);
      const data = await res.json();
      set({ availableUpdate: data.availableUpdate ?? null });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  triggerUpgrade: async () => {
    try {
      const res = await fetch("/api/otto/upgrade", { method: "POST" });
      if (!res.ok) throw new Error(`Upgrade failed: ${res.status}`);
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },
}));
