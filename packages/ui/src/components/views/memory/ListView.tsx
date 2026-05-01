import React, { useState } from "react";
import { useMemoryStore } from "../../../stores/useMemoryStore";

type SortKey = "subject" | "predicate" | "object" | "validFrom";

export const ListView: React.FC = () => {
  const { relations, addRelation, deleteRelation } = useMemoryStore();
  const [sortKey, setSortKey] = useState<SortKey>("subject");
  const [sortAsc, setSortAsc] = useState(true);
  const [filter, setFilter] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newRel, setNewRel] = useState({ subject: "", predicate: "", object: "", validFrom: "" });

  const filtered = relations
    .filter((r) => {
      if (!filter) return true;
      const q = filter.toLowerCase();
      return r.subject.toLowerCase().includes(q) || r.predicate.toLowerCase().includes(q) || r.object.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
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

      <div className="flex-1 overflow-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 border-b border-border bg-muted">
            <tr>
              <th className={thClass} onClick={() => handleSort("subject")}>Entity {sortKey === "subject" ? (sortAsc ? "^" : "v") : ""}</th>
              <th className={thClass} onClick={() => handleSort("predicate")}>Predicate {sortKey === "predicate" ? (sortAsc ? "^" : "v") : ""}</th>
              <th className={thClass} onClick={() => handleSort("object")}>Object {sortKey === "object" ? (sortAsc ? "^" : "v") : ""}</th>
              <th className={thClass} onClick={() => handleSort("validFrom")}>Valid From {sortKey === "validFrom" ? (sortAsc ? "^" : "v") : ""}</th>
              <th className="px-3 py-2 text-xs text-muted-foreground">Valid To</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                <td className="px-3 py-2 text-foreground">{r.subject}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.predicate}</td>
                <td className="px-3 py-2 text-foreground">{r.object}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.validFrom ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.validTo ?? "—"}</td>
                <td className="px-3 py-2">
                  <button onClick={() => deleteRelation(r.id)} className="text-xs text-destructive hover:underline">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
