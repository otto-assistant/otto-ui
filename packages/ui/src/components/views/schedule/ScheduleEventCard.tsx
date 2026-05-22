import React, { useState } from "react";
import type { ScheduleEvent } from "@/stores/useScheduleStore";
import { CronHumanizer } from "./CronHumanizer";
import { useUIStore } from "@/stores/useUIStore";
import { useSessionUIStore } from "@/sync/session-ui-store";

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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const openNewSessionDraft = useSessionUIStore((s) => s.openNewSessionDraft);

  if (compact) {
    return (
      <div className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs bg-muted/50 hover:bg-muted transition-colors">
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${statusColors[event.status]}`} />
        <span className="truncate text-foreground">{event.title}</span>
      </div>
    );
  }

  const handleDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    onDelete?.(event.id);
  };

  const handleRunNow = () => {
    setActiveView('chat');
    openNewSessionDraft({
      title: `Scheduled: ${event.title}`,
      initialPrompt: event.prompt,
    });
  };

  return (
    <div className="group flex flex-col gap-1 rounded-lg border border-border bg-card p-3 hover:bg-muted/30 transition-colors">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`h-2 w-2 rounded-full shrink-0 ${statusColors[event.status]}`} />
          <span className="text-muted-foreground" title={event.type}>
            {event.type === "recurring" ? "🔄" : "⏱"}
          </span>
          <span className="truncate font-medium text-sm text-foreground">{event.title}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleRunNow}
            className="rounded px-1.5 py-0.5 text-[10px] font-medium text-primary bg-primary/10 hover:bg-primary/20"
          >
            Run now
          </button>
          {onDelete && (
            <button
              onClick={handleDelete}
              className={`text-xs ${confirmDelete ? 'text-destructive font-medium' : 'text-muted-foreground hover:text-destructive'}`}
            >
              {confirmDelete ? 'Confirm?' : '✕'}
            </button>
          )}
        </div>
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
