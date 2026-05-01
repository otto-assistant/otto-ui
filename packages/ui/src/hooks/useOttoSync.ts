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

    // Task events → useTasksStore
    unsubs.push(
      client.on('task.*', (event: SyncEvent) => {
        const store = useTasksStore.getState();
        switch (event.type) {
          case 'task.created':
            store.addTask?.(event.payload as never);
            break;
          case 'task.updated':
            store.updateTask?.(event.payload as never);
            break;
          case 'task.deleted': {
            const { id } = event.payload as { id: string };
            store.deleteTask?.(id);
            break;
          }
        }
      }),
    );

    // Agent events → useDashboardStore
    unsubs.push(
      client.on('agent.*', (event: SyncEvent) => {
        const store = useDashboardStore.getState();
        if (event.type === 'agent.status_changed' && store.updateAgentStatus) {
          store.updateAgentStatus(event.payload as never);
        }
      }),
    );

    // Memory events → useMemoryStore
    unsubs.push(
      client.on('memory.*', (event: SyncEvent) => {
        const store = useMemoryStore.getState();
        if (event.type === 'memory.updated' && store.refresh) {
          store.refresh();
        }
      }),
    );

    // Persona events
    unsubs.push(
      client.on('persona.*', (_event: SyncEvent) => {
        // Persona store refresh will be wired when usePersonaStore exists
      }),
    );

    // Schedule events
    unsubs.push(
      client.on('schedule.*', (_event: SyncEvent) => {
        // Schedule store refresh will be wired when useScheduleStore exists
      }),
    );

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, []);

  return { connectionState };
}
