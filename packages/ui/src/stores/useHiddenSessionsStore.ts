import { create } from 'zustand';
import { devtools, persist, createJSONStorage } from 'zustand/middleware';
import { getSafeStorage } from './utils/safeStorage';

/**
 * Tracks session IDs that were created by *hidden* tasks. Hidden sessions
 * are filtered out of the session sidebar so the user does not see the
 * agent's background conversation. The agent can surface a hidden session
 * at any time by prefixing a response with `REPORT:`, or the user can
 * surface it manually from the Task detail drawer.
 *
 * `taskSessionMap` is the reverse lookup (task id → session id) used when
 * the user wants to inspect a hidden task's conversation.
 */
interface HiddenSessionsState {
  hiddenSessions: string[];
  taskSessionMap: Record<string, string>;
  /**
   * When a task is triggered with `hidden=true` but the session has not
   * been created yet (the OpenCode SDK returns asynchronously), record the
   * task id here so the session-creation listener can tag the new session.
   */
  pendingHiddenTaskId: string | null;

  isHidden: (sessionId: string) => boolean;
  hideSession: (sessionId: string, taskId?: string | null) => void;
  surfaceSession: (sessionId: string) => void;
  setPendingHiddenTask: (taskId: string | null) => void;
  /** Returns and clears the pending task id, if any. */
  consumePendingHiddenTask: () => string | null;
  /** Look up the session that was created for a given hidden task. */
  getSessionForTask: (taskId: string) => string | undefined;
  /** Inspect a streaming text part; surface the session if it starts with `REPORT:`. */
  maybeSurfaceOnReport: (sessionId: string, text: string) => boolean;
}

const REPORT_PREFIX = /^\s*(?:\[\s*REPORT\s*\]|REPORT\s*:|<report>)/i;

export const useHiddenSessionsStore = create<HiddenSessionsState>()(
  devtools(
    persist(
      (set, get) => ({
        hiddenSessions: [],
        taskSessionMap: {},
        pendingHiddenTaskId: null,

        isHidden: (sessionId) => get().hiddenSessions.includes(sessionId),

        hideSession: (sessionId, taskId) => {
          if (!sessionId) return;
          set((state) => {
            const next = state.hiddenSessions.includes(sessionId)
              ? state.hiddenSessions
              : [...state.hiddenSessions, sessionId];
            const taskMap = taskId
              ? { ...state.taskSessionMap, [taskId]: sessionId }
              : state.taskSessionMap;
            return { hiddenSessions: next, taskSessionMap: taskMap };
          });
        },

        surfaceSession: (sessionId) => {
          if (!sessionId) return;
          set((state) => ({
            hiddenSessions: state.hiddenSessions.filter((id) => id !== sessionId),
          }));
        },

        setPendingHiddenTask: (taskId) => set({ pendingHiddenTaskId: taskId }),

        consumePendingHiddenTask: () => {
          const id = get().pendingHiddenTaskId;
          if (id) set({ pendingHiddenTaskId: null });
          return id;
        },

        getSessionForTask: (taskId) => get().taskSessionMap[taskId],

        maybeSurfaceOnReport: (sessionId, text) => {
          if (!get().isHidden(sessionId)) return false;
          if (!text || !REPORT_PREFIX.test(text)) return false;
          get().surfaceSession(sessionId);
          return true;
        },
      }),
      {
        name: 'otto-hidden-sessions',
        version: 1,
        storage: createJSONStorage(() => getSafeStorage()),
        partialize: (state) => ({
          hiddenSessions: state.hiddenSessions,
          taskSessionMap: state.taskSessionMap,
        }),
      },
    ),
    { name: 'hidden-sessions-store' },
  ),
);
