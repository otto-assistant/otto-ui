import React, { useEffect } from 'react';
import { useOttoSettingsStore } from '@/stores/useOttoSettingsStore';

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export const OttoStatusSection: React.FC = () => {
  const { status, loading, error, fetchStatus } = useOttoSettingsStore();

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  if (loading && !status) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-foreground">Otto Status</h3>
        <p className="mt-2 text-xs text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (error && !status) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-foreground">Otto Status</h3>
        <p className="mt-2 text-xs text-destructive">{error}</p>
      </div>
    );
  }

  if (!status) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">Otto Status</h3>
        <div className="flex items-center gap-1.5">
          <span className={`inline-block h-2 w-2 rounded-full ${status.healthy ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-xs text-muted-foreground">{status.healthy ? 'Healthy' : 'Unhealthy'}</span>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <div>
          <span className="text-muted-foreground">Version</span>
          <p className="font-mono text-foreground">{status.version}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Uptime</span>
          <p className="text-foreground">{formatUptime(status.uptime)}</p>
        </div>
      </div>
      {status.services.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <span className="text-xs text-muted-foreground">Services</span>
          {status.services.map((svc) => (
            <div key={svc.name} className="flex items-center gap-2">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${svc.healthy ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-xs text-foreground">{svc.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
