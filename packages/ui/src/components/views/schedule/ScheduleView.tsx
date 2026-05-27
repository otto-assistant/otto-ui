import React, { useEffect, useMemo } from "react";
import { useTasksStore, type Task } from "@/stores/useTasksStore";
import { CalendarMonth } from "./CalendarMonth";
import { CalendarWeek } from "./CalendarWeek";
import { ScheduleTaskCard } from "./ScheduleEventCard";

type ViewMode = "month" | "week";

const VIEW_KEY = "otto.scheduleView.mode";

export const ScheduleView: React.FC = () => {
  const tasks = useTasksStore((s) => s.tasks);
  const fetchTasks = useTasksStore((s) => s.fetchTasks);
  const setCreateDialogOpen = useTasksStore((s) => s.setCreateDialogOpen);

  const [viewMode, setViewMode] = React.useState<ViewMode>(() => {
    if (typeof window === "undefined") return "month";
    const stored = window.localStorage.getItem(VIEW_KEY);
    return stored === "week" ? "week" : "month";
  });
  const [currentDate, setCurrentDate] = React.useState<Date>(new Date());

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(VIEW_KEY, viewMode);
  }, [viewMode]);

  // Only show tasks that have a due date — these are the entities that
  // appear on the calendar. Tasks without dueAt remain in the list view.
  const scheduledTasks = useMemo(() => tasks.filter((t) => !!t.dueAt), [tasks]);

  const navigateMonth = (delta: number) => {
    const d = new Date(currentDate);
    d.setMonth(d.getMonth() + delta);
    setCurrentDate(d);
  };

  const navigateWeek = (deltaDays: number) => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + deltaDays);
    setCurrentDate(d);
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      {/* Toolbar — heading is provided by the parent Tasks hub */}
      <div className="flex items-center justify-end">
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              onClick={() => setViewMode("month")}
              className={`px-3 py-1 text-xs ${viewMode === "month" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
            >
              Month
            </button>
            <button
              onClick={() => setViewMode("week")}
              className={`px-3 py-1 text-xs ${viewMode === "week" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
            >
              Week
            </button>
          </div>
          <button
            onClick={() => setCreateDialogOpen(true)}
            className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90"
          >
            + Create
          </button>
        </div>
      </div>

      {/* Calendar - hidden on mobile, show list instead */}
      <div className="hidden md:block">
        {viewMode === "month" ? (
          <CalendarMonth currentDate={currentDate} tasks={scheduledTasks} onNavigate={navigateMonth} />
        ) : (
          <CalendarWeek currentDate={currentDate} tasks={scheduledTasks} onNavigate={navigateWeek} />
        )}
      </div>

      {/* Mobile: list view */}
      <div className="md:hidden flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">All scheduled tasks</p>
        {scheduledTasks.map((t: Task) => (
          <ScheduleTaskCard key={t.id} task={t} />
        ))}
        {scheduledTasks.length === 0 && (
          <p className="text-sm text-muted-foreground">No scheduled tasks yet.</p>
        )}
      </div>

      {/* Upcoming list (desktop) */}
      <div className="hidden md:flex flex-col gap-2 mt-4">
        <h2 className="text-sm font-medium text-foreground">All Scheduled Tasks</h2>
        {scheduledTasks.map((t: Task) => (
          <ScheduleTaskCard key={t.id} task={t} />
        ))}
        {scheduledTasks.length === 0 && (
          <p className="text-sm text-muted-foreground">No scheduled tasks yet.</p>
        )}
      </div>
    </div>
  );
};
