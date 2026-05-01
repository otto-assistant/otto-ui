import React from 'react';
import { cn } from '@/lib/utils';
import { usePersonaStore } from '@/stores/usePersonaStore';

export const AgentSelector: React.FC = () => {
  const { agents, selectedAgent, selectAgent } = usePersonaStore();

  return (
    <div className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1">
      {agents.map((agent) => (
        <button
          key={agent}
          onClick={() => selectAgent(agent)}
          className={cn(
            'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            agent === selectedAgent
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          {agent}
        </button>
      ))}
    </div>
  );
};
