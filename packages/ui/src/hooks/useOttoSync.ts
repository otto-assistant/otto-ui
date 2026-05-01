import { useEffect, useState } from 'react';
import { type ConnectionState, type SyncEvent, getOttoSyncClient } from '../lib/otto-sync';
import { useTasksStore } from '../stores/useTasksStore';
import { useDashboardStore } from '../stores/useDashboardStore';
import { useMemoryStore } from '../stores/useMemoryStore';

/**
 * React hook that initializes the OttoSyncClient singleton and dispatches
 * incoming WebSocket events to the appropriate Zustand stores.
 */
export function useOttoSync() {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');

  useEffect(() => {
    const client = getOttoSyncClient();

    const unsubs: (() => void)[] = [];

    // Connection state
    unsubs.push(client.onConnection(setConnectionState));

    // Task events → useTasksStore (refetch on any task event)
    unsubs.push(
      client.on('task.*', (_event: SyncEvent) => {
        const store = useTasksStore.getState();
        store.fetchTasks();
      }),
    );

    // Agent events → useDashboardStore (refetch dashboard)
    unsubs.push(
      client.on('agent.*', (_event: SyncEvent) => {
        const store = useDashboardStore.getState();
        store.fetchDashboard();
      }),
    );

    // Memory events → useMemoryStore (refetch graph)
    unsubs.push(
      client.on('memory.*', (_event: SyncEvent) => {
        const store = useMemoryStore.getState();
        store.fetchGraph();
      }),
    );

    // Persona events
    unsubs.push(
      client.on('persona.*', (_event: SyncEvent) => {
        // Persona store refresh will be wired when needed
      }),
    );

    // Schedule events
    unsubs.push(
      client.on('schedule.*', (_event: SyncEvent) => {
        // Schedule store refresh will be wired when needed
      }),
    );

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, []);

  return { connectionState };
}
