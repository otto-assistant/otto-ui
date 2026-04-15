import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui';
import { RiAddLine, RiCloseLine } from '@remixicon/react';
import { ModelSelector } from '@/components/sections/agents/ModelSelector';
import { AgentSelector } from '@/components/sections/commands/AgentSelector';
import { useConfigStore } from '@/stores/useConfigStore';
import type { ScheduledTask } from '@/lib/scheduledTasksApi';

const WEEKDAY_LABELS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

const TIMEZONE_OPTIONS = (() => {
  if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
    return Intl.supportedValuesOf('timeZone');
  }
  return [
    'UTC',
    'Europe/Kyiv',
    'Europe/London',
    'Europe/Berlin',
    'America/New_York',
    'America/Los_Angeles',
    'Asia/Tokyo',
  ];
})();

type ScheduledTaskDraft = {
  id?: string;
  name: string;
  enabled: boolean;
  schedule: {
    kind: 'daily' | 'weekly';
    times: string[];
    weekdays: number[];
    timezone: string;
  };
  execution: {
    prompt: string;
    providerID: string;
    modelID: string;
    variant: string;
    agent: string;
  };
  state?: ScheduledTask['state'];
};

const normalizeDraftTimes = (task: ScheduledTask | null): string[] => {
  if (!task) {
    return ['09:00'];
  }
  const candidates = Array.isArray(task.schedule.times)
    ? task.schedule.times
    : (task.schedule.time ? [task.schedule.time] : []);

  const valid = candidates
    .filter((value) => typeof value === 'string' && /^([01]\d|2[0-3]):([0-5]\d)$/.test(value))
    .map((value) => value.trim());

  const unique = Array.from(new Set(valid)).sort((a, b) => a.localeCompare(b));
  return unique.length > 0 ? unique : ['09:00'];
};

const toDraft = (
  task: ScheduledTask | null,
  defaults: {
    providerID: string;
    modelID: string;
    variant: string;
    agent: string;
  },
): ScheduledTaskDraft => {
  const timezoneFallback = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  if (!task) {
    return {
      name: '',
      enabled: true,
      schedule: {
        kind: 'daily',
        times: ['09:00'],
        weekdays: [1],
        timezone: timezoneFallback,
      },
      execution: {
        prompt: '',
        providerID: defaults.providerID,
        modelID: defaults.modelID,
        variant: defaults.variant,
        agent: defaults.agent,
      },
    };
  }

  return {
    id: task.id,
    name: task.name,
    enabled: task.enabled,
    schedule: {
      kind: task.schedule.kind === 'weekly' ? 'weekly' : 'daily',
      times: normalizeDraftTimes(task),
      weekdays: Array.isArray(task.schedule.weekdays) ? task.schedule.weekdays : [1],
      timezone: task.schedule.timezone || timezoneFallback,
    },
    execution: {
      prompt: task.execution.prompt,
      providerID: task.execution.providerID,
      modelID: task.execution.modelID,
      variant: task.execution.variant || '',
      agent: task.execution.agent || '',
    },
    state: task.state,
  };
};

const validateDraft = (draft: ScheduledTaskDraft): string | null => {
  if (!draft.name.trim()) {
    return 'Task name is required';
  }
  if (!draft.execution.prompt.trim()) {
    return 'Prompt is required';
  }
  if (!draft.execution.providerID.trim() || !draft.execution.modelID.trim()) {
    return 'Model is required';
  }

  const validTimes = draft.schedule.times.filter((value) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(value));
  if (validTimes.length === 0) {
    return 'Add at least one valid time';
  }

  if (draft.schedule.kind === 'weekly' && draft.schedule.weekdays.length === 0) {
    return 'Select at least one weekday';
  }

  if (!draft.schedule.timezone.trim()) {
    return 'Timezone is required';
  }

  return null;
};

const dedupeSortTimes = (times: string[]) => {
  const filtered = times.filter((value) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(value));
  return Array.from(new Set(filtered)).sort((a, b) => a.localeCompare(b));
};

export function ScheduledTaskEditorDialog(props: {
  open: boolean;
  task: ScheduledTask | null;
  onOpenChange: (open: boolean) => void;
  onSave: (draft: Partial<ScheduledTask>) => Promise<void>;
}) {
  const { open, task, onOpenChange, onSave } = props;
  const loadProviders = useConfigStore((state) => state.loadProviders);
  const loadAgents = useConfigStore((state) => state.loadAgents);
  const providers = useConfigStore((state) => state.providers);
  const currentProviderID = useConfigStore((state) => state.currentProviderId);
  const currentModelID = useConfigStore((state) => state.currentModelId);
  const currentVariant = useConfigStore((state) => state.currentVariant || '');
  const currentAgentName = useConfigStore((state) => state.currentAgentName || '');

  const [draft, setDraft] = React.useState<ScheduledTaskDraft>(() =>
    toDraft(task, {
      providerID: currentProviderID,
      modelID: currentModelID,
      variant: currentVariant,
      agent: currentAgentName,
    })
  );
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    void loadProviders();
    void loadAgents();
  }, [open, loadProviders, loadAgents]);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    setDraft(
      toDraft(task, {
        providerID: currentProviderID,
        modelID: currentModelID,
        variant: currentVariant,
        agent: currentAgentName,
      })
    );
  }, [open, task, currentProviderID, currentModelID, currentVariant, currentAgentName]);

  const variantOptions = React.useMemo(() => {
    const provider = providers.find((item) => item.id === draft.execution.providerID);
    const model = provider?.models?.find((item) => item.id === draft.execution.modelID) as { variants?: Record<string, unknown> } | undefined;
    return model?.variants ? Object.keys(model.variants) : [];
  }, [providers, draft.execution.providerID, draft.execution.modelID]);

  const toggleWeekday = React.useCallback((weekday: number, nextChecked: boolean) => {
    setDraft((prev) => {
      const current = new Set(prev.schedule.weekdays);
      if (nextChecked) {
        current.add(weekday);
      } else {
        current.delete(weekday);
      }
      return {
        ...prev,
        schedule: {
          ...prev.schedule,
          weekdays: Array.from(current).sort((a, b) => a - b),
        },
      };
    });
  }, []);

  const updateTimeAt = React.useCallback((index: number, value: string) => {
    setDraft((prev) => {
      const next = prev.schedule.times.slice();
      next[index] = value;
      return {
        ...prev,
        schedule: {
          ...prev.schedule,
          times: next,
        },
      };
    });
  }, []);

  const removeTimeAt = React.useCallback((index: number) => {
    setDraft((prev) => {
      const next = prev.schedule.times.filter((_, idx) => idx !== index);
      return {
        ...prev,
        schedule: {
          ...prev.schedule,
          times: next.length > 0 ? next : ['09:00'],
        },
      };
    });
  }, []);

  const addTime = React.useCallback(() => {
    setDraft((prev) => ({
      ...prev,
      schedule: {
        ...prev.schedule,
        times: [...prev.schedule.times, '12:00'],
      },
    }));
  }, []);

  const handleSubmit = React.useCallback(async () => {
    const validationError = validateDraft(draft);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    const normalizedTimes = dedupeSortTimes(draft.schedule.times);
    const payload: Partial<ScheduledTask> = {
      ...(draft.id ? { id: draft.id } : {}),
      name: draft.name.trim(),
      enabled: draft.enabled,
      schedule: {
        kind: draft.schedule.kind,
        times: normalizedTimes,
        timezone: draft.schedule.timezone.trim(),
        ...(draft.schedule.kind === 'weekly' ? { weekdays: draft.schedule.weekdays } : {}),
      },
      execution: {
        prompt: draft.execution.prompt,
        providerID: draft.execution.providerID,
        modelID: draft.execution.modelID,
        ...(draft.execution.variant.trim() ? { variant: draft.execution.variant.trim() } : {}),
        ...(draft.execution.agent.trim() ? { agent: draft.execution.agent.trim() } : {}),
      },
      ...(draft.state ? { state: draft.state } : {}),
    };

    setSaving(true);
    try {
      await onSave(payload);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save task');
    } finally {
      setSaving(false);
    }
  }, [draft, onOpenChange, onSave]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{task ? 'Edit scheduled task' : 'New scheduled task'}</DialogTitle>
          <DialogDescription>Configure a server-side task that creates a new session and sends a prompt.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="flex flex-col gap-1">
            <span className="typography-meta text-muted-foreground">Task name</span>
            <Input
              value={draft.name}
              onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Daily sync"
              maxLength={80}
            />
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="typography-meta text-muted-foreground">Schedule type</span>
              <Select
                value={draft.schedule.kind}
                onValueChange={(value: 'daily' | 'weekly') => {
                  setDraft((prev) => ({
                    ...prev,
                    schedule: {
                      ...prev.schedule,
                      kind: value,
                    },
                  }));
                }}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="typography-meta text-muted-foreground">Timezone</span>
              <Select
                value={draft.schedule.timezone}
                onValueChange={(timezone) => {
                  setDraft((prev) => ({
                    ...prev,
                    schedule: {
                      ...prev.schedule,
                      timezone,
                    },
                  }));
                }}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIMEZONE_OPTIONS.map((timezone) => (
                    <SelectItem key={timezone} value={timezone}>{timezone}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="typography-meta text-muted-foreground">Times</div>
              <Button type="button" size="sm" variant="outline" onClick={addTime}>
                <RiAddLine className="mr-1 h-4 w-4" /> Add time
              </Button>
            </div>
            <div className="space-y-2">
              {draft.schedule.times.map((time, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    type="time"
                    value={time}
                    onChange={(event) => updateTimeAt(index, event.target.value)}
                    className="w-[170px]"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => removeTimeAt(index)}
                    aria-label="Remove time"
                  >
                    <RiCloseLine className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {draft.schedule.kind === 'weekly' ? (
            <div className="space-y-2">
              <div className="typography-meta text-muted-foreground">Weekdays</div>
              <div className="flex flex-wrap gap-2">
                {WEEKDAY_LABELS.map((weekday) => {
                  const checked = draft.schedule.weekdays.includes(weekday.value);
                  return (
                    <button
                      key={weekday.value}
                      type="button"
                      onClick={() => toggleWeekday(weekday.value, !checked)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 typography-meta hover:bg-interactive-hover"
                    >
                      <Checkbox checked={checked} onChange={(next) => toggleWeekday(weekday.value, next)} ariaLabel={weekday.label} />
                      <span>{weekday.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1">
              <span className="typography-meta text-muted-foreground">Model</span>
              <ModelSelector
                providerId={draft.execution.providerID}
                modelId={draft.execution.modelID}
                onChange={(providerID, modelID) => {
                  setDraft((prev) => ({
                    ...prev,
                    execution: {
                      ...prev.execution,
                      providerID,
                      modelID,
                      variant: '',
                    },
                  }));
                }}
              />
            </label>

            <label className="flex min-w-0 flex-col gap-1">
              <span className="typography-meta text-muted-foreground">Default thinking</span>
              <Select
                value={draft.execution.variant || '__default'}
                onValueChange={(value) => {
                  setDraft((prev) => ({
                    ...prev,
                    execution: {
                      ...prev.execution,
                      variant: value === '__default' ? '' : value,
                    },
                  }));
                }}
              >
                <SelectTrigger className="w-fit min-w-[120px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default">Default</SelectItem>
                  {variantOptions.map((variant) => (
                    <SelectItem key={variant} value={variant}>{variant}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>

          <label className="flex min-w-0 flex-col gap-1">
            <span className="typography-meta text-muted-foreground">Agent</span>
            <AgentSelector
              agentName={draft.execution.agent}
              onChange={(agent) => setDraft((prev) => ({
                ...prev,
                execution: {
                  ...prev.execution,
                  agent,
                },
              }))}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="typography-meta text-muted-foreground">Prompt</span>
            <Textarea
              value={draft.execution.prompt}
              onChange={(event) => setDraft((prev) => ({
                ...prev,
                execution: {
                  ...prev.execution,
                  prompt: event.target.value,
                },
              }))}
              rows={8}
              placeholder="Summarize open tasks and propose next actions"
            />
          </label>

          <label className="inline-flex items-center gap-2">
            <Checkbox
              checked={draft.enabled}
              onChange={(enabled) => setDraft((prev) => ({ ...prev, enabled }))}
              ariaLabel="Enable task"
            />
            <span className="typography-meta">Enabled</span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
