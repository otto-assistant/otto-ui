import React from "react";
import { RiErrorWarningLine } from "@remixicon/react";
import { cn } from "@/lib/utils";

export type ErrorStateProps = {
  message: string;
  onRetry?: () => void;
  variant?: "inline" | "full-page";
  className?: string;
};

export const ErrorState: React.FC<ErrorStateProps> = ({
  message,
  onRetry,
  variant = "inline",
  className,
}) => (
  <div
    className={cn(
      "flex flex-col items-center justify-center gap-3 text-center",
      variant === "full-page" ? "h-full min-h-[300px] p-8" : "py-8",
      className,
    )}
  >
    <RiErrorWarningLine className="h-8 w-8 text-destructive" aria-hidden />
    <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
    {onRetry && (
      <button
        onClick={onRetry}
        className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
      >
        Retry
      </button>
    )}
  </div>
);
