import React from "react";
import type { ScheduleEvent } from "@/stores/useScheduleStore";
import { CronHumanizer } from "./CronHumanizer";

const statusColors: Record<string, string> = {
  active: "bg-green-500",
  paused: "bg-yellow-500",
  completed: "bg-blue-500",
  failed: "bg-red-500",
};

interface ScheduleEventCardProps {
  event: ScheduleEvent;
  compact?: boolean;
  onDelete?: (id: string) => void;
}

export const ScheduleEventCard: React.FC<ScheduleEventCardProps> = ({ event, compact, onDelete }) => {
  if (compact) {
    return (
      <div className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs bg-muted/50 hover:bg-muted transition-colors">
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${statusColors[event.status]}`} />
        <span className="truncate text-foreground">{event.title}</span>
      </div>
    );
  }

  return (
    <div className="group flex flex-col gap-1 rounded-lg border border-border bg-card p-3 hover:bg-muted/30 transition-colors">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`h-2 w-2 rounded-full shrink-0 ${statusColors[event.status]}`} />
          {/* Type icon */}
          <span className="text-muted-foreground" title={event.type}>
            {event.type === "recurring" ? "🔄" : "⏱"}
          </span>
          <span className="truncate font-medium text-sm text-foreground">{event.title}</span>
        </div>
        {onDelete && (
          <button
            onClick={() => onDelete(event.id)}
            className="opacity-0 group-hover:opacity-100 text-xs text-muted-foreground hover:text-destructive transition-opacity"
          >
            ✕
          </button>
        )}
      </div>
      <div className="text-xs text-muted-foreground pl-6">
        {event.type === "recurring" && event.cron ? (
          <CronHumanizer cron={event.cron} />
        ) : event.datetime ? (
          <span>{new Date(event.datetime).toLocaleString()}</span>
        ) : null}
      </div>
    </div>
  );
};
