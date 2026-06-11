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
  upgrading: boolean;
  error: string | null;
  _lastFetchedAt: number;

  fetchStatus: (options?: { force?: boolean }) => Promise<void>;
  checkForUpdates: () => Promise<void>;
  triggerUpgrade: () => Promise<void>;
}

const FALLBACK_STATUS: OttoStatus = {
  version: 'dev',
  uptime: 0,
  healthy: false,
  services: [
    { name: 'opencode', healthy: false },
    { name: 'otto-cli', healthy: false },
  ],
};

const buildFallbackConnections = (): OttoConnections => ({
  discord: { connected: false },
  serverUrl: typeof window !== 'undefined' ? window.location.origin : '',
  relay: { connected: false },
});

/**
 * Maps the `/api/otto/status` payload
 * (`{ version: { openchamber, otto }, uptime: { processSeconds }, health: { ottoCli, openCode } }`)
 * into the UI-facing {@link OttoStatus} shape.
 */
export function mapOttoStatusResponse(data: unknown): OttoStatus | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;

  const version = record.version as Record<string, unknown> | undefined;
  const uptime = record.uptime as Record<string, unknown> | undefined;
  const health = record.health as Record<string, unknown> | undefined;

  if (!version && !uptime && !health) return null;

  const openCodeReady = health?.openCode === 'ready';
  const ottoCliOk = health?.ottoCli === 'ok';

  const ottoVersion = typeof version?.otto === 'string' ? version.otto : null;
  const openchamberVersion = typeof version?.openchamber === 'string' ? version.openchamber : null;

  return {
    version: ottoVersion ?? openchamberVersion ?? 'unknown',
    uptime: typeof uptime?.processSeconds === 'number' ? uptime.processSeconds : 0,
    healthy: openCodeReady,
    services: [
      { name: 'opencode', healthy: openCodeReady },
      { name: 'otto-cli', healthy: ottoCliOk },
    ],
  };
}

export const useOttoSettingsStore = create<OttoSettingsState>((set, get) => ({
  status: null,
  connections: null,
  security: null,
  availableUpdate: null,
  loading: false,
  upgrading: false,
  error: null,
  _lastFetchedAt: 0,

  fetchStatus: async (options) => {
    const STALE_MS = 30_000;
    const cur = get();
    if (!options?.force && cur.status && cur._lastFetchedAt && Date.now() - cur._lastFetchedAt < STALE_MS) {
      return;
    }
    set({ loading: true, error: null });
    try {
      const res = await fetch("/api/otto/status");
      if (!res.ok) throw new Error(`Failed to fetch status: ${res.status}`);
      const data = await res.json();
      const status = mapOttoStatusResponse(data);
      if (!status) throw new Error('Unexpected Otto status payload');
      set({
        status,
        connections: buildFallbackConnections(),
        loading: false,
        _lastFetchedAt: Date.now(),
      });
    } catch {
      set({
        status: FALLBACK_STATUS,
        connections: buildFallbackConnections(),
        loading: false,
        error: null,
      });
    }
  },

  checkForUpdates: async () => {
    set({ error: null });
    try {
      const res = await fetch("/api/otto/upgrade/check");
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const message = data && typeof data.error === 'string'
          ? data.error
          : `Failed to check updates: ${res.status}`;
        throw new Error(message);
      }
      const latest = data && typeof data.latest === 'string' ? data.latest : null;
      const updateAvailable = Boolean(data?.updateAvailable && latest);
      set({ availableUpdate: updateAvailable && latest ? { version: latest } : null });
    } catch (e) {
      set({ error: (e as Error).message, availableUpdate: null });
    }
  },

  triggerUpgrade: async () => {
    set({ upgrading: true, error: null });
    try {
      const res = await fetch("/api/otto/upgrade", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const message = data && typeof data.error === 'string'
          ? data.error
          : `Upgrade failed: ${res.status}`;
        throw new Error(message);
      }
      set({ availableUpdate: null });
      await get().fetchStatus({ force: true });
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ upgrading: false });
    }
  },
}));
