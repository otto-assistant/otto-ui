import React, { useState, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemoryStore } from "../../../stores/useMemoryStore";

type SortKey = "subject" | "predicate" | "object" | "validFrom" | "validTo";

export const ListView: React.FC = () => {
  const { relations, addRelation, deleteRelation } = useMemoryStore();
  const [sortKey, setSortKey] = useState<SortKey>("subject");
  const [sortAsc, setSortAsc] = useState(true);
  const [filter, setFilter] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newRel, setNewRel] = useState({ subject: "", predicate: "", object: "", validFrom: "" });
  const scrollRef = useRef<HTMLDivElement>(null);

  const filtered = React.useMemo(() => relations
    .filter((r) => {
      if (!filter) return true;
      const q = filter.toLowerCase();
      return r.subject.toLowerCase().includes(q) || r.predicate.toLowerCase().includes(q) || r.object.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const av = (a[sortKey] ?? "") as string;
      const bv = (b[sortKey] ?? "") as string;
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    }), [relations, filter, sortKey, sortAsc]);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 20,
  });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  const handleAdd = () => {
    if (newRel.subject && newRel.predicate && newRel.object) {
      addRelation(newRel);
      setNewRel({ subject: "", predicate: "", object: "", validFrom: "" });
      setShowAdd(false);
    }
  };

  const thClass = "cursor-pointer select-none px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground";

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Filter..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-md border border-border bg-input px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          + Add
        </button>
        <span className="text-xs text-muted-foreground">{filtered.length} items</span>
      </div>

      {showAdd && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-card p-2">
          <input placeholder="Subject" value={newRel.subject} onChange={(e) => setNewRel({ ...newRel, subject: e.target.value })} className="w-24 rounded border border-border bg-input px-2 py-1 text-xs text-foreground" />
          <input placeholder="Predicate" value={newRel.predicate} onChange={(e) => setNewRel({ ...newRel, predicate: e.target.value })} className="w-24 rounded border border-border bg-input px-2 py-1 text-xs text-foreground" />
          <input placeholder="Object" value={newRel.object} onChange={(e) => setNewRel({ ...newRel, object: e.target.value })} className="w-24 rounded border border-border bg-input px-2 py-1 text-xs text-foreground" />
          <input type="date" value={newRel.validFrom} onChange={(e) => setNewRel({ ...newRel, validFrom: e.target.value })} className="rounded border border-border bg-input px-2 py-1 text-xs text-foreground" />
          <button onClick={handleAdd} className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground">Save</button>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 border-b border-border bg-muted z-10">
            <tr>
              <th className={thClass} onClick={() => handleSort("subject")}>Entity {sortKey === "subject" ? (sortAsc ? "↑" : "↓") : ""}</th>
              <th className={thClass} onClick={() => handleSort("predicate")}>Predicate {sortKey === "predicate" ? (sortAsc ? "↑" : "↓") : ""}</th>
              <th className={thClass} onClick={() => handleSort("object")}>Object {sortKey === "object" ? (sortAsc ? "↑" : "↓") : ""}</th>
              <th className={thClass} onClick={() => handleSort("validFrom")}>Valid From {sortKey === "validFrom" ? (sortAsc ? "↑" : "↓") : ""}</th>
              <th className={thClass} onClick={() => handleSort("validTo")}>Valid To {sortKey === "validTo" ? (sortAsc ? "↑" : "↓") : ""}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            <tr><td colSpan={6} className="p-0"><div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
              {virtualizer.getVirtualItems().map((vRow) => {
                const r = filtered[vRow.index];
                return (
                  <div key={vRow.key} className="absolute left-0 right-0 flex border-b border-border hover:bg-muted/50" style={{ top: `${vRow.start}px`, height: `${vRow.size}px` }}>
                    <div className="flex-1 px-3 py-2 text-foreground truncate">{r.subject}</div>
                    <div className="flex-1 px-3 py-2 text-muted-foreground truncate">{r.predicate}</div>
                    <div className="flex-1 px-3 py-2 text-foreground truncate">{r.object}</div>
                    <div className="w-24 px-3 py-2 text-muted-foreground">{r.validFrom ?? "—"}</div>
                    <div className="w-24 px-3 py-2 text-muted-foreground">{r.validTo ?? "—"}</div>
                    <div className="w-16 px-3 py-2">
                      <button type="button" onClick={() => deleteRelation(r.id)} className="text-xs text-destructive hover:underline">Del</button>
                    </div>
                  </div>
                );
              })}
            </div></td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};
