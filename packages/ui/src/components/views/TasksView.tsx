import React from 'react';

export const TasksView: React.FC = () => (
  <div className="flex h-full flex-col gap-4 overflow-auto bg-background p-6">
    <h1 className="text-lg font-semibold text-foreground">Tasks</h1>
    <p className="text-sm leading-relaxed text-muted-foreground">
      Tasks placeholder — agent task lists, dependencies, and hand-offs will synchronize with Otto task APIs here.
    </p>
  </div>
);
