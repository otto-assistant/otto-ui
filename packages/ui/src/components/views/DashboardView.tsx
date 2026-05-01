import React from 'react';

export const DashboardView: React.FC = () => (
  <div className="flex h-full flex-col gap-4 overflow-auto bg-background p-4 md:p-6">
    <h1 className="text-lg font-semibold text-foreground">Dashboard</h1>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-muted-foreground">Status</h2>
        <p className="mt-1 text-2xl font-semibold text-foreground">Active</p>
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-muted-foreground">Tasks</h2>
        <p className="mt-1 text-2xl font-semibold text-foreground">—</p>
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-muted-foreground">Memory</h2>
        <p className="mt-1 text-2xl font-semibold text-foreground">—</p>
      </div>
    </div>
    <p className="text-sm leading-relaxed text-muted-foreground">
      Agent dashboard — summaries, activity, and status will surface here once wired to the Otto backend.
    </p>
  </div>
);
