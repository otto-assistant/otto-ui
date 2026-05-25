import React, { useEffect, useState } from 'react';
import { RiPlugLine } from '@remixicon/react';
import { ConnectionsSection } from '@/components/sections/otto-settings';
import { MessengerSection } from '@/components/sections/otto-settings/MessengerSection';
import { ottoFetch } from '@/lib/api-base';
import { useOttoSettingsStore } from '@/stores/useOttoSettingsStore';

type MempalaceStatus = {
  available: boolean;
  path?: string;
  stats?: Record<string, unknown>;
};

function MempalaceSection(): React.ReactElement {
  const [status, setStatus] = useState<MempalaceStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    ottoFetch('/api/otto/mempalace/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setStatus((data as MempalaceStatus | null) ?? { available: false });
      })
      .catch(() => {
        if (!cancelled) setStatus({ available: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const connected = status?.available === true;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-foreground">MemPalace Memory Bridge</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Long-term knowledge graph backend powering the Memory view.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <span
            className={`inline-block h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-muted-foreground'}`}
            aria-hidden
          />
          <span className="text-foreground">
            {status === null ? 'Checking…' : connected ? 'Connected' : 'Not configured'}
          </span>
        </div>
      </div>
      {connected && status?.path ? (
        <div className="mt-3 rounded-md bg-muted/50 px-3 py-2 text-[11px] font-mono text-muted-foreground break-all">
          {status.path}
        </div>
      ) : null}
    </div>
  );
}

export const IntegrationsView: React.FC = () => {
  const fetchStatus = useOttoSettingsStore((s) => s.fetchStatus);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex items-center gap-3 border-b border-border/40 px-6 py-4">
        <RiPlugLine className="size-5 text-foreground" aria-hidden />
        <div>
          <h1
            className="text-lg font-semibold text-foreground"
            data-testid="view-integrations-heading"
          >
            Integrations
          </h1>
          <p className="text-xs text-muted-foreground">
            Manage how Otto connects to messengers, memory, and the local server.
          </p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          <MessengerSection />
          <MempalaceSection />
          <ConnectionsSection />
        </div>
      </div>
    </div>
  );
};

export default IntegrationsView;
