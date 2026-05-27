import React from "react";
import type { Task } from "@/stores/useTasksStore";
import { ScheduleTaskCard } from "./ScheduleEventCard";

interface CalendarWeekProps {
  currentDate: Date;
  tasks: Task[];
  onNavigate: (delta: number) => void;
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

function isOnDate(task: Task, date: Date): boolean {
  if (!task.dueAt) return false;
  const d = new Date(task.dueAt);
  if (d.toDateString() === date.toDateString()) return true;
  if (date.getTime() < d.getTime()) return false;
  switch (task.recurrence) {
    case "daily":
      return true;
    case "weekly":
      return date.getDay() === d.getDay();
    case "monthly":
      return date.getDate() === d.getDate();
    default:
      return false;
  }
}

export const CalendarWeek: React.FC<CalendarWeekProps> = ({ currentDate, tasks, onNavigate }) => {
  const weekDates = getWeekDates(currentDate);
  const today = new Date();

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
          const dayTasks = tasks.filter((t) => isOnDate(t, date));
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
                {dayTasks.map((t) => (
                  <ScheduleTaskCard key={t.id} task={t} compact />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
