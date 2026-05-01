import React, { useState } from "react";
import type { ScheduleEventType } from "@/stores/useScheduleStore";

interface CreateScheduleDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (data: {
    title: string;
    prompt: string;
    type: ScheduleEventType;
    datetime?: string;
    cron?: string;
    status: "active";
  }) => void;
}

export const CreateScheduleDialog: React.FC<CreateScheduleDialogProps> = ({ open, onClose, onCreate }) => {
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [type, setType] = useState<ScheduleEventType>("one-time");
  const [datetime, setDatetime] = useState("");
  const [cron, setCron] = useState("");

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate({
      title,
      prompt,
      type,
      ...(type === "one-time" ? { datetime: new Date(datetime).toISOString() } : { cron }),
      status: "active",
    });
    setTitle("");
    setPrompt("");
    setDatetime("");
    setCron("");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-foreground mb-4">Create Schedule</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="text"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <textarea
            placeholder="Prompt / description"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
          />

          {/* Type toggle */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setType("one-time")}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm border ${
                type === "one-time" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
              }`}
            >
              ⏱ One-time
            </button>
            <button
              type="button"
              onClick={() => setType("recurring")}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm border ${
                type === "recurring" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
              }`}
            >
              🔄 Recurring
            </button>
          </div>

          {type === "one-time" ? (
            <input
              type="datetime-local"
              value={datetime}
              onChange={(e) => setDatetime(e.target.value)}
              required
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          ) : (
            <input
              type="text"
              placeholder="Cron expression (e.g. 0 9 * * 1-5)"
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              required
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          )}

          <div className="flex justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
