import React, { useEffect } from 'react';
import { useTasksStore } from '@/stores/useTasksStore';
import { TaskFilterTabs } from './TaskFilterTabs';
import { TaskList } from './TaskList';
import { TaskCreateDialog } from './TaskCreateDialog';
import { TaskDetailDrawer } from './TaskDetailDrawer';

export const TasksView: React.FC = () => {
  const fetchTasks = useTasksStore((s) => s.fetchTasks);
  const setCreateDialogOpen = useTasksStore((s) => s.setCreateDialogOpen);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden bg-background p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Tasks</h1>
        <button
          onClick={() => setCreateDialogOpen(true)}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          + New Task
        </button>
      </div>

      {/* Filter tabs */}
      <TaskFilterTabs />

      {/* Task list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <TaskList />
      </div>

      {/* Modals */}
      <TaskCreateDialog />
      <TaskDetailDrawer />
    </div>
  );
};
