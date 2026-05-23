import React, { useState } from 'react';
import { useTasksStore, type TaskPriority, type TaskOwnerType } from '@/stores/useTasksStore';
import { useUIStore } from '@/stores/useUIStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useConfigStore } from '@/stores/useConfigStore';
import { usePersonaStore } from '@/stores/usePersonaStore';

export const TaskCreateDialog: React.FC = () => {
  const open = useTasksStore((s) => s.createDialogOpen);
  const setOpen = useTasksStore((s) => s.setCreateDialogOpen);
  const createTask = useTasksStore((s) => s.createTask);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const openNewSessionDraft = useSessionUIStore((s) => s.openNewSessionDraft);
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
  const [dueDate, setDueDate] = useState('');
  const [ownerType, setOwnerType] = useState<TaskOwnerType>('user');
  const [ownerName, setOwnerName] = useState('You');
  const [selectedProjectId, setSelectedProjectId] = useState<string>(activeProjectId ?? '');
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');

  if (!open) return null;

  const selectedProject = projects.find(p => p.id === selectedProjectId);
  const effectiveAgent = selectedAgent || personaAgent || globalAgent || '';
  const effectiveModel = selectedModel || globalModel || '';
  const effectiveProvider = globalProvider || '';

  const allModels = providers.flatMap(p => (p.models ?? []).map(m => ({ provider: p.id, model: m.id, label: `${m.name ?? m.id}` })));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const taskTitle = title.trim();
    const taskDesc = description.trim();
    createTask({
      title: taskTitle,
      description: taskDesc,
      priority,
      ownerType,
      ownerName,
      dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      projectId: selectedProjectId || null,
      projectPath: selectedProject?.path ?? null,
      agentName: effectiveAgent || null,
      modelId: effectiveModel || null,
      providerId: effectiveProvider || null,
    });

    if (ownerType === 'agent') {
      if (effectiveAgent) {
        useConfigStore.getState().setAgent(effectiveAgent);
      }
      setActiveView('chat');
      openNewSessionDraft({
        title: `Task: ${taskTitle}`,
        initialPrompt: `Work on task: ${taskTitle}`,
        directoryOverride: selectedProject?.path ?? undefined,
        syntheticParts: taskDesc ? [{ text: `Task details:\n${taskDesc}\n\nPriority: ${priority}`, synthetic: true }] : undefined,
      });
    }

    setTitle('');
    setDescription('');
    setPriority('medium');
    setDueDate('');
    setOwnerType('user');
    setOwnerName('You');
    setSelectedAgent('');
    setSelectedModel('');
  };

  const sectionLabel = "text-xs font-medium text-muted-foreground mb-1";
  const selectClass = "rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring w-full";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setOpen(false)}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
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
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={selectClass}
            />
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
            <option value="user">Assign to: Me</option>
            <option value="agent">Assign to: Agent</option>
            <option value="cron">Assign to: Scheduled</option>
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

              <p className="text-[10px] text-muted-foreground">
                Defaults come from Persona → project → global settings. Override here for this task only.
              </p>
            </div>
          )}

          {ownerType === 'agent' && (
            <p className="text-xs text-muted-foreground">
              A chat session will open{selectedProject ? ` in ${selectedProject.label || selectedProject.path.split('/').pop()}` : ''} with the configured agent to work on this task.
            </p>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => setOpen(false)} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {ownerType === 'agent' ? 'Create & Start Session' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
};
