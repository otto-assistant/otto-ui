import React from "react";
import type { Task } from "@/stores/useTasksStore";
import { ScheduleTaskCard } from "./ScheduleEventCard";

interface CalendarMonthProps {
  currentDate: Date;
  tasks: Task[];
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

function isOnDay(task: Task, year: number, month: number, day: number): boolean {
  if (!task.dueAt) return false;
  const d = new Date(task.dueAt);
  if (d.getFullYear() === year && d.getMonth() === month && d.getDate() === day) return true;
  // Project recurrence forward from the initial dueAt.
  const target = new Date(year, month, day);
  if (target.getTime() < d.getTime()) return false;
  switch (task.recurrence) {
    case "daily":
      return true; // every day after dueAt
    case "weekly":
      return target.getDay() === d.getDay();
    case "monthly":
      return target.getDate() === d.getDate();
    default:
      return false;
  }
}

function getTasksForDay(tasks: Task[], year: number, month: number, day: number): Task[] {
  return tasks.filter((t) => isOnDay(t, year, month, day));
}

export const CalendarMonth: React.FC<CalendarMonthProps> = ({ currentDate, tasks, onNavigate }) => {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const days = getMonthDays(year, month);
  const today = new Date();
  const isToday = (day: number) =>
    today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;

  const monthName = currentDate.toLocaleString("default", { month: "long", year: "numeric" });
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
        {days.map((day, i) => {
          const dayTasks = day ? getTasksForDay(tasks, year, month, day) : [];
          return (
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
                  {dayTasks.length > 0 && (
                    <div className="mt-1 flex flex-col gap-0.5">
                      {dayTasks.slice(0, 3).map((t) => (
                        <ScheduleTaskCard key={t.id} task={t} compact />
                      ))}
                      {dayTasks.length > 3 && (
                        <span className="text-[10px] text-muted-foreground">
                          +{dayTasks.length - 3} more
                        </span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
