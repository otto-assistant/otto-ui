import React from 'react';
import { useTasksStore } from '@/stores/useTasksStore';
import { TaskCard } from './TaskCard';

export const TaskList: React.FC = () => {
  const tasks = useTasksStore((s) => s.tasks);
  const filter = useTasksStore((s) => s.filter);
  const isLoading = useTasksStore((s) => s.isLoading);

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
    return <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">Loading tasks...</div>;
  }

  if (filtered.length === 0) {
    return <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">No tasks found</div>;
  }

  return (
    <div className="flex flex-col gap-2 overflow-y-auto">
      {filtered.map((task) => (
        <TaskCard key={task.id} task={task} />
      ))}
    </div>
  );
};
