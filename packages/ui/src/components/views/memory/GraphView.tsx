import React, { useMemo } from "react";
import { useMemoryStore, type Entity } from "../../../stores/useMemoryStore";

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

export const GraphView: React.FC = () => {
  const { entities, relations, selectedEntity, setSelectedEntity } = useMemoryStore();

  // Simple circle layout
  const positions = useMemo(() => {
    const cx = 300;
    const cy = 200;
    const r = 150;
    return entities.map((e, i) => {
      const angle = (2 * Math.PI * i) / entities.length;
      return { id: e.id, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    });
  }, [entities]);

  const getPos = (name: string) => {
    const entity = entities.find((e) => e.name === name);
    if (!entity) return null;
    return positions.find((p) => p.id === entity.id) ?? null;
  };

  return (
    <div className="flex h-full gap-4">
      <div className="flex-1 overflow-hidden rounded-lg border border-border bg-card">
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
