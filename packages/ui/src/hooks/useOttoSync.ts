import { useEffect, useState } from 'react';
import {
  useOttoEventsStore,
  type OttoWsConnectionStatus,
} from '../stores/useOttoEventsStore';
import {
  createDefaultOttoSyncGateways,
  subscribeOttoSyncDomainRefresh,
} from '../lib/otto-sync-refresh';

export type ConnectionState = 'connected' | 'disconnected' | 'reconnecting';

export function mapOttoWsStatusToConnectionState(status: OttoWsConnectionStatus): ConnectionState {
  if (status === 'open') return 'connected';
  if (status === 'connecting') return 'reconnecting';
  return 'disconnected';
}

/**
 * Dispatches incoming `/ws/otto/events` realtime events (fed by `useOttoWebSocket`)
 * to the appropriate Zustand store refresh actions, and exposes the connection state.
 */
export function useOttoSync() {
  const wsStatus = useOttoEventsStore((state) => state.connectionStatus);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');

  useEffect(() => {
    setConnectionState(mapOttoWsStatusToConnectionState(wsStatus));
  }, [wsStatus]);

  useEffect(() => {
    return subscribeOttoSyncDomainRefresh(createDefaultOttoSyncGateways());
  }, []);

  return { connectionState };
}
