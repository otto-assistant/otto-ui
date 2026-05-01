import React from 'react';
import { useTasksStore, type TaskFilter } from '@/stores/useTasksStore';

const TABS: { key: TaskFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'my_tasks', label: 'My Tasks' },
  { key: 'agent', label: 'Agent' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'done', label: 'Done' },
];

export const TaskFilterTabs: React.FC = () => {
  const filter = useTasksStore((s) => s.filter);
  const setFilter = useTasksStore((s) => s.setFilter);
  const tasks = useTasksStore((s) => s.tasks);

  const getCount = (key: TaskFilter): number => {
    switch (key) {
      case 'all': return tasks.length;
      case 'my_tasks': return tasks.filter((t) => t.ownerType === 'user').length;
      case 'agent': return tasks.filter((t) => t.ownerType === 'agent').length;
      case 'scheduled': return tasks.filter((t) => t.ownerType === 'cron').length;
      case 'done': return tasks.filter((t) => t.status === 'done').length;
    }
  };

  return (
    <div className="flex gap-1 overflow-x-auto rounded-lg bg-muted/50 p-1">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => setFilter(tab.key)}
          className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            filter === tab.key
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {tab.label}
          <span className="ml-1.5 text-[10px] opacity-60">{getCount(tab.key)}</span>
        </button>
      ))}
    </div>
  );
};
