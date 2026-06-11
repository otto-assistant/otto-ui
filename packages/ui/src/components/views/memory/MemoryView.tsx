import React, { useEffect, useState } from "react";
import { useMemoryStore, type MemoryTab } from "../../../stores/useMemoryStore";
import { ottoFetch } from "../../../lib/api-base";
import { useI18n, type I18nKey } from "@/lib/i18n";
import { GraphView } from "./GraphView";
import { ListView } from "./ListView";
import { DiaryView } from "./DiaryView";
import { SearchView } from "./SearchView";
import { MemoryFileView } from "./MemoryFileView";
import { RiBrainLine } from "@remixicon/react";

const TABS: { id: MemoryTab; labelKey: I18nKey }[] = [
  { id: "graph", labelKey: "memoryView.tab.graph" },
  { id: "list", labelKey: "memoryView.tab.list" },
  { id: "diary", labelKey: "memoryView.tab.diary" },
  { id: "search", labelKey: "memoryView.tab.search" },
  { id: "file", labelKey: "memoryView.tab.file" },
];

function MempalaceStatus() {
  const [status, setStatus] = useState<{ available: boolean; path?: string; stats?: Record<string, unknown> } | null>(null);

  useEffect(() => {
    ottoFetch("/api/otto/mempalace/status")
      .then(r => r.ok ? r.json() : null)
      .then(d => setStatus(d))
      .catch(() => setStatus({ available: false }));
  }, []);

  if (!status) return null;

  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${status.available ? 'bg-green-500' : 'bg-muted-foreground'}`} />
      <span className="text-muted-foreground">
        MemPalace {status.available ? 'connected' : 'not configured'}
      </span>
    </div>
  );
}

export const MemoryView: React.FC = () => {
  const { t } = useI18n();
  const { activeTab, setActiveTab, entities, relations } = useMemoryStore();

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden bg-background p-6">
      <div className="flex items-center gap-4">
        <RiBrainLine className="size-5 text-foreground" />
        <h1 className="text-lg font-semibold text-foreground" data-testid="view-memory-heading">
          {t('memoryView.heading')}
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
              {t(tab.labelKey)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 ml-auto text-xs text-muted-foreground">
          <span>{t('memoryView.stats.entities', { count: entities.length })}</span>
          <span>{t('memoryView.stats.relations', { count: relations.length })}</span>
          <MempalaceStatus />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {activeTab === "graph" && <GraphView />}
        {activeTab === "list" && <ListView />}
        {activeTab === "diary" && <DiaryView />}
        {activeTab === "search" && <SearchView />}
        {activeTab === "file" && <MemoryFileView />}
      </div>
    </div>
  );
};
