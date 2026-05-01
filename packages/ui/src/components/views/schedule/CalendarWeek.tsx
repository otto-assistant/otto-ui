import React from "react";
import type { ScheduleEvent } from "@/stores/useScheduleStore";
import { ScheduleEventCard } from "./ScheduleEventCard";

interface CalendarWeekProps {
  currentDate: Date;
  events: ScheduleEvent[];
  onNavigate: (delta: number) => void;
  onDelete: (id: string) => void;
}

function getWeekDates(date: Date): Date[] {
  const start = new Date(date);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export const CalendarWeek: React.FC<CalendarWeekProps> = ({ currentDate, events, onNavigate, onDelete }) => {
  const weekDates = getWeekDates(currentDate);
  const today = new Date();

  const getEventsForDate = (date: Date): ScheduleEvent[] => {
    return events.filter((e) => {
      if (e.datetime) {
        const d = new Date(e.datetime);
        return d.toDateString() === date.toDateString();
      }
      // Show recurring events on all days (simplified)
      if (e.type === "recurring") return true;
      return false;
    });
  };

  const weekLabel = `${weekDates[0].toLocaleDateString("default", { month: "short", day: "numeric" })} – ${weekDates[6].toLocaleDateString("default", { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <button onClick={() => onNavigate(-7)} className="rounded p-1 hover:bg-muted text-muted-foreground">
          ←
        </button>
        <span className="text-sm font-medium text-foreground">{weekLabel}</span>
        <button onClick={() => onNavigate(7)} className="rounded p-1 hover:bg-muted text-muted-foreground">
          →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-2 max-md:grid-cols-1">
        {weekDates.map((date) => {
          const isToday = date.toDateString() === today.toDateString();
          const dayEvents = getEventsForDate(date);
          return (
            <div
              key={date.toISOString()}
              className={`flex flex-col gap-1.5 rounded-lg border p-2 min-h-[8rem] ${
                isToday ? "border-primary/50 bg-primary/5" : "border-border"
              }`}
            >
              <div className="text-xs font-medium text-muted-foreground">
                <span className={isToday ? "text-primary" : ""}>
                  {date.toLocaleDateString("default", { weekday: "short", day: "numeric" })}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {dayEvents.map((e) => (
                  <ScheduleEventCard key={e.id} event={e} compact onDelete={onDelete} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
