import React, { useState } from 'react';
import { useOttoSettingsStore } from '@/stores/useOttoSettingsStore';

export const UpgradeSection: React.FC = () => {
  const { status, availableUpdate, checkForUpdates, triggerUpgrade } = useOttoSettingsStore();
  const [checking, setChecking] = useState(false);
  const [upgrading, setUpgrading] = useState(false);

  const handleCheck = async () => {
    setChecking(true);
    await checkForUpdates();
    setChecking(false);
  };

  const handleUpgrade = async () => {
    setUpgrading(true);
    await triggerUpgrade();
    setUpgrading(false);
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-medium text-foreground">Upgrade</h3>
      <div className="mt-3 space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Current version</span>
          <span className="font-mono text-foreground">{status?.version ?? '—'}</span>
        </div>
        {availableUpdate && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Available</span>
            <span className="font-mono text-green-500">{availableUpdate.version}</span>
          </div>
        )}
        <div className="flex gap-2">
          <button
            onClick={handleCheck}
            disabled={checking}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            {checking ? 'Checking...' : 'Check for updates'}
          </button>
          {availableUpdate && (
            <button
              onClick={handleUpgrade}
              disabled={upgrading}
              className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {upgrading ? 'Upgrading...' : `Upgrade to ${availableUpdate.version}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
