import React, { useEffect, useState } from "react";
import { useMemoryStore } from "../../../stores/useMemoryStore";

export const DiaryView: React.FC = () => {
  const { diary, fetchDiary, loading } = useMemoryStore();
  const [topicFilter, setTopicFilter] = useState("");

  useEffect(() => {
    fetchDiary();
  }, [fetchDiary]);

  const topics = [...new Set(diary.map((d) => d.topic))];
  const filtered = topicFilter ? diary.filter((d) => d.topic === topicFilter) : diary;

  // Group by date
  const grouped = filtered.reduce<Record<string, typeof diary>>((acc, entry) => {
    (acc[entry.date] ??= []).push(entry);
    return acc;
  }, {});

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2">
        <select
          value={topicFilter}
          onChange={(e) => setTopicFilter(e.target.value)}
          className="rounded-md border border-border bg-input px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">All topics</option>
          {topics.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        {loading && <span className="text-xs text-muted-foreground">Loading...</span>}
      </div>

      <div className="flex-1 space-y-4 overflow-auto">
        {Object.entries(grouped)
          .sort(([a], [b]) => b.localeCompare(a))
          .map(([date, entries]) => (
            <div key={date}>
              <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{date}</h3>
              <div className="space-y-2">
                {entries.map((entry) => (
                  <div key={entry.id} className="rounded-md border border-border bg-card p-3">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{entry.topic}</span>
                      <span className="text-[10px] text-muted-foreground">{entry.agent}</span>
                    </div>
                    <p className="font-mono text-xs text-foreground">{entry.content}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
};
