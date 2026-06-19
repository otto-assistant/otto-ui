import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { startConfigUpdate, finishConfigUpdate } from '@/lib/configUpdate';
import { refreshAfterOpenCodeRestart } from '@/stores/useAgentsStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { opencodeClient } from '@/lib/opencode/client';
import { runtimeFetch } from '@/lib/runtime-fetch';

// ============== TYPES ==============

export interface MemoryRequirement {
  id: string;
  label: string;
}

export interface MemoryCapabilities {
  records?: boolean;
  create?: boolean;
  update?: boolean;
  delete?: boolean;
  search?: boolean;
  projectScoped?: boolean;
  configurable?: boolean;
}

export interface MemoryRecordModel {
  title?: boolean;
  kind?: boolean;
  tags?: boolean;
  triple?: boolean;
}

export interface MemoryBackend {
  id: string;
  name: string;
  tagline: string;
  description: string;
  docsUrl: string;
  integration: string;
  badges: string[];
  requirements: MemoryRequirement[];
  capabilities: MemoryCapabilities;
  recordModel: MemoryRecordModel;
  installed: boolean;
  active: boolean;
  detail: string;
  issues: string[];
}

export interface MemoryStatus {
  backends: MemoryBackend[];
  activeBackends: string[];
}

export interface MemoryRecord {
  id: string;
  title?: string;
  content: string;
  kind?: string;
  tags: string[];
  project?: string;
  createdAt?: string | number | null;
  updatedAt?: string | number | null;
}

export interface MemoryRecordInput {
  title?: string;
  content: string;
  kind?: string;
  tags?: string[];
}

export interface MemoryRecordsState {
  items: MemoryRecord[];
  loading: boolean;
  error: string | null;
  availability: { ok: boolean; reason?: string } | null;
  loaded: boolean;
}

export interface MemoryLifecycleResult {
  ok: boolean;
  warning?: string;
  reloadFailed?: boolean;
  deactivated?: string[];
}

interface MemoryStoreState {
  status: MemoryStatus | null;
  loading: boolean;
  error: string | null;
  records: Record<string, MemoryRecordsState>;

  loadStatus: (options?: { force?: boolean }) => Promise<boolean>;
  installBackend: (id: string, deactivateOthers: boolean) => Promise<MemoryLifecycleResult>;
  activateBackend: (id: string, deactivateOthers: boolean) => Promise<MemoryLifecycleResult>;
  deactivateBackend: (id: string) => Promise<MemoryLifecycleResult>;
  getBackendConfig: (id: string) => Promise<{ path: string; raw: string } | null>;
  saveBackendConfig: (id: string, raw: string) => Promise<boolean>;
  loadRecords: (id: string, query?: string) => Promise<void>;
  createRecord: (id: string, input: MemoryRecordInput) => Promise<boolean>;
  updateRecord: (id: string, recordId: string, input: MemoryRecordInput) => Promise<boolean>;
  deleteRecord: (id: string, recordId: string) => Promise<boolean>;
}

// ============== HELPERS ==============

const getConfigDirectory = (): string | null => {
  try {
    const activeProject = useProjectsStore.getState().getActiveProject?.();
    if (activeProject?.path?.trim()) {
      return activeProject.path.trim();
    }
    const clientDir = opencodeClient.getDirectory();
    if (clientDir?.trim()) {
      return clientDir.trim();
    }
  } catch (err) {
    console.warn('[MemoryStore] Error resolving config directory:', err);
  }
  return null;
};

const dirSuffix = (): string => {
  const dir = getConfigDirectory();
  return dir ? `?directory=${encodeURIComponent(dir)}` : '';
};

const recordsUrl = (id: string, query?: string): string => {
  const params = new URLSearchParams();
  const dir = getConfigDirectory();
  if (dir) params.set('directory', dir);
  if (query) params.set('q', query);
  const qs = params.toString();
  return `/api/config/memory/${encodeURIComponent(id)}/records${qs ? `?${qs}` : ''}`;
};

const dirHeaders = (extra?: Record<string, string>): Record<string, string> => {
  const dir = getConfigDirectory();
  return {
    ...(extra || {}),
    ...(dir ? { 'x-opencode-directory': dir } : {}),
  };
};

const emptyRecordsState = (): MemoryRecordsState => ({
  items: [],
  loading: false,
  error: null,
  availability: null,
  loaded: false,
});

// ============== STORE ==============

export const useMemoryStore = create<MemoryStoreState>()(
  devtools(
    (set, get) => ({
      status: null,
      loading: false,
      error: null,
      records: {},

      loadStatus: async (options) => {
        if (get().loading && !options?.force) {
          return true;
        }
        set({ loading: true, error: null });
        try {
          const response = await runtimeFetch(`/api/config/memory${dirSuffix()}`, {
            headers: dirHeaders(),
          });
          if (!response.ok) {
            throw new Error(`Failed to load memory status (${response.status})`);
          }
          const data: MemoryStatus = await response.json();
          set({ status: data, loading: false });
          return true;
        } catch (error) {
          console.error('[MemoryStore] loadStatus failed:', error);
          set({ loading: false, error: error instanceof Error ? error.message : 'Failed to load memory status' });
          return false;
        }
      },

      installBackend: async (id, deactivateOthers) => {
        startConfigUpdate('Installing memory backend…');
        try {
          const response = await runtimeFetch(`/api/config/memory/${encodeURIComponent(id)}/install${dirSuffix()}`, {
            method: 'POST',
            headers: dirHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ deactivateOthers }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(data?.error || `Install failed (${response.status})`);
          }
          if (data.status) set({ status: data.status });
          if (data.requiresReload) {
            await refreshAfterOpenCodeRestart();
          }
          return { ok: true, warning: data.warning, reloadFailed: data.reloadFailed, deactivated: data.deactivated };
        } catch (error) {
          return { ok: false, warning: error instanceof Error ? error.message : 'Install failed' };
        } finally {
          finishConfigUpdate();
        }
      },

      activateBackend: async (id, deactivateOthers) => {
        startConfigUpdate('Activating memory backend…');
        try {
          const response = await runtimeFetch(`/api/config/memory/${encodeURIComponent(id)}/activate${dirSuffix()}`, {
            method: 'POST',
            headers: dirHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ deactivateOthers }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(data?.error || `Activation failed (${response.status})`);
          }
          if (data.status) set({ status: data.status });
          if (data.requiresReload) {
            await refreshAfterOpenCodeRestart();
          }
          return { ok: true, warning: data.warning, reloadFailed: data.reloadFailed, deactivated: data.deactivated };
        } catch (error) {
          return { ok: false, warning: error instanceof Error ? error.message : 'Activation failed' };
        } finally {
          finishConfigUpdate();
        }
      },

      deactivateBackend: async (id) => {
        startConfigUpdate('Deactivating memory backend…');
        try {
          const response = await runtimeFetch(`/api/config/memory/${encodeURIComponent(id)}/deactivate${dirSuffix()}`, {
            method: 'POST',
            headers: dirHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({}),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(data?.error || `Deactivation failed (${response.status})`);
          }
          if (data.status) set({ status: data.status });
          if (data.requiresReload) {
            await refreshAfterOpenCodeRestart();
          }
          return { ok: true, warning: data.warning, reloadFailed: data.reloadFailed };
        } catch (error) {
          return { ok: false, warning: error instanceof Error ? error.message : 'Deactivation failed' };
        } finally {
          finishConfigUpdate();
        }
      },

      getBackendConfig: async (id) => {
        try {
          const response = await runtimeFetch(`/api/config/memory/${encodeURIComponent(id)}/config${dirSuffix()}`, {
            headers: dirHeaders(),
          });
          if (!response.ok) {
            throw new Error(`Failed to load config (${response.status})`);
          }
          return await response.json();
        } catch (error) {
          console.error('[MemoryStore] getBackendConfig failed:', error);
          return null;
        }
      },

      saveBackendConfig: async (id, raw) => {
        try {
          const response = await runtimeFetch(`/api/config/memory/${encodeURIComponent(id)}/config${dirSuffix()}`, {
            method: 'PUT',
            headers: dirHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ raw }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(data?.error || `Save failed (${response.status})`);
          }
          return true;
        } catch (error) {
          console.error('[MemoryStore] saveBackendConfig failed:', error);
          return false;
        }
      },

      loadRecords: async (id, query) => {
        set((state) => ({
          records: {
            ...state.records,
            [id]: { ...(state.records[id] || emptyRecordsState()), loading: true, error: null },
          },
        }));
        try {
          const response = await runtimeFetch(recordsUrl(id, query), {
            headers: dirHeaders(),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            set((state) => ({
              records: {
                ...state.records,
                [id]: {
                  items: [],
                  loading: false,
                  error: data?.error || `Failed to load records (${response.status})`,
                  availability: data?.availability || { ok: false, reason: data?.error },
                  loaded: true,
                },
              },
            }));
            return;
          }
          set((state) => ({
            records: {
              ...state.records,
              [id]: {
                items: Array.isArray(data.items) ? data.items : [],
                loading: false,
                error: null,
                availability: data.availability || { ok: true },
                loaded: true,
              },
            },
          }));
        } catch (error) {
          set((state) => ({
            records: {
              ...state.records,
              [id]: {
                items: [],
                loading: false,
                error: error instanceof Error ? error.message : 'Failed to load records',
                availability: null,
                loaded: true,
              },
            },
          }));
        }
      },

      createRecord: async (id, input) => {
        try {
          const response = await runtimeFetch(`/api/config/memory/${encodeURIComponent(id)}/records${dirSuffix()}`, {
            method: 'POST',
            headers: dirHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ input }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(data?.error || `Create failed (${response.status})`);
          }
          await get().loadRecords(id);
          return true;
        } catch (error) {
          console.error('[MemoryStore] createRecord failed:', error);
          throw error;
        }
      },

      updateRecord: async (id, recordId, input) => {
        try {
          const response = await runtimeFetch(`/api/config/memory/${encodeURIComponent(id)}/records/${encodeURIComponent(recordId)}${dirSuffix()}`, {
            method: 'PUT',
            headers: dirHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ input }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(data?.error || `Update failed (${response.status})`);
          }
          await get().loadRecords(id);
          return true;
        } catch (error) {
          console.error('[MemoryStore] updateRecord failed:', error);
          throw error;
        }
      },

      deleteRecord: async (id, recordId) => {
        try {
          const response = await runtimeFetch(`/api/config/memory/${encodeURIComponent(id)}/records/${encodeURIComponent(recordId)}${dirSuffix()}`, {
            method: 'DELETE',
            headers: dirHeaders(),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(data?.error || `Delete failed (${response.status})`);
          }
          await get().loadRecords(id);
          return true;
        } catch (error) {
          console.error('[MemoryStore] deleteRecord failed:', error);
          throw error;
        }
      },
    }),
    { name: 'MemoryStore' },
  ),
);

// Leaf selector: ids of active backends (for dynamic settings nav visibility).
export const selectActiveMemoryBackendIds = (state: MemoryStoreState): string[] =>
  state.status?.activeBackends ?? [];
