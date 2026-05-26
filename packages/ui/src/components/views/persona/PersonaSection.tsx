import React, { useEffect } from 'react';
import { usePersonaStore } from '@/stores/usePersonaStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { BehaviorSliders } from './BehaviorSliders';
import { LanguageSelector } from './LanguageSelector';
import { SkillsToggles } from './SkillsToggles';
import { RiFolderLine, RiGlobalLine } from '@remixicon/react';
import { cn } from '@/lib/utils';

interface PersonaSectionProps {
  /**
   * The currently-edited agent name (from the agents store). When provided,
   * the persona section will load/persist persona settings for this agent.
   */
  agentName: string | null;
}

/**
 * Persona configuration section.
 *
 * Embedded inside the Agents settings page so a single screen covers both the
 * agent's OpenCode-side config (model, system prompt, permissions) and the
 * Otto-side persona settings (display name, behavior, language, skills) with
 * an optional per-project scope.
 */
export const PersonaSection: React.FC<PersonaSectionProps> = ({ agentName }) => {
  const {
    config,
    selectedAgent,
    scope,
    setScope,
    setPersonaName,
    setActiveProjectId,
    selectAgent,
    fetchAgents,
  } = usePersonaStore();
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const activeProject = useProjectsStore((s) =>
    s.activeProjectId ? s.projects.find((p) => p.id === s.activeProjectId) ?? null : null,
  );

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    setActiveProjectId(activeProjectId ?? null);
  }, [activeProjectId, setActiveProjectId]);

  // Keep persona store's selected agent in sync with the Agents settings page.
  useEffect(() => {
    if (agentName && agentName !== selectedAgent) {
      void selectAgent(agentName);
    }
  }, [agentName, selectedAgent, selectAgent]);

  if (!config) {
    return (
      <div className="px-2 pb-2 pt-0 typography-meta text-muted-foreground">
        Persona settings will appear once an agent is selected.
      </div>
    );
  }

  const canScopeProject = Boolean(activeProjectId);
  const projectLabel =
    activeProject?.label?.trim() ||
    (activeProject?.path ? activeProject.path.split('/').pop() ?? activeProject.path : null);

  return (
    <section className="px-2 pb-2 pt-0 space-y-4">
      {/* Scope */}
      <div className="flex flex-col gap-1.5">
        <span className="typography-ui-label text-foreground">Scope</span>
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
                ? 'Override persona settings for the active project only'
                : 'Open a project to enable per-project persona settings'
            }
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              scope === 'project'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              !canScopeProject &&
                'cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground',
            )}
          >
            <RiFolderLine className="size-3.5" />
            This project
          </button>
        </div>
        <p className="typography-micro text-muted-foreground">
          {scope === 'project' && projectLabel
            ? `Persona changes below apply only to ${projectLabel} and are stored locally.`
            : scope === 'project'
            ? 'Persona changes below apply only to the active project and are stored locally.'
            : 'Persona changes below apply to this agent everywhere unless a project overrides them.'}
        </p>
      </div>

      {/* Persona name */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="agent-persona-name" className="typography-ui-label text-foreground">
          Persona name
        </label>
        <input
          id="agent-persona-name"
          type="text"
          value={config.displayName}
          onChange={(e) => setPersonaName(e.target.value)}
          placeholder={agentName ?? 'My persona'}
          className="w-full max-w-sm rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <p className="typography-micro text-muted-foreground">
          A friendly name shown in the UI. Defaults to the agent name.
        </p>
      </div>

      <div className="h-px bg-[var(--surface-subtle)]" />

      <BehaviorSliders />
      <div className="h-px bg-[var(--surface-subtle)]" />
      <LanguageSelector />
      <div className="h-px bg-[var(--surface-subtle)]" />
      <SkillsToggles />
    </section>
  );
};
