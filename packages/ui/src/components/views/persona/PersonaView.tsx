import React, { useEffect } from 'react';
import { usePersonaStore } from '@/stores/usePersonaStore';
import { useConfigStore } from '@/stores/useConfigStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { AgentSelector } from './AgentSelector';
import { SystemPromptEditor } from './SystemPromptEditor';
import { SkillsToggles } from './SkillsToggles';
import { BehaviorSliders } from './BehaviorSliders';
import { LanguageSelector } from './LanguageSelector';
import { RiRobot2Line, RiCheckLine, RiFolderLine, RiGlobalLine } from '@remixicon/react';
import { cn } from '@/lib/utils';

export const PersonaView: React.FC = () => {
  const {
    fetchAgents,
    isLoading,
    error,
    config,
    selectedAgent,
    isSaving,
    saveAgent,
    setPersonaName,
    scope,
    setScope,
    setActiveProjectId,
  } = usePersonaStore();
  const configAgent = useConfigStore((s) => s.currentAgentName);
  const setConfigAgent = useConfigStore((s) => s.setAgent);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const activeProject = useProjectsStore((s) =>
    s.activeProjectId ? s.projects.find((p) => p.id === s.activeProjectId) ?? null : null,
  );
  const [saved, setSaved] = React.useState(false);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  // Keep the persona store aware of the active project so it can
  // load/save the right scope.
  useEffect(() => {
    setActiveProjectId(activeProjectId ?? null);
  }, [activeProjectId, setActiveProjectId]);

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

  const canScopeProject = Boolean(activeProjectId);
  const projectLabel =
    activeProject?.label?.trim() ||
    (activeProject?.path ? activeProject.path.split('/').pop() ?? activeProject.path : null);

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8">
        <div className="flex items-center gap-3">
          <RiRobot2Line className="size-5 text-foreground" />
          <h1 className="text-lg font-semibold text-foreground">Persona</h1>
        </div>

        <p className="mt-1 text-sm text-muted-foreground">
          Configure agent personality. The selected agent is used for new conversations.
          {selectedAgent && (
            <span className="ml-1 font-medium text-foreground">Active: {selectedAgent}</span>
          )}
        </p>

        {config && (
          <section className="mt-6 rounded-xl border border-border bg-[var(--surface-elevated)] p-4 md:p-6">
            <div className="flex flex-col gap-6">
              {/* Scope: global vs per-project */}
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-foreground">Scope</label>
                <div
                  role="radiogroup"
                  aria-label="Persona scope"
                  className="inline-flex w-fit rounded-lg border border-border bg-surface p-1"
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={scope === 'global'}
                    onClick={() => setScope('global')}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      scope === 'global'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <RiGlobalLine className="size-3.5" />
                    Global default
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={scope === 'project'}
                    onClick={() => canScopeProject && setScope('project')}
                    disabled={!canScopeProject}
                    title={
                      canScopeProject
                        ? 'Override settings for the active project only'
                        : 'Open a project to enable per-project persona settings'
                    }
                    className={cn(
                      'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      scope === 'project'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      !canScopeProject && 'cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground',
                    )}
                  >
                    <RiFolderLine className="size-3.5" />
                    This project
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {scope === 'project' && projectLabel
                    ? `Changes apply only to ${projectLabel} and are stored locally.`
                    : scope === 'project'
                    ? 'Changes apply only to the active project and are stored locally.'
                    : 'Changes apply to this agent everywhere unless a project overrides them.'}
                </p>
              </div>

              <div className="h-px bg-border" />

              {/* Agent picker */}
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-foreground">Agent</label>
                <AgentSelector />
                <p className="text-xs text-muted-foreground">
                  Pick which agent these persona settings configure.
                </p>
              </div>

              {/* Persona name */}
              <div className="flex flex-col gap-2">
                <label htmlFor="persona-name" className="text-sm font-medium text-foreground">
                  Persona name
                </label>
                <input
                  id="persona-name"
                  type="text"
                  value={config.displayName}
                  onChange={(e) => setPersonaName(e.target.value)}
                  placeholder={selectedAgent ?? 'My persona'}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <p className="text-xs text-muted-foreground">
                  A friendly name shown in the UI. Defaults to the agent name.
                </p>
              </div>

              <div className="h-px bg-border" />

              <SystemPromptEditor />
              <div className="h-px bg-border" />
              <BehaviorSliders />
              <div className="h-px bg-border" />
              <LanguageSelector />
              <div className="h-px bg-border" />
              <SkillsToggles />

              <div className="flex justify-end pt-2">
                <button
                  onClick={handleSaveAll}
                  disabled={isSaving}
                  className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {saved ? <RiCheckLine className="size-4" /> : null}
                  {isSaving ? 'Saving...' : saved ? 'Saved!' : 'Save Persona'}
                </button>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
