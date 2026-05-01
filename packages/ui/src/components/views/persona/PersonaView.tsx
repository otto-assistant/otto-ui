import React, { useEffect } from 'react';
import { usePersonaStore } from '@/stores/usePersonaStore';
import { AgentSelector } from './AgentSelector';
import { SystemPromptEditor } from './SystemPromptEditor';
import { SkillsToggles } from './SkillsToggles';
import { BehaviorSliders } from './BehaviorSliders';
import { LanguageSelector } from './LanguageSelector';
import { RiRobot2Line } from '@remixicon/react';

export const PersonaView: React.FC = () => {
  const { fetchAgents, isLoading, error, config } = usePersonaStore();

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  if (isLoading && !config) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <span className="text-sm text-muted-foreground">Loading agents...</span>
      </div>
    );
  }

  if (error && !config) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <span className="text-sm text-destructive">{error}</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-6 overflow-auto bg-background p-6">
      <div className="flex items-center gap-3">
        <RiRobot2Line className="size-5 text-foreground" />
        <h1 className="text-lg font-semibold text-foreground">Persona</h1>
      </div>
      <AgentSelector />
      {config && (
        <div className="flex flex-col gap-6">
          <SystemPromptEditor />
          <div className="h-px bg-border" />
          <BehaviorSliders />
          <div className="h-px bg-border" />
          <LanguageSelector />
          <div className="h-px bg-border" />
          <SkillsToggles />
        </div>
      )}
    </div>
  );
};
