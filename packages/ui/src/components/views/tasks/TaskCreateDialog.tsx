import React, { useState } from 'react';
import { useTasksStore, type TaskPriority, type TaskOwnerType } from '@/stores/useTasksStore';

export const TaskCreateDialog: React.FC = () => {
  const open = useTasksStore((s) => s.createDialogOpen);
  const setOpen = useTasksStore((s) => s.setCreateDialogOpen);
  const createTask = useTasksStore((s) => s.createTask);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dueDate, setDueDate] = useState('');
  const [ownerType, setOwnerType] = useState<TaskOwnerType>('user');
  const [ownerName, setOwnerName] = useState('You');

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    createTask({
      title: title.trim(),
      description,
      priority,
      ownerType,
      ownerName,
      dueDate: dueDate ? new Date(dueDate).toISOString() : null,
    });
    setTitle('');
    setDescription('');
    setPriority('medium');
    setDueDate('');
    setOwnerType('user');
    setOwnerName('You');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setOpen(false)}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl"
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
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="high">High Priority</option>
              <option value="medium">Medium Priority</option>
              <option value="low">Low Priority</option>
            </select>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <select
            value={ownerType}
            onChange={(e) => {
              const v = e.target.value as TaskOwnerType;
              setOwnerType(v);
              setOwnerName(v === 'user' ? 'You' : v === 'agent' ? 'Otto' : 'Cron');
            }}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="user">Assign to: Me</option>
            <option value="agent">Assign to: Agent</option>
            <option value="cron">Assign to: Scheduled</option>
          </select>
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
            Create
          </button>
        </div>
      </form>
    </div>
  );
};
