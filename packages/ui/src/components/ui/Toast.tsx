import React from "react";
import {
  RiCheckLine,
  RiErrorWarningLine,
  RiInformationLine,
  RiAlertLine,
  RiCloseLine,
} from "@remixicon/react";
import { useToastStore, type ToastVariant } from "@/stores/useToastStore";
import { cn } from "@/lib/utils";

const variantStyles: Record<ToastVariant, string> = {
  success: "border-[color:var(--status-success-border)] bg-[color:var(--status-success-background)] text-[color:var(--status-success-foreground)]",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  info: "border-border bg-card text-foreground",
  warning: "border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
};

const variantIcons: Record<ToastVariant, React.ReactNode> = {
  success: <RiCheckLine size={16} aria-hidden />,
  error: <RiErrorWarningLine size={16} aria-hidden />,
  info: <RiInformationLine size={16} aria-hidden />,
  warning: <RiAlertLine size={16} aria-hidden />,
};

export const ToastContainer: React.FC = () => {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto flex items-center gap-2 rounded-lg border px-3 py-2 shadow-lg text-xs animate-in slide-in-from-right-5 fade-in duration-200",
            variantStyles[t.variant],
          )}
        >
          {variantIcons[t.variant]}
          <span className="flex-1">{t.message}</span>
          <button
            onClick={() => dismiss(t.id)}
            className="ml-1 opacity-60 hover:opacity-100 transition-opacity"
            aria-label="Dismiss"
          >
            <RiCloseLine size={14} />
          </button>
        </div>
      ))}
    </div>
  );
};
