import React from "react";

import type { DashboardRecentSession } from "@/stores/useDashboardStore";

const rtf =
  typeof Intl !== "undefined" ? new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }) : null;

function formatRelative(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return "—";

  const diffSec = Math.round((timestamp - Date.now()) / 1000);
  const absSec = Math.abs(diffSec);

  let unit: Intl.RelativeTimeFormatUnit = "second";
  let value = diffSec;
  if (absSec >= 60 * 60 * 24) {
    unit = "day";
    value = Math.round(diffSec / (60 * 60 * 24));
  } else if (absSec >= 60 * 60) {
    unit = "hour";
    value = Math.round(diffSec / (60 * 60));
  } else if (absSec >= 60) {
    unit = "minute";
    value = Math.round(diffSec / 60);
  }

  if (!rtf) {
    const label =
      unit === "day"
        ? `${Math.abs(value)}d`
        : unit === "hour"
          ? `${Math.abs(value)}h`
          : unit === "minute"
            ? `${Math.abs(value)}m`
            : `${Math.abs(diffSec)}s`;
    return diffSec <= 0 ? `${label} ago` : `in ${label}`;
  }

  return rtf.format(value, unit);
}

export interface RecentSessionsProps {
  sessions: DashboardRecentSession[];
  onSelectSession: (sessionId: string) => void;
}

export const RecentSessions: React.FC<RecentSessionsProps> = ({ sessions, onSelectSession }) => {
  if (sessions.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-[var(--surface-elevated)] p-4 typography-ui text-muted-foreground">
        No sessions yet
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="typography-ui font-semibold text-foreground">Recent sessions</div>
      <div className="divide-y divide-border rounded-lg border border-border bg-[var(--surface-elevated)] overflow-hidden">
        {sessions.slice(0, 5).map((session) => (
          <button
            key={session.id}
            type="button"
            className="w-full px-4 py-3 text-left typography-ui hover:bg-[var(--interactive-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--interactive-focus-ring)] ring-inset focus-visible:z-10 relative"
            onClick={() => onSelectSession(session.id)}
          >
            <div className="truncate text-foreground">{session.title}</div>
            <div className="typography-micro mt-1 text-muted-foreground">{formatRelative(session.at)}</div>
          </button>
        ))}
      </div>
    </div>
  );
};
