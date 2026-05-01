import React from "react";
import { RiInboxLine } from "@remixicon/react";
import { cn } from "@/lib/utils";

export type EmptyStateProps = {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
};

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  className,
}) => (
  <div className={cn("flex flex-col items-center justify-center gap-3 py-12 text-center", className)}>
    <div className="text-muted-foreground/60">
      {icon ?? <RiInboxLine className="h-10 w-10" aria-hidden />}
    </div>
    <h3 className="text-sm font-medium text-foreground">{title}</h3>
    {description && (
      <p className="max-w-xs text-xs text-muted-foreground">{description}</p>
    )}
    {actionLabel && onAction && (
      <button
        onClick={onAction}
        className="mt-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        {actionLabel}
      </button>
    )}
  </div>
);
