import React from "react";

/**
 * Parses common cron patterns into human-readable text.
 * No external dependencies.
 */
export function humanizeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return cron;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const formatTime = (h: string, m: string) => {
    const hr = parseInt(h, 10);
    const min = parseInt(m, 10);
    const ampm = hr >= 12 ? "pm" : "am";
    const displayHr = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr;
    return `${displayHr}:${min.toString().padStart(2, "0")}${ampm}`;
  };

  // Every minute
  if (minute === "*" && hour === "*") return "Every minute";

  // Every hour at :MM
  if (hour === "*" && minute !== "*") return `Every hour at :${minute.padStart(2, "0")}`;

  // Daily at HH:MM
  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*" && hour !== "*" && minute !== "*") {
    return `Every day at ${formatTime(hour, minute)}`;
  }

  // Weekdays
  if (dayOfWeek === "1-5" && dayOfMonth === "*" && month === "*" && hour !== "*") {
    return `Weekdays at ${formatTime(hour, minute)}`;
  }

  // Specific day of week
  if (dayOfMonth === "*" && month === "*" && /^\d$/.test(dayOfWeek) && hour !== "*") {
    return `Every ${dayNames[parseInt(dayOfWeek, 10)]} at ${formatTime(hour, minute)}`;
  }

  // Multiple days like 1,3,5
  if (dayOfMonth === "*" && month === "*" && /^[\d,]+$/.test(dayOfWeek) && hour !== "*") {
    const days = dayOfWeek.split(",").map((d) => dayNames[parseInt(d, 10)]).join(", ");
    return `${days} at ${formatTime(hour, minute)}`;
  }

  // Monthly on day X
  if (dayOfWeek === "*" && month === "*" && /^\d+$/.test(dayOfMonth) && hour !== "*") {
    return `Monthly on day ${dayOfMonth} at ${formatTime(hour, minute)}`;
  }

  return cron;
}

interface CronHumanizerProps {
  cron: string;
  className?: string;
}

export const CronHumanizer: React.FC<CronHumanizerProps> = ({ cron, className }) => (
  <span className={className} title={cron}>
    {humanizeCron(cron)}
  </span>
);
