import { useState, useEffect, useCallback, useMemo } from 'react';
import { parseHashRoute, navigateHash, type HashRouteState } from '@/lib/router/hashRoutes';
import type { AppActiveView } from '@/constants/agentNav';
import { useUIStore } from '@/stores/useUIStore';

export interface RouteInfo {
  /** Current view path segment (e.g. 'tasks', 'persona') */
  path: string;
  /** Deep link parameters (e.g. { id: 'task-123' }) */
  params: Record<string, string>;
  /** Navigate to a view with optional params */
  navigate: (view: AppActiveView, params?: Record<string, string>) => void;
}

/**
 * Hook that provides hash-based routing state and navigation.
 * Syncs bidirectionally with useUIStore.activeView.
 */
export function useRoute(): RouteInfo {
  const [routeState, setRouteState] = useState<HashRouteState>(() => parseHashRoute());

  const navigate = useCallback((view: AppActiveView, params?: Record<string, string>) => {
    navigateHash(view, params);
    // Store sync happens via hashchange listener
  }, []);

  // Listen for hash changes (from browser back/forward or programmatic)
  useEffect(() => {
    const handleHashChange = () => {
      const parsed = parseHashRoute();
      setRouteState(parsed);

      // Sync to store
      const currentView = useUIStore.getState().activeView;
      if (currentView !== parsed.view) {
        useUIStore.getState().setActiveView(parsed.view);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('popstate', handleHashChange);

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
      window.removeEventListener('popstate', handleHashChange);
    };
  }, []);

  // On mount: apply initial hash to store
  useEffect(() => {
    const initial = parseHashRoute();
    if (initial.view !== 'dashboard' || window.location.hash) {
      const currentView = useUIStore.getState().activeView;
      if (currentView !== initial.view) {
        useUIStore.getState().setActiveView(initial.view);
      }
    }
  }, []);

  const path = useMemo(() => routeState.view, [routeState.view]);
  const params = useMemo(() => routeState.params, [routeState.params]);

  return { path, params, navigate };
}
