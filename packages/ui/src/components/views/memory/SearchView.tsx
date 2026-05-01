import React, { useEffect, useRef, useState } from "react";
import { useMemoryStore, type SearchResult } from "../../../stores/useMemoryStore";

export const SearchView: React.FC = () => {
  const { searchResults, searchMemory, loading } = useMemoryStore();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSelected(null);
  }, [query]);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      searchMemory(query);
    }, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, searchMemory]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <input
        type="text"
        placeholder="Search memory..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        autoFocus
      />

      {loading && <p className="text-xs text-muted-foreground">Searching...</p>}

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="min-w-0 flex-1 space-y-2 overflow-auto">
          {searchResults.map((result) => {
            const isActive = selected?.id === result.id;
            return (
              <button
                key={result.id}
                type="button"
                onClick={() => setSelected(result)}
                className={`w-full rounded-md border p-3 text-left transition-colors ${
                  isActive ? "border-ring bg-muted/60" : "border-border bg-card hover:bg-muted/40"
                }`}
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                    {Math.round(result.relevance * 100)}%
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {result.wing} / {result.room}
                  </span>
                </div>
                <p className="line-clamp-3 text-xs text-foreground">{result.content}</p>
              </button>
            );
          })}
          {!loading && query && searchResults.length === 0 && (
            <p className="text-xs text-muted-foreground">No results found.</p>
          )}
        </div>

        {selected && (
          <div className="hidden w-72 shrink-0 flex-col rounded-lg border border-border bg-card p-4 md:flex md:overflow-auto">
            <h3 className="mb-2 text-xs font-semibold text-foreground">Details</h3>
            <p className="mb-3 text-[10px] text-muted-foreground">
              Wing <span className="text-foreground">{selected.wing}</span>
              {" · "}
              Room <span className="text-foreground">{selected.room}</span>
            </p>
            <span className="mb-3 inline-flex w-fit rounded bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              Relevance {Math.round(selected.relevance * 100)}%
            </span>
            <p className="text-xs leading-relaxed text-foreground">{selected.content}</p>
          </div>
        )}
      </div>

      {selected && (
        <div className="rounded-lg border border-border bg-card p-3 md:hidden">
          <p className="mb-2 text-[10px] font-medium text-muted-foreground">Details · {selected.wing}/{selected.room}</p>
          <p className="text-xs leading-relaxed text-foreground">{selected.content}</p>
        </div>
      )}
    </div>
  );
};
