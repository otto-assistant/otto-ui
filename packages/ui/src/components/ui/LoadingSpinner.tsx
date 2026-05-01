import React from "react";
import { cn } from "@/lib/utils";

const sizeClasses = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-10 w-10",
} as const;

export type LoadingSpinnerProps = {
  size?: "sm" | "md" | "lg";
  text?: string;
  className?: string;
};

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = "md",
  text,
  className,
}) => (
  <div className={cn("flex flex-col items-center justify-center gap-2 py-12", className)}>
    <svg
      className={cn("animate-spin text-primary", sizeClasses[size])}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
    {text && (
      <span className="text-sm text-muted-foreground">{text}</span>
    )}
  </div>
);
