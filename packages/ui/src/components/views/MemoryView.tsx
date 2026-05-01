import React from 'react';

export const MemoryView: React.FC = () => (
  <div className="flex h-full flex-col gap-4 overflow-auto bg-background p-6">
    <h1 className="text-lg font-semibold text-foreground">Memory</h1>
    <p className="text-sm leading-relaxed text-muted-foreground">
      Memory placeholder — long-lived facts and palace-style recall surfaces will connect via Otto API hooks.
    </p>
  </div>
);
