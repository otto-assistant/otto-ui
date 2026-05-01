import React from 'react';

export const PersonaView: React.FC = () => (
  <div className="flex h-full flex-col gap-4 overflow-auto bg-background p-6">
    <h1 className="text-lg font-semibold text-foreground">Persona</h1>
    <p className="text-sm leading-relaxed text-muted-foreground">
      Persona placeholder — configure tone, autonomy, boundaries, and style for this agent shell.
    </p>
  </div>
);
