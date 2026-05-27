import React, { useEffect, useState } from 'react';
import {
  useTasksStore,
  type TaskPriority,
  type TaskOwnerType,
  type TaskRecurrence,
} from '@/stores/useTasksStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useConfigStore } from '@/stores/useConfigStore';
import { usePersonaStore } from '@/stores/usePersonaStore';
import { triggerTaskNow } from '@/hooks/useTaskScheduler';

/** Convert a `datetime-local` input value (no tz) to an ISO string in the user's tz. */
function localDatetimeToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Default the "Due" picker to the next round 5 minutes from now. */
function defaultDueLocal(): string {
  const d = new Date(Date.now() + 5 * 60 * 1000);
  d.setSeconds(0, 0);
  // Round up to next 5-minute boundary.
  const minutes = d.getMinutes();
  const remainder = minutes % 5;
  if (remainder !== 0) {
    d.setMinutes(minutes + (5 - remainder));
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const TaskCreateDialog: React.FC = () => {
  const open = useTasksStore((s) => s.createDialogOpen);
  const setOpen = useTasksStore((s) => s.setCreateDialogOpen);
  const createTask = useTasksStore((s) => s.createTask);
  const markTaskTriggered = useTasksStore((s) => s.markTaskTriggered);
  const projects = useProjectsStore((s) => s.projects);
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const providers = useConfigStore((s) => s.providers);
  const globalModel = useConfigStore((s) => s.currentModelId);
  const globalProvider = useConfigStore((s) => s.currentProviderId);
  const globalAgent = useConfigStore((s) => s.currentAgentName);
  const configAgents = useConfigStore((s) => s.agents);
  const personaAgent = usePersonaStore((s) => s.selectedAgent);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dueAt, setDueAt] = useState<string>(defaultDueLocal());
  const [hasDueAt, setHasDueAt] = useState<boolean>(true);
  const [recurrence, setRecurrence] = useState<TaskRecurrence>('none');
  const [ownerType, setOwnerType] = useState<TaskOwnerType>('user');
  const [ownerName, setOwnerName] = useState('You');
  const [selectedProjectId, setSelectedProjectId] = useState<string>(activeProjectId ?? '');
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [startImmediately, setStartImmediately] = useState<boolean>(false);
  const [hidden, setHidden] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset all form state whenever the dialog is freshly opened.
  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setPriority('medium');
      setDueAt(defaultDueLocal());
      setHasDueAt(true);
      setRecurrence('none');
      setOwnerType('user');
      setOwnerName('You');
      setSelectedProjectId(activeProjectId ?? '');
      setSelectedAgent('');
      setSelectedModel('');
      setStartImmediately(false);
      setHidden(false);
      setIsSubmitting(false);
    }
  }, [open, activeProjectId]);

  if (!open) return null;

  const selectedProject = projects.find(p => p.id === selectedProjectId);
  const effectiveAgent = selectedAgent || personaAgent || globalAgent || '';
  const effectiveModel = selectedModel || globalModel || '';
  const effectiveProvider = globalProvider || '';

  const allModels = providers.flatMap(p => (p.models ?? []).map(m => ({ provider: p.id, model: m.id, label: `${m.name ?? m.id}` })));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!title.trim() || isSubmitting) return;
    setIsSubmitting(true);
    const taskTitle = title.trim();
    const taskDesc = description.trim();
    const dueIso = hasDueAt ? localDatetimeToIso(dueAt) : null;

    try {
      const created = await createTask({
        title: taskTitle,
        description: taskDesc,
        priority,
        ownerType,
        ownerName,
        dueAt: dueIso,
        dueDate: dueIso,
        recurrence,
        projectId: selectedProjectId || null,
        projectPath: selectedProject?.path ?? null,
        agentName: effectiveAgent || null,
        modelId: effectiveModel || null,
        providerId: effectiveProvider || null,
        hidden: ownerType !== 'user' ? hidden : false,
      });

      // For agent/cron tasks: start the session now if explicitly requested OR if no due time was set.
      const shouldStartNow = (ownerType === 'agent' || ownerType === 'cron')
        && (startImmediately || !dueIso);

      if (shouldStartNow) {
        if (effectiveAgent) {
          useConfigStore.getState().setAgent(effectiveAgent);
        }
        // Reuse the unified trigger so behavior matches the scheduler.
        triggerTaskNow(created);
        markTaskTriggered(created.id);
      }
    } finally {
      // useEffect on `open` will reset the form when the dialog next opens.
      setIsSubmitting(false);
    }
  };

  const handleCancel = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      setOpen(false);
    }
  };

  // Prevent Enter in single-line inputs from accidentally submitting twice.
  const handleFormKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
      e.preventDefault();
      // Submit explicitly if the title is filled and we're not already submitting.
      if (title.trim() && !isSubmitting) {
        void handleSubmit(e as unknown as React.FormEvent);
      }
    }
  };

  const sectionLabel = "text-xs font-medium text-muted-foreground mb-1";
  const selectClass = "rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring w-full";

  const submitLabel = (() => {
    if (ownerType === 'user') return 'Create';
    if (startImmediately || !hasDueAt) return 'Create & Start Now';
    return 'Schedule';
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={handleBackdropClick}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        onKeyDown={handleFormKeyDown}
        className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-xl max-h-[90vh] overflow-y-auto"
      >
        <h2 className="mb-4 text-base font-semibold text-foreground">Create Task</h2>

        <div className="flex flex-col gap-3">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={3}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />

          <div className="grid grid-cols-2 gap-3">
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
              className={selectClass}
            >
              <option value="high">High Priority</option>
              <option value="medium">Medium Priority</option>
              <option value="low">Low Priority</option>
            </select>
            <select
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value as TaskRecurrence)}
              className={selectClass}
              title="Repeat cadence"
            >
              <option value="none">Does not repeat</option>
              <option value="daily">Repeats daily</option>
              <option value="weekly">Repeats weekly</option>
              <option value="monthly">Repeats monthly</option>
            </select>
          </div>

          {/* Due date + time */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className={sectionLabel + ' mb-0'}>Due date & time</span>
              <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={hasDueAt}
                  onChange={(e) => setHasDueAt(e.target.checked)}
                  className="h-3 w-3"
                />
                Scheduled
              </label>
            </div>
            <input
              type="datetime-local"
              value={dueAt}
              disabled={!hasDueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className={selectClass + (hasDueAt ? '' : ' opacity-50')}
            />
            {hasDueAt && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                {recurrence === 'none'
                  ? 'Fires once at the time above.'
                  : `Fires at the time above, then ${recurrence}.`}
              </p>
            )}
          </div>

          {/* Project selector */}
          <div>
            <div className={sectionLabel}>Project</div>
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className={selectClass}
            >
              <option value="">Default (current project)</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.label || p.path.split('/').pop()}</option>
              ))}
            </select>
          </div>

          {/* Owner */}
          <select
            value={ownerType}
            onChange={(e) => {
              const v = e.target.value as TaskOwnerType;
              setOwnerType(v);
              setOwnerName(v === 'user' ? 'You' : v === 'agent' ? 'Otto' : 'Cron');
            }}
            className={selectClass}
          >
            <option value="user">Assign to: Me (popup alert when due)</option>
            <option value="agent">Assign to: Agent (starts chat when due)</option>
            <option value="cron">Assign to: Scheduled job (starts chat when due)</option>
          </select>

          {/* Agent & Model selectors — shown for agent/cron tasks */}
          {(ownerType === 'agent' || ownerType === 'cron') && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
              <div className="text-xs font-medium text-foreground">Agent & Model Configuration</div>

              <div>
                <div className={sectionLabel}>Agent {effectiveAgent && <span className="text-foreground">(using: {effectiveAgent})</span>}</div>
                <select value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)} className={selectClass}>
                  <option value="">Default{personaAgent ? ` (persona: ${personaAgent})` : globalAgent ? ` (global: ${globalAgent})` : ''}</option>
                  {configAgents.map(a => (
                    <option key={a.name} value={a.name}>{a.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <div className={sectionLabel}>Model {effectiveModel && <span className="text-foreground">(using: {effectiveModel})</span>}</div>
                <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} className={selectClass}>
                  <option value="">Default{globalModel ? ` (${globalModel})` : ''}</option>
                  {allModels.map(m => (
                    <option key={`${m.provider}/${m.model}`} value={m.model}>{m.label}</option>
                  ))}
                </select>
              </div>

              {hasDueAt && (
                <label className="flex items-center gap-2 text-xs text-foreground">
                  <input
                    type="checkbox"
                    checked={startImmediately}
                    onChange={(e) => setStartImmediately(e.target.checked)}
                    className="h-3 w-3"
                  />
                  Start the chat session now (ignore the scheduled time)
                </label>
              )}

              <label className="flex items-start gap-2 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={hidden}
                  onChange={(e) => setHidden(e.target.checked)}
                  className="mt-0.5 h-3 w-3"
                />
                <span>
                  Run hidden
                  <span className="block text-[10px] text-muted-foreground">
                    The agent's conversation is not shown in the sidebar. The agent can
                    start a reply with <code className="rounded bg-muted px-1">REPORT:</code> to
                    surface the conversation when it wants to share results.
                  </span>
                </span>
              </label>

              <p className="text-[10px] text-muted-foreground">
                Defaults come from Persona → project → global settings. Override here for this task only.
                {selectedProject ? ` Session opens in: ${selectedProject.label || selectedProject.path.split('/').pop()}.` : ''}
              </p>
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={handleCancel} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim() || isSubmitting}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {isSubmitting ? 'Creating…' : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
};
