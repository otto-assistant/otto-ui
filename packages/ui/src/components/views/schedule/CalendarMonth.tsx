import React from "react";
import type { ScheduleEvent } from "@/stores/useScheduleStore";
import { ScheduleEventCard } from "./ScheduleEventCard";

interface CalendarMonthProps {
  currentDate: Date;
  events: ScheduleEvent[];
  onNavigate: (delta: number) => void;
}

function getMonthDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);
  return days;
}

function getEventsForDay(events: ScheduleEvent[], year: number, month: number, day: number): ScheduleEvent[] {
  return events.filter((e) => {
    if (e.datetime) {
      const d = new Date(e.datetime);
      return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
    }
    // For recurring, show on matching days (simplified: show on all days for now)
    return false;
  });
}

export const CalendarMonth: React.FC<CalendarMonthProps> = ({ currentDate, events, onNavigate }) => {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const days = getMonthDays(year, month);
  const today = new Date();
  const isToday = (day: number) =>
    today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;

  const monthName = currentDate.toLocaleString("default", { month: "long", year: "numeric" });
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // For recurring events, show dots on relevant days
  const hasEvents = (day: number): boolean => {
    return events.some((e) => {
      if (e.datetime) {
        const d = new Date(e.datetime);
        return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
      }
      if (e.type === "recurring") return true; // simplified: show dot for recurring
      return false;
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button onClick={() => onNavigate(-1)} className="rounded p-1 hover:bg-muted text-muted-foreground">
          ←
        </button>
        <span className="text-sm font-medium text-foreground">{monthName}</span>
        <button onClick={() => onNavigate(1)} className="rounded p-1 hover:bg-muted text-muted-foreground">
          →
        </button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 gap-px">
        {weekdays.map((d) => (
          <div key={d} className="p-2 text-center text-xs font-medium text-muted-foreground">
            {d}
          </div>
        ))}
        {days.map((day, i) => (
          <div
            key={i}
            className={`min-h-[4rem] rounded p-1.5 text-xs ${
              day === null ? "" : "border border-border/50"
            } ${day && isToday(day) ? "bg-primary/10 border-primary/50" : ""}`}
          >
            {day && (
              <>
                <span className={`font-medium ${isToday(day) ? "text-primary" : "text-foreground"}`}>
                  {day}
                </span>
                {hasEvents(day) && (
                  <div className="mt-1 flex gap-0.5 flex-wrap">
                    {getEventsForDay(events, year, month, day).map((e) => (
                      <ScheduleEventCard key={e.id} event={e} compact />
                    ))}
                    {/* dot for recurring */}
                    {events.some((e) => e.type === "recurring" && e.status === "active") && (
                      <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
