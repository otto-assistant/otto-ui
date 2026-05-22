import React from 'react';
import {
  OttoStatusSection,
  ConnectionsSection,
  UpgradeSection,
  SecuritySection,
} from '@/components/sections/otto-settings';
import { useConfigStore } from '@/stores/useConfigStore';
import { usePersonaStore } from '@/stores/usePersonaStore';
import { useUIStore } from '@/stores/useUIStore';

function GlobalDefaultsSection() {
  const currentAgent = useConfigStore((s) => s.currentAgentName);
  const currentModel = useConfigStore((s) => s.currentModelId);
  const currentProvider = useConfigStore((s) => s.currentProviderId);
  const personaAgent = usePersonaStore((s) => s.selectedAgent);
  const setActiveView = useUIStore((s) => s.setActiveView);

  const row = "flex items-center justify-between py-2 border-b border-border/30 last:border-0";
  const label = "text-xs text-muted-foreground";
  const value = "text-xs font-medium text-foreground";

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-foreground">Global Defaults</h3>
        <button type="button" onClick={() => setActiveView('persona')} className="text-[10px] text-primary hover:text-primary/80">
          Edit in Persona →
        </button>
      </div>
      <div className="space-y-0">
        <div className={row}>
          <span className={label}>Agent</span>
          <span className={value}>{personaAgent || currentAgent || 'Not set'}</span>
        </div>
        <div className={row}>
          <span className={label}>Model</span>
          <span className={value}>{currentModel || 'Not set'}</span>
        </div>
        <div className={row}>
          <span className={label}>Provider</span>
          <span className={value}>{currentProvider || 'Not set'}</span>
        </div>
      </div>
      <p className="mt-3 text-[10px] text-muted-foreground">
        These defaults apply to all new sessions and tasks unless overridden at the project or task level.
      </p>
    </div>
  );
}

export const SettingsLandingView: React.FC = () => (
  <div className="h-full overflow-auto bg-background">
    <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-8">
      <h1 className="text-lg font-semibold text-foreground">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Global configuration for Otto. Per-project overrides are set in project settings.
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <GlobalDefaultsSection />
        <OttoStatusSection />
        <ConnectionsSection />
        <UpgradeSection />
        <SecuritySection />
      </div>
    </div>
  </div>
);
