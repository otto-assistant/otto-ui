import { useEffect, useState } from 'react';
import { type ConnectionState, getOttoSyncClient } from '../lib/otto-sync';
import {
  createDefaultOttoSyncGateways,
  subscribeOttoSyncDomainRefresh,
} from '../lib/otto-sync-refresh';

/**
 * React hook that initializes the OttoSyncClient singleton and dispatches
 * incoming WebSocket events to the appropriate Zustand stores.
 */
export function useOttoSync() {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');

  useEffect(() => {
    const client = getOttoSyncClient();

    const unsubs: (() => void)[] = [];

    unsubs.push(client.onConnection(setConnectionState));
    unsubs.push(subscribeOttoSyncDomainRefresh(client, createDefaultOttoSyncGateways()));

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, []);

  return { connectionState };
}
