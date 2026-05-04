import React from "react";
import { useMemoryStore, type MemoryTab } from "../../../stores/useMemoryStore";
import { GraphView } from "./GraphView";
import { ListView } from "./ListView";
import { DiaryView } from "./DiaryView";
import { SearchView } from "./SearchView";

const TABS: { id: MemoryTab; label: string }[] = [
  { id: "graph", label: "Graph" },
  { id: "list", label: "List" },
  { id: "diary", label: "Diary" },
  { id: "search", label: "Search" },
];

export const MemoryView: React.FC = () => {
  const { activeTab, setActiveTab } = useMemoryStore();

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden bg-background p-6">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold text-foreground" data-testid="view-memory-heading">
          Memory
        </h1>
        <div className="flex gap-1 rounded-lg border border-border bg-muted p-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {activeTab === "graph" && <GraphView />}
        {activeTab === "list" && <ListView />}
        {activeTab === "diary" && <DiaryView />}
        {activeTab === "search" && <SearchView />}
      </div>
    </div>
  );
};
