import { create } from 'zustand';
import type { Session } from '@opencode-ai/sdk/v2';
import { opencodeClient } from '@/lib/opencode/client';
import { listGlobalSessionPages, type GlobalSessionRecord, type InitialSessionPage } from '@/stores/globalSessions';

type GlobalSessionsStatus = 'idle' | 'loading' | 'ready' | 'error';

type LoadResult = {
  activeSessions: Session[];
  archivedSessions: Session[];
};

type GlobalSessionsState = {
  activeSessions: Session[];
  archivedSessions: Session[];
  hasLoaded: boolean;
  status: GlobalSessionsStatus;
  loadSessions: (fallbackActive?: Session[]) => Promise<LoadResult>;
  applySnapshot: (activeSessions: Session[], archivedSessions: Session[], status?: GlobalSessionsStatus) => void;
  upsertSession: (session: Session) => void;
  removeSessions: (ids: Iterable<string>) => void;
  archiveSessions: (ids: Iterable<string>, archivedAt?: number) => void;
};

// Large page size to minimize per-request overhead. The OpenCode server
// resolves the list in ~10ms regardless of size; the bottleneck is the
// per-request round-trip through the Vite dev proxy / browser stack
// (~500ms each). 1500 typically collapses pagination to a single request
// for installations with up to ~1500 active sessions, and bounds response
// size to under ~1MB even at the cap.
const PAGE_SIZE = 1500;

let inflightLoad: Promise<LoadResult> | null = null;
let inflightArchivedLoad: Promise<Session[]> | null = null;

type PrefetchResource = {
  data: GlobalSessionRecord[];
  nextCursor: string | null;
};

type SessionsPrefetch = {
  startedAt: number;
  pageSize: number;
  active: Promise<PrefetchResource | null>;
  archived: Promise<PrefetchResource | null>;
};

const consumePrefetch = (
  archived: boolean,
): Promise<PrefetchResource | null> | null => {
  if (typeof window === 'undefined') return null;
  const slot = (window as unknown as { __OPENCHAMBER_SESSIONS_PREFETCH__?: SessionsPrefetch }).__OPENCHAMBER_SESSIONS_PREFETCH__;
  if (!slot || slot.pageSize !== PAGE_SIZE) return null;
  const key = archived ? 'archived' : 'active';
  const promise = slot[key];
  // Single-use: clear immediately so subsequent loadSessions() calls go
  // through the SDK and pick up fresh data instead of stale prefetch.
  slot[key] = Promise.resolve(null);
  return promise ?? null;
};

const normalizePath = (value?: string | null): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const replaced = trimmed.replace(/\\/g, '/');
  if (replaced === '/') {
    return '/';
  }
  return replaced.length > 1 ? replaced.replace(/\/+$/, '') : replaced;
};

export const resolveGlobalSessionDirectory = (session: Session): string | null => {
  const record = session as Session & {
    directory?: string | null;
    project?: { worktree?: string | null } | null;
  };

  return normalizePath(record.directory ?? null)
    ?? normalizePath(record.project?.worktree ?? null);
};

const getSessionSignature = (session: Session): string => {
  return [
    session.id,
    session.title ?? '',
    session.time?.created ?? 0,
    session.time?.updated ?? 0,
    session.time?.archived ?? 0,
    session.share ? 1 : 0,
    resolveGlobalSessionDirectory(session) ?? '',
  ].join(':');
};

const sameSessionList = (prev: Session[], next: Session[]): boolean => {
  if (prev === next) {
    return true;
  }
  if (prev.length !== next.length) {
    return false;
  }
  for (let index = 0; index < prev.length; index += 1) {
    if (getSessionSignature(prev[index]) !== getSessionSignature(next[index])) {
      return false;
    }
  }
  return true;
};

const upsertSessionIntoList = (sessions: Session[], session: Session): Session[] => {
  const index = sessions.findIndex((candidate) => candidate.id === session.id);
  if (index === -1) {
    return [session, ...sessions];
  }
  if (getSessionSignature(sessions[index]) === getSessionSignature(session)) {
    return sessions;
  }
  const next = [...sessions];
  next[index] = session;
  return next;
};

const mergeSessionLists = (existing: Session[], incoming?: Session[]): Session[] => {
  if (!incoming || incoming.length === 0) {
    return existing;
  }

  if (existing.length === 0) {
    return incoming;
  }

  const byId = new Map(existing.map((session) => [session.id, session]));
  incoming.forEach((session) => {
    byId.set(session.id, session);
  });

  const ordered: Session[] = [];
  const seen = new Set<string>();

  existing.forEach((session) => {
    const next = byId.get(session.id);
    if (!next) {
      return;
    }
    ordered.push(next);
    seen.add(session.id);
  });

  incoming.forEach((session) => {
    if (seen.has(session.id)) {
      return;
    }
    const next = byId.get(session.id);
    if (next) {
      ordered.push(next);
      seen.add(session.id);
    }
  });

  return ordered;
};

const applySnapshot = (
  state: GlobalSessionsState,
  activeSessions: Session[],
  archivedSessions: Session[],
  status: GlobalSessionsStatus,
): Partial<GlobalSessionsState> | GlobalSessionsState => {
  const nextActiveSessions = sameSessionList(state.activeSessions, activeSessions)
    ? state.activeSessions
    : activeSessions;
  const nextArchivedSessions = sameSessionList(state.archivedSessions, archivedSessions)
    ? state.archivedSessions
    : archivedSessions;

  if (
    nextActiveSessions === state.activeSessions
    && nextArchivedSessions === state.archivedSessions
    && state.hasLoaded
    && state.status === status
  ) {
    return state;
  }

  return {
    activeSessions: nextActiveSessions,
    archivedSessions: nextArchivedSessions,
    hasLoaded: true,
    status,
  };
};

export const useGlobalSessionsStore = create<GlobalSessionsState>((set, get) => ({
  activeSessions: [],
  archivedSessions: [],
  hasLoaded: false,
  status: 'idle',

  applySnapshot: (activeSessions, archivedSessions, status = 'ready') => {
    set((state) => applySnapshot(state, activeSessions, archivedSessions, status));
  },

  loadSessions: async (fallbackActive) => {
    if (inflightLoad) {
      return inflightLoad;
    }

    set((state) => (state.status === 'loading' ? state : { status: 'loading' }));

    // Stream pages into state as they arrive so the UI can render
    // sessions progressively rather than waiting for the full pagination
    // to finish. This is the difference between "feels instant with the
    // first batch visible" vs "blank UI for several seconds while
    // thousands of sessions paginate".
    const accumulateInto = (
      bucket: 'activeSessions' | 'archivedSessions',
      page: GlobalSessionRecord[],
    ) => {
      if (page.length === 0) return;
      set((state) => {
        const existing = state[bucket];
        const byId = new Map(existing.map((session) => [session.id, session]));
        let changed = false;
        for (const session of page) {
          if (!session?.id) continue;
          const prior = byId.get(session.id);
          byId.set(session.id, session);
          if (!prior) changed = true;
        }
        if (!changed && existing.length === byId.size) {
          return state;
        }
        const next = Array.from(byId.values());
        return { [bucket]: next } as Partial<GlobalSessionsState>;
      });
    };

    const sdk = opencodeClient.getSdkClient();

    // Adopt prefetched first-page responses kicked off by index.html
    // during HTML parse. These complete well before the JS bundle finishes
    // parsing, eliminating the initial network round-trip from the
    // critical path of "time to first sessions visible."
    const activePrefetchPromise = consumePrefetch(false);
    const archivedPrefetchPromise = consumePrefetch(true);

    const resolveInitialPage = async (
      promise: Promise<PrefetchResource | null> | null,
    ): Promise<InitialSessionPage | undefined> => {
      if (!promise) return undefined;
      try {
        const result = await promise;
        if (!result) return undefined;
        const nextCursor = result.nextCursor === null ? null : Number(result.nextCursor);
        return {
          data: result.data,
          nextCursor: Number.isFinite(nextCursor) ? (nextCursor as number) : null,
        };
      } catch {
        return undefined;
      }
    };

    // Archived sessions are off the critical path — the sidebar's
    // archived group is collapsed by default and the user only needs
    // them when they expand it. Load them in the background so the
    // active list (which IS visible) doesn't wait. De-duplicate
    // concurrent archived loads so multiple refresh callers share.
    if (!inflightArchivedLoad) {
      inflightArchivedLoad = (async () => {
        const initialPage = await resolveInitialPage(archivedPrefetchPromise);
        return listGlobalSessionPages(sdk, {
          archived: true,
          pageSize: PAGE_SIZE,
          initialPage,
          onPage: (page) => accumulateInto('archivedSessions', page),
        });
      })()
        .then((archived) => {
          set((state) => applySnapshot(state, state.activeSessions, archived, state.status));
          return archived;
        })
        .catch((error) => {
          console.warn('[GlobalSessions] Failed to load archived sessions, preserving current snapshot:', error);
          return get().archivedSessions;
        })
        .finally(() => {
          inflightArchivedLoad = null;
        });
    }

    inflightLoad = (async () => {
      const current = get();

      let nextActiveSessions: Session[];
      try {
        const initialPage = await resolveInitialPage(activePrefetchPromise);
        nextActiveSessions = await listGlobalSessionPages(sdk, {
          archived: false,
          pageSize: PAGE_SIZE,
          initialPage,
          onPage: (page) => accumulateInto('activeSessions', page),
        });
        set((state) => applySnapshot(state, nextActiveSessions, state.archivedSessions, 'ready'));
      } catch (error) {
        console.warn('[GlobalSessions] Failed to load active sessions, preserving existing snapshot with fallback merge:', error);
        nextActiveSessions = mergeSessionLists(current.activeSessions, fallbackActive);
        set((state) => applySnapshot(state, nextActiveSessions, state.archivedSessions, 'error'));
      } finally {
        inflightLoad = null;
      }

      return {
        activeSessions: nextActiveSessions,
        archivedSessions: get().archivedSessions,
      };
    })();

    return inflightLoad;
  },

  upsertSession: (session) => {
    set((state) => {
      const isArchived = Boolean(session.time?.archived);
      const nextActiveSessions = isArchived
        ? state.activeSessions.filter((candidate) => candidate.id !== session.id)
        : upsertSessionIntoList(state.activeSessions, session);
      const nextArchivedSessions = isArchived
        ? upsertSessionIntoList(state.archivedSessions, session)
        : state.archivedSessions.filter((candidate) => candidate.id !== session.id);

      if (
        nextActiveSessions === state.activeSessions
        && nextArchivedSessions === state.archivedSessions
      ) {
        return state;
      }

      return {
        activeSessions: nextActiveSessions,
        archivedSessions: nextArchivedSessions,
      };
    });
  },

  removeSessions: (ids) => {
    const idSet = ids instanceof Set ? ids : new Set(ids);
    if (idSet.size === 0) {
      return;
    }

    set((state) => {
      const nextActiveSessions = state.activeSessions.filter((session) => !idSet.has(session.id));
      const nextArchivedSessions = state.archivedSessions.filter((session) => !idSet.has(session.id));

      if (
        nextActiveSessions.length === state.activeSessions.length
        && nextArchivedSessions.length === state.archivedSessions.length
      ) {
        return state;
      }

      return {
        activeSessions: nextActiveSessions,
        archivedSessions: nextArchivedSessions,
      };
    });
  },

  archiveSessions: (ids, archivedAt = Date.now()) => {
    const idSet = ids instanceof Set ? ids : new Set(ids);
    if (idSet.size === 0) {
      return;
    }

    set((state) => {
      const movedSessions: Session[] = [];
      const nextActiveSessions = state.activeSessions.filter((session) => {
        if (!idSet.has(session.id)) {
          return true;
        }

        movedSessions.push({
          ...session,
          time: {
            ...session.time,
            archived: archivedAt,
          },
        });
        return false;
      });

      if (movedSessions.length === 0) {
        return state;
      }

      const remainingArchivedSessions = state.archivedSessions.filter((session) => !idSet.has(session.id));

      return {
        activeSessions: nextActiveSessions,
        archivedSessions: [...movedSessions, ...remainingArchivedSessions],
      };
    });
  },
}));

export const ensureGlobalSessionsLoaded = async (fallbackActive?: Session[]): Promise<LoadResult> => {
  const state = useGlobalSessionsStore.getState();
  if (state.hasLoaded && state.status !== 'error') {
    return {
      activeSessions: state.activeSessions,
      archivedSessions: state.archivedSessions,
    };
  }
  return state.loadSessions(fallbackActive);
};

export const refreshGlobalSessions = async (fallbackActive?: Session[]): Promise<LoadResult> => {
  return useGlobalSessionsStore.getState().loadSessions(fallbackActive);
};
