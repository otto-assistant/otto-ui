import React, { useEffect, useMemo } from "react";
import { useMemoryStore } from "../../../stores/useMemoryStore";

const TYPE_COLORS: Record<string, string> = {
  agent: "hsl(var(--chart-1))",
  person: "hsl(var(--chart-2))",
  project: "hsl(var(--chart-3))",
  concept: "hsl(var(--chart-4))",
  place: "hsl(var(--chart-5))",
};

function getColor(type: string) {
  return TYPE_COLORS[type] ?? "hsl(var(--muted-foreground))";
}

function jitterFromId(id: string, axis: 0 | 1) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  const t = axis === 0 ? h : Math.imul(17, h);
  return ((t % 1000) / 1000) * 40 - 20;
}

/** Lightweight deterministic force-directed layout (no external graph libs). */
function computeForceLayout(
  entities: { id: string; name: string }[],
  relations: { subject: string; object: string }[],
  width: number,
  height: number,
): { id: string; x: number; y: number }[] {
  const n = entities.length;
  if (n === 0) return [];
  const cx = width / 2;
  const cy = height / 2;
  const pos = entities.map((e, i) => ({
    id: e.id,
    x: cx + jitterFromId(e.id, 0) + Math.cos((2 * Math.PI * i) / n) * 90,
    y: cy + jitterFromId(e.id, 1) + Math.sin((2 * Math.PI * i) / n) * 90,
    vx: 0,
    vy: 0,
  }));
  const nameToIndex = new Map(entities.map((e, i) => [e.name, i]));
  const iterations = 90;
  for (let iter = 0; iter < iterations; iter++) {
    const repStrength = 3200;
    const attStrength = 0.014;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const pi = pos[i];
        const pj = pos[j];
        let dx = pi.x - pj.x;
        let dy = pi.y - pj.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const force = repStrength / (dist * dist);
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        pi.vx += dx;
        pi.vy += dy;
        pj.vx -= dx;
        pj.vy -= dy;
      }
    }
    for (const rel of relations) {
      const i = nameToIndex.get(rel.subject);
      const j = nameToIndex.get(rel.object);
      if (i === undefined || j === undefined) continue;
      const pi = pos[i];
      const pj = pos[j];
      let dx = pj.x - pi.x;
      let dy = pj.y - pi.y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const force = attStrength * dist;
      dx = (dx / dist) * force;
      dy = (dy / dist) * force;
      pi.vx += dx;
      pi.vy += dy;
      pj.vx -= dx;
      pj.vy -= dy;
    }
    for (const p of pos) {
      p.vx += (cx - p.x) * 0.0012;
      p.vy += (cy - p.y) * 0.0012;
    }
    for (const p of pos) {
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.82;
      p.vy *= 0.82;
      p.x = Math.max(28, Math.min(width - 28, p.x));
      p.y = Math.max(28, Math.min(height - 28, p.y));
    }
  }
  return pos.map(({ id, x, y }) => ({ id, x, y }));
}

export const GraphView: React.FC = () => {
  const { entities, relations, selectedEntity, setSelectedEntity, fetchGraph, loading } = useMemoryStore();

  useEffect(() => {
    void fetchGraph();
  }, [fetchGraph]);

  const positions = useMemo(
    () => computeForceLayout(entities, relations, 600, 400),
    [entities, relations],
  );

  const getPos = (name: string) => {
    const entity = entities.find((e) => e.name === name);
    if (!entity) return null;
    return positions.find((p) => p.id === entity.id) ?? null;
  };

  return (
    <div className="flex h-full gap-4">
      <div className="relative flex-1 overflow-hidden rounded-lg border border-border bg-card">
        {loading && (
          <div className="absolute right-3 top-3 z-10 rounded-md border border-border bg-background/90 px-2 py-1 text-[10px] text-muted-foreground">
            Loading graph…
          </div>
        )}
        <svg viewBox="0 0 600 400" className="h-full w-full">
          {/* Edges */}
          {relations.map((rel) => {
            const from = getPos(rel.subject);
            const to = getPos(rel.object);
            if (!from || !to) return null;
            return (
              <g key={rel.id}>
                <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="hsl(var(--border))" strokeWidth={1.5} />
                <text
                  x={(from.x + to.x) / 2}
                  y={(from.y + to.y) / 2 - 6}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[8px]"
                >
                  {rel.predicate}
                </text>
              </g>
            );
          })}
          {/* Nodes */}
          {entities.map((entity) => {
            const pos = positions.find((p) => p.id === entity.id);
            if (!pos) return null;
            const isSelected = selectedEntity?.id === entity.id;
            return (
              <g
                key={entity.id}
                onClick={() => setSelectedEntity(isSelected ? null : entity)}
                className="cursor-pointer"
              >
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={isSelected ? 22 : 18}
                  fill={getColor(entity.type)}
                  opacity={0.85}
                  stroke={isSelected ? "hsl(var(--ring))" : "none"}
                  strokeWidth={2}
                />
                <text
                  x={pos.x}
                  y={pos.y + 30}
                  textAnchor="middle"
                  className="fill-foreground text-[10px] font-medium"
                >
                  {entity.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Details panel */}
      {selectedEntity && (
        <div className="w-64 overflow-auto rounded-lg border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-semibold text-foreground">{selectedEntity.name}</h3>
          <p className="mb-3 text-xs text-muted-foreground">Type: {selectedEntity.type}</p>
          <h4 className="mb-1 text-xs font-medium text-foreground">Relations</h4>
          <ul className="space-y-1">
            {relations
              .filter((r) => r.subject === selectedEntity.name || r.object === selectedEntity.name)
              .map((r) => (
                <li key={r.id} className="text-xs text-muted-foreground">
                  {r.subject} <span className="text-foreground">{r.predicate}</span> {r.object}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
};
