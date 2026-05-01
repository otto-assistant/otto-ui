import React from 'react';
import {
  OttoStatusSection,
  ConnectionsSection,
  UpgradeSection,
  SecuritySection,
} from '@/components/sections/otto-settings';

export const SettingsLandingView: React.FC = () => (
  <div className="flex h-full flex-col gap-4 overflow-auto bg-background p-6">
    <h1 className="text-lg font-semibold text-foreground">Settings</h1>

    {/* Otto-specific settings */}
    <div className="grid gap-4 md:grid-cols-2">
      <OttoStatusSection />
      <ConnectionsSection />
      <UpgradeSection />
      <SecuritySection />
    </div>

    <p className="text-sm leading-relaxed text-muted-foreground">
      App settings launch in the windowed drawer on desktop and fullscreen on mobile — keep this pane as a breadcrumb until the agent shell adopts inline settings editors.
    </p>
  </div>
);
