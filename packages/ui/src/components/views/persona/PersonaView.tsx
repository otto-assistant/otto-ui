import React, { useEffect } from 'react';
import { usePersonaStore } from '@/stores/usePersonaStore';
import { useConfigStore } from '@/stores/useConfigStore';
import { AgentSelector } from './AgentSelector';
import { SystemPromptEditor } from './SystemPromptEditor';
import { SkillsToggles } from './SkillsToggles';
import { BehaviorSliders } from './BehaviorSliders';
import { LanguageSelector } from './LanguageSelector';
import { RiRobot2Line, RiCheckLine } from '@remixicon/react';

export const PersonaView: React.FC = () => {
  const { fetchAgents, isLoading, error, config, selectedAgent, isSaving, saveAgent } = usePersonaStore();
  const configAgent = useConfigStore((s) => s.currentAgentName);
  const setConfigAgent = useConfigStore((s) => s.setAgent);
  const [saved, setSaved] = React.useState(false);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  // Sync persona agent selection → chat agent
  useEffect(() => {
    if (selectedAgent && selectedAgent !== configAgent) {
      setConfigAgent(selectedAgent);
    }
  }, [selectedAgent, configAgent, setConfigAgent]);

  const handleSaveAll = async () => {
    await saveAgent();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

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
    <div className="h-full overflow-auto bg-background">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <RiRobot2Line className="size-5 text-foreground" />
            <h1 className="text-lg font-semibold text-foreground">Persona</h1>
          </div>
          {config && (
            <button
              onClick={handleSaveAll}
              disabled={isSaving}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {saved ? <RiCheckLine className="size-4" /> : null}
              {isSaving ? 'Saving...' : saved ? 'Saved!' : 'Save All Changes'}
            </button>
          )}
        </div>

        <p className="mt-1 text-sm text-muted-foreground">
          Configure agent personality. The selected agent is used for new conversations.
          {selectedAgent && (
            <span className="ml-1 font-medium text-foreground">Active: {selectedAgent}</span>
          )}
        </p>

        <div className="mt-6">
          <AgentSelector />
        </div>

        {config && (
          <div className="mt-6 flex flex-col gap-6">
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
    </div>
  );
};
