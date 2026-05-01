import React, { useEffect, useRef, useState } from "react";
import { useMemoryStore } from "../../../stores/useMemoryStore";

export const SearchView: React.FC = () => {
  const { searchResults, searchMemory, loading } = useMemoryStore();
  const [query, setQuery] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      searchMemory(query);
    }, 300);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query, searchMemory]);

  return (
    <div className="flex h-full flex-col gap-3">
      <input
        type="text"
        placeholder="Search memory..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        autoFocus
      />

      {loading && <p className="text-xs text-muted-foreground">Searching...</p>}

      <div className="flex-1 space-y-2 overflow-auto">
        {searchResults.map((result) => (
          <div key={result.id} className="rounded-md border border-border bg-card p-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                {Math.round(result.relevance * 100)}%
              </span>
              <span className="text-[10px] text-muted-foreground">{result.wing} / {result.room}</span>
            </div>
            <p className="text-xs text-foreground">{result.content}</p>
          </div>
        ))}
        {!loading && query && searchResults.length === 0 && (
          <p className="text-xs text-muted-foreground">No results found.</p>
        )}
      </div>
    </div>
  );
};
