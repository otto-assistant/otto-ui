import React, { useEffect } from 'react';
import { useTasksStore } from '@/stores/useTasksStore';
import { useUIStore } from '@/stores/useUIStore';
import { TaskFilterTabs } from './TaskFilterTabs';
import { TaskList } from './TaskList';
import { TaskCreateDialog } from './TaskCreateDialog';
import { TaskDetailDrawer } from './TaskDetailDrawer';
import { ScheduleView } from '@/components/views/ScheduleView';
import { cn } from '@/lib/utils';

const HUB_TABS: { id: 'list' | 'schedule'; label: string }[] = [
  { id: 'list', label: 'List' },
  { id: 'schedule', label: 'Schedule' },
];

export const TasksView: React.FC = () => {
  const fetchTasks = useTasksStore((s) => s.fetchTasks);
  const setCreateDialogOpen = useTasksStore((s) => s.setCreateDialogOpen);
  const tasksHubTab = useUIStore((s) => s.tasksHubTab);
  const setTasksHubTab = useUIStore((s) => s.setTasksHubTab);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden bg-background p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-foreground">Tasks</h1>
          <div className="flex gap-1 rounded-lg border border-border bg-muted p-0.5">
            {HUB_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setTasksHubTab(tab.id)}
                className={cn(
                  'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                  tasksHubTab === tab.id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        {tasksHubTab === 'list' && (
          <button
            onClick={() => setCreateDialogOpen(true)}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            + New Task
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tasksHubTab === 'list' ? (
          <div className="flex h-full flex-col gap-4">
            <TaskFilterTabs />
            <div className="min-h-0 flex-1 overflow-hidden">
              <TaskList />
            </div>
          </div>
        ) : (
          <ScheduleView />
        )}
      </div>

      <TaskCreateDialog />
      <TaskDetailDrawer />
    </div>
  );
};
