import React from 'react';
import { useOttoSettingsStore } from '@/stores/useOttoSettingsStore';

export const ConnectionsSection: React.FC = () => {
  const { connections } = useOttoSettingsStore();

  if (!connections) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-medium text-foreground">Connections</h3>
      <div className="mt-3 space-y-3 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Discord</span>
          <div className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${connections.discord.connected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-foreground">
              {connections.discord.connected
                ? connections.discord.username ?? 'Connected'
                : 'Disconnected'}
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Server URL</span>
          <span className="font-mono text-foreground">{connections.serverUrl}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Relay</span>
          <div className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${connections.relay.connected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-foreground">
              {connections.relay.connected
                ? `Connected${connections.relay.latencyMs != null ? ` (${connections.relay.latencyMs}ms)` : ''}`
                : 'Disconnected'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
