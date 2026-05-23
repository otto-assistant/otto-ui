import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
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
  const parentRef = useRef<HTMLDivElement>(null);

  const filtered = React.useMemo(() => tasks.filter((t) => {
    switch (filter) {
      case 'all': return true;
      case 'my_tasks': return t.ownerType === 'user';
      case 'agent': return t.ownerType === 'agent';
      case 'scheduled': return t.ownerType === 'cron';
      case 'done': return t.status === 'done';
    }
  }), [tasks, filter]);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 10,
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
    <div ref={parentRef} className="h-full overflow-y-auto">
      <div className="relative" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            className="absolute left-0 right-0 px-0.5"
            style={{ top: `${virtualRow.start}px`, height: `${virtualRow.size}px` }}
          >
            <TaskCard task={filtered[virtualRow.index]} />
          </div>
        ))}
      </div>
    </div>
  );
};
