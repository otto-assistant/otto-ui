import React, { useState, useEffect } from "react";
import { useScheduleStore } from "@/stores/useScheduleStore";
import { CalendarMonth } from "./CalendarMonth";
import { CalendarWeek } from "./CalendarWeek";
import { ScheduleEventCard } from "./ScheduleEventCard";
import { CreateScheduleDialog } from "./CreateScheduleDialog";

export const ScheduleView: React.FC = () => {
  const { events, viewMode, currentDate, setViewMode, setCurrentDate, createEvent, deleteEvent, fetchSchedule } =
    useScheduleStore();
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    fetchSchedule();
  }, [fetchSchedule]);

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
    <div className="flex h-full flex-col gap-4 overflow-auto bg-background p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Schedule</h1>
        <div className="flex items-center gap-2">
          {/* View toggle */}
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
            onClick={() => setDialogOpen(true)}
            className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90"
          >
            + Create
          </button>
        </div>
      </div>

      {/* Calendar - hidden on mobile, show list instead */}
      <div className="hidden md:block">
        {viewMode === "month" ? (
          <CalendarMonth currentDate={currentDate} events={events} onNavigate={navigateMonth} />
        ) : (
          <CalendarWeek currentDate={currentDate} events={events} onNavigate={navigateWeek} onDelete={deleteEvent} />
        )}
      </div>

      {/* Mobile: list view */}
      <div className="md:hidden flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">All scheduled events</p>
        {events.map((e) => (
          <ScheduleEventCard key={e.id} event={e} onDelete={deleteEvent} />
        ))}
        {events.length === 0 && (
          <p className="text-sm text-muted-foreground">No scheduled events yet.</p>
        )}
      </div>

      {/* Upcoming list (desktop sidebar) */}
      <div className="hidden md:flex flex-col gap-2 mt-4">
        <h2 className="text-sm font-medium text-foreground">All Events</h2>
        {events.map((e) => (
          <ScheduleEventCard key={e.id} event={e} onDelete={deleteEvent} />
        ))}
      </div>

      <CreateScheduleDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onCreate={createEvent} />
    </div>
  );
};
