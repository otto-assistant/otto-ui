import React from 'react';

export const SettingsLandingView: React.FC = () => (
  <div className="flex h-full flex-col gap-4 overflow-auto bg-background p-6">
    <h1 className="text-lg font-semibold text-foreground">Settings</h1>
    <p className="text-sm leading-relaxed text-muted-foreground">
      App settings launch in the windowed drawer on desktop and fullscreen on mobile — keep this pane as a breadcrumb until the agent shell adopts inline settings editors.
    </p>
  </div>
);
