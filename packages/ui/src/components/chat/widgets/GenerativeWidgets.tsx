import React, { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';

// ─── Chart Widget ───────────────────────────────────────────────────────────

interface ChartData {
  title?: string;
  type?: 'bar' | 'line' | 'pie';
  labels: string[];
  datasets: { label: string; data: number[]; color?: string }[];
}

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

export const ChartWidget: React.FC<{ source: string }> = ({ source }) => {
  const data = useMemo<ChartData | null>(() => {
    try { return JSON.parse(source); } catch { return null; }
  }, [source]);

  if (!data || !data.labels?.length) {
    return <div className="text-xs text-destructive p-3">Invalid chart data</div>;
  }

  const maxVal = Math.max(...data.datasets.flatMap(d => d.data), 1);

  return (
    <div className="my-4 rounded-2xl border border-border bg-[var(--surface-elevated)] p-4 space-y-3">
      {data.title && <div className="text-sm font-medium text-foreground">{data.title}</div>}
      <div className="space-y-2">
        {data.labels.map((label, i) => (
          <div key={label} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{label}</span>
              <span className="text-foreground font-mono tabular-nums">
                {data.datasets.map(d => d.data[i] ?? 0).join(' / ')}
              </span>
            </div>
            {data.datasets.map((ds, di) => (
              <div key={ds.label} className="h-5 rounded-full bg-muted overflow-hidden" title={`${ds.label}: ${ds.data[i]}`}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.max(2, ((ds.data[i] ?? 0) / maxVal) * 100)}%`,
                    backgroundColor: ds.color || CHART_COLORS[di % CHART_COLORS.length],
                  }}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
      {data.datasets.length > 1 && (
        <div className="flex gap-3 text-[10px]">
          {data.datasets.map((ds, i) => (
            <span key={ds.label} className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: ds.color || CHART_COLORS[i % CHART_COLORS.length] }} />
              {ds.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Slider Widget ──────────────────────────────────────────────────────────

interface SliderConfig {
  title?: string;
  sliders: { id: string; label: string; min: number; max: number; step?: number; value: number; unit?: string }[];
  formula?: string;
  resultLabel?: string;
}

export const SliderWidget: React.FC<{ source: string }> = ({ source }) => {
  const config = useMemo<SliderConfig | null>(() => {
    try { return JSON.parse(source); } catch { return null; }
  }, [source]);

  const [values, setValues] = useState<Record<string, number>>(() => {
    if (!config) return {};
    return Object.fromEntries(config.sliders.map(s => [s.id, s.value]));
  });

  if (!config || !config.sliders?.length) {
    return <div className="text-xs text-destructive p-3">Invalid slider config</div>;
  }

  const computeResult = (): string => {
    if (!config.formula) return '';
    try {
      let expr = config.formula;
      for (const [key, val] of Object.entries(values)) {
        expr = expr.replace(new RegExp(`\\b${key}\\b`, 'g'), String(val));
      }
      const result = new Function(`return (${expr})`)() as number;
      return typeof result === 'number' ? result.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(result);
    } catch { return 'Error'; }
  };

  return (
    <div className="my-4 rounded-2xl border border-border bg-[var(--surface-elevated)] p-4 space-y-4">
      {config.title && <div className="text-sm font-medium text-foreground">{config.title}</div>}
      {config.sliders.map(s => (
        <div key={s.id} className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{s.label}</span>
            <span className="text-foreground font-mono tabular-nums">
              {(values[s.id] ?? s.value).toLocaleString()}{s.unit ? ` ${s.unit}` : ''}
            </span>
          </div>
          <input
            type="range"
            min={s.min}
            max={s.max}
            step={s.step ?? 1}
            value={values[s.id] ?? s.value}
            onChange={e => setValues(v => ({ ...v, [s.id]: Number(e.target.value) }))}
            className="w-full h-2 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{s.min.toLocaleString()}{s.unit ? ` ${s.unit}` : ''}</span>
            <span>{s.max.toLocaleString()}{s.unit ? ` ${s.unit}` : ''}</span>
          </div>
        </div>
      ))}
      {config.formula && (
        <div className="rounded-lg bg-primary/10 p-3 text-center">
          <div className="text-xs text-muted-foreground">{config.resultLabel ?? 'Result'}</div>
          <div className="text-lg font-bold text-primary tabular-nums">{computeResult()}</div>
        </div>
      )}
    </div>
  );
};

// ─── Interactive JSON/YAML Viewer ───────────────────────────────────────────

export const JsonViewer: React.FC<{ source: string; language: string }> = ({ source, language }) => {
  const [expanded, setExpanded] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const parsed = useMemo(() => {
    try { return JSON.parse(source); } catch { return null; }
  }, [source]);

  if (!parsed) {
    return <pre className="text-xs text-foreground bg-muted p-3 rounded-lg overflow-auto"><code>{source}</code></pre>;
  }

  return (
    <div className="my-4 rounded-2xl border border-border bg-[var(--surface-elevated)] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/50">
        <span className="font-mono text-xs text-muted-foreground">{language}</span>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Filter..."
            className="w-24 rounded border border-border bg-background px-2 py-0.5 text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button onClick={() => setExpanded(!expanded)} className="text-[10px] text-primary hover:text-primary/80">
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>
      <div className="p-3 overflow-auto max-h-96">
        <JsonNode data={parsed} depth={0} expanded={expanded} filter={searchQuery.toLowerCase()} />
      </div>
    </div>
  );
};

const JsonNode: React.FC<{ data: unknown; depth: number; expanded: boolean; filter: string; keyName?: string }> = ({ data, depth, expanded, filter, keyName }) => {
  const [open, setOpen] = useState(expanded);

  React.useEffect(() => { setOpen(expanded); }, [expanded]);

  const indent = depth * 16;
  const keyStr = keyName !== undefined ? `"${keyName}": ` : '';
  const matchesFilter = !filter || JSON.stringify(data).toLowerCase().includes(filter);

  if (!matchesFilter) return null;

  if (data === null) return <div style={{ paddingLeft: indent }} className="text-xs"><span className="text-muted-foreground">{keyStr}</span><span className="text-orange-400">null</span></div>;
  if (typeof data === 'boolean') return <div style={{ paddingLeft: indent }} className="text-xs"><span className="text-muted-foreground">{keyStr}</span><span className="text-blue-400">{String(data)}</span></div>;
  if (typeof data === 'number') return <div style={{ paddingLeft: indent }} className="text-xs"><span className="text-muted-foreground">{keyStr}</span><span className="text-green-400">{data}</span></div>;
  if (typeof data === 'string') return <div style={{ paddingLeft: indent }} className="text-xs"><span className="text-muted-foreground">{keyStr}</span><span className="text-amber-400">"{data.length > 200 ? data.slice(0, 200) + '…' : data}"</span></div>;

  if (Array.isArray(data)) {
    return (
      <div style={{ paddingLeft: indent }}>
        <button onClick={() => setOpen(!open)} className="text-xs text-muted-foreground hover:text-foreground">
          {keyStr}<span className="text-foreground">{open ? '▼' : '▶'}</span> [{data.length}]
        </button>
        {open && data.map((item, i) => <JsonNode key={i} data={item} depth={depth + 1} expanded={expanded} filter={filter} keyName={String(i)} />)}
      </div>
    );
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>);
    return (
      <div style={{ paddingLeft: indent }}>
        <button onClick={() => setOpen(!open)} className="text-xs text-muted-foreground hover:text-foreground">
          {keyStr}<span className="text-foreground">{open ? '▼' : '▶'}</span> {`{${entries.length}}`}
        </button>
        {open && entries.map(([k, v]) => <JsonNode key={k} data={v} depth={depth + 1} expanded={expanded} filter={filter} keyName={k} />)}
      </div>
    );
  }

  return <div style={{ paddingLeft: indent }} className="text-xs text-foreground">{keyStr}{String(data)}</div>;
};

// ─── Dashboard Widget ───────────────────────────────────────────────────────

interface DashboardConfig {
  title?: string;
  metrics: { label: string; value: string | number; change?: string; trend?: 'up' | 'down' | 'flat' }[];
}

export const DashboardWidget: React.FC<{ source: string }> = ({ source }) => {
  const config = useMemo<DashboardConfig | null>(() => {
    try { return JSON.parse(source); } catch { return null; }
  }, [source]);

  if (!config || !config.metrics?.length) return null;

  return (
    <div className="my-4 rounded-2xl border border-border bg-[var(--surface-elevated)] p-4 space-y-3">
      {config.title && <div className="text-sm font-medium text-foreground">{config.title}</div>}
      <div className={cn('grid gap-3', config.metrics.length <= 2 ? 'grid-cols-2' : config.metrics.length <= 4 ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2 md:grid-cols-3')}>
        {config.metrics.map(m => (
          <div key={m.label} className="rounded-lg border border-border/50 bg-background p-3">
            <div className="text-[10px] text-muted-foreground">{m.label}</div>
            <div className="text-lg font-bold text-foreground tabular-nums">{m.value}</div>
            {m.change && (
              <div className={cn('text-[10px] font-medium', m.trend === 'up' ? 'text-green-500' : m.trend === 'down' ? 'text-red-500' : 'text-muted-foreground')}>
                {m.trend === 'up' ? '↑' : m.trend === 'down' ? '↓' : '→'} {m.change}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Table Widget (interactive, sortable) ───────────────────────────────────

interface TableConfig {
  title?: string;
  columns: string[];
  rows: (string | number)[][];
}

export const InteractiveTable: React.FC<{ source: string }> = ({ source }) => {
  const config = useMemo<TableConfig | null>(() => {
    try { return JSON.parse(source); } catch { return null; }
  }, [source]);

  const [sortCol, setSortCol] = useState<number>(-1);
  const [sortAsc, setSortAsc] = useState(true);
  const [filter, setFilter] = useState('');

  if (!config || !config.columns?.length) return null;

  const handleSort = (col: number) => {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  };

  const filtered = (config.rows || [])
    .filter(row => !filter || row.some(cell => String(cell).toLowerCase().includes(filter.toLowerCase())))
    .sort((a, b) => {
      if (sortCol < 0) return 0;
      const av = String(a[sortCol] ?? '');
      const bv = String(b[sortCol] ?? '');
      return sortAsc ? av.localeCompare(bv, undefined, { numeric: true }) : bv.localeCompare(av, undefined, { numeric: true });
    });

  return (
    <div className="my-4 rounded-2xl border border-border bg-[var(--surface-elevated)] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/50">
        <span className="text-xs font-medium text-foreground">{config.title ?? 'Table'}</span>
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter..."
          className="w-28 rounded border border-border bg-background px-2 py-0.5 text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="overflow-auto max-h-80">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted">
            <tr>
              {config.columns.map((col, i) => (
                <th key={col} onClick={() => handleSort(i)} className="cursor-pointer px-3 py-2 text-left text-muted-foreground hover:text-foreground select-none">
                  {col} {sortCol === i ? (sortAsc ? '↑' : '↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, ri) => (
              <tr key={ri} className="border-t border-border/50 hover:bg-muted/30">
                {row.map((cell, ci) => (
                  <td key={ci} className="px-3 py-1.5 text-foreground">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-t border-border bg-muted/30">
        {filtered.length} rows{filter ? ` (filtered from ${config.rows?.length ?? 0})` : ''}
      </div>
    </div>
  );
};

// ─── Progress Widget ────────────────────────────────────────────────────────

interface ProgressConfig {
  title?: string;
  items: { label: string; value: number; max?: number; color?: string }[];
}

export const ProgressWidget: React.FC<{ source: string }> = ({ source }) => {
  const config = useMemo<ProgressConfig | null>(() => {
    try { return JSON.parse(source); } catch { return null; }
  }, [source]);

  if (!config || !config.items?.length) return null;

  return (
    <div className="my-4 rounded-2xl border border-border bg-[var(--surface-elevated)] p-4 space-y-3">
      {config.title && <div className="text-sm font-medium text-foreground">{config.title}</div>}
      {config.items.map(item => {
        const max = item.max ?? 100;
        const pct = Math.min(100, (item.value / max) * 100);
        return (
          <div key={item.label} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">{item.label}</span>
              <span className="text-foreground font-mono tabular-nums">{item.value}/{max} ({pct.toFixed(0)}%)</span>
            </div>
            <div className="h-2.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: item.color ?? '#3b82f6' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};


