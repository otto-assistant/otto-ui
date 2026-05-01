import React from 'react';

export const DashboardView: React.FC = () => (
  <div className="flex h-full flex-col gap-4 overflow-auto bg-background p-6">
    <h1 className="text-lg font-semibold text-foreground">Dashboard</h1>
    <p className="text-sm leading-relaxed text-muted-foreground">
      Agent dashboard placeholder — summaries, activity, and status will surface here once wired to the Otto backend.
    </p>
  </div>
);
