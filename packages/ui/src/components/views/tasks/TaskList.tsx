import React from 'react';
import { useTasksStore } from '@/stores/useTasksStore';
import { TaskCard } from './TaskCard';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { RiTaskLine } from '@remixicon/react';

export const TaskList: React.FC = () => {
  const tasks = useTasksStore((s) => s.tasks);
  const filter = useTasksStore((s) => s.filter);
  const isLoading = useTasksStore((s) => s.isLoading);
  const error = useTasksStore((s) => s.error);
  const fetchTasks = useTasksStore((s) => s.fetchTasks);

  const filtered = tasks.filter((t) => {
    switch (filter) {
      case 'all': return true;
      case 'my_tasks': return t.ownerType === 'user';
      case 'agent': return t.ownerType === 'agent';
      case 'scheduled': return t.ownerType === 'cron';
      case 'done': return t.status === 'done';
    }
  });

  if (isLoading) {
    return <LoadingSpinner text="Loading tasks…" />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={fetchTasks} />;
  }

  if (filtered.length === 0) {
    return (
      <EmptyState
        icon={<RiTaskLine className="h-10 w-10" />}
        title="No tasks found"
        description="Tasks will appear here when created via the UI, CLI, or Discord."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2 overflow-y-auto">
      {filtered.map((task) => (
        <TaskCard key={task.id} task={task} />
      ))}
    </div>
  );
};
