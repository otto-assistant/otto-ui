import React from "react";
import { RiBrainLine, RiChat3Line, RiCheckboxCircleLine, RiPulseLine } from "@remixicon/react";

import type { DashboardActivity } from "@/stores/useDashboardStore";

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

function pickIcon(kind: string) {
  switch (kind) {
    case "chat":
      return RiChat3Line;
    case "task":
      return RiCheckboxCircleLine;
    case "memory":
      return RiBrainLine;
    default:
      return RiPulseLine;
  }
}

export interface ActivityTimelineProps {
  items: DashboardActivity[];
}

export const ActivityTimeline: React.FC<ActivityTimelineProps> = ({ items }) => {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-[var(--surface-elevated)] p-4 typography-ui text-muted-foreground">
        No recent activity
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="typography-ui font-semibold text-foreground">Activity</div>
      <div className="divide-y divide-border rounded-lg border border-border bg-[var(--surface-elevated)] overflow-hidden">
        {items.slice(0, 10).map((item) => {
          const Icon = pickIcon(item.kind);
          return (
            <div key={item.id} className="flex gap-3 p-4">
              <div className="mt-0.5 text-muted-foreground">
                <Icon size={18} aria-hidden />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="typography-ui text-foreground">{item.description}</div>
                <div className="typography-micro text-muted-foreground">{formatRelative(item.at)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
