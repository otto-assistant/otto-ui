import React from 'react';

export const ProjectsView: React.FC = () => (
  <div className="flex h-full flex-col gap-4 overflow-auto bg-background p-6">
    <h1 className="text-lg font-semibold text-foreground">Projects</h1>
    <p className="text-sm leading-relaxed text-muted-foreground">
      Projects workspace placeholder — project-scoped workspaces and repos will aggregate here next.
    </p>
  </div>
);
