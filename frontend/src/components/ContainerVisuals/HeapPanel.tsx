import { useMemo, useState } from "react";

export interface HeapEntry {
  type?: string;
  fields?: Record<string, unknown>;
  refs?: Record<string, unknown>;
  addr?: string | null;
}

export interface HeapDiffShape {
  added: string[];
  removed: string[];
  mutated: string[];
  changed_fields: Record<string, string[]>;
}

interface Props {
  heap: Record<string, unknown> | null | undefined;
  heapDiff?: HeapDiffShape | null;
  vars?: Record<string, unknown>;
}

function asEntry(raw: unknown): HeapEntry {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as HeapEntry;
}

function strTargets(v: unknown): string[] {
  if (typeof v === "string" && v !== "unknown") return [v];
  if (Array.isArray(v)) {
    const out: string[] = [];
    for (const item of v) {
      if (typeof item === "string" && item !== "unknown") out.push(item);
    }
    return out;
  }
  return [];
}

function numericIdSort(ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isInteger(na) && Number.isInteger(nb)) return na - nb;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function fmtScalar(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

export function HeapPanel({ heap, heapDiff, vars }: Props) {
  const [open, setOpen] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const ids = useMemo(() => {
    if (!heap || typeof heap !== "object" || Array.isArray(heap)) return [];
    return numericIdSort(Object.keys(heap));
  }, [heap]);

  const entries = useMemo(() => {
    const m = new Map<string, HeapEntry>();
    for (const id of ids) m.set(id, asEntry((heap as Record<string, unknown>)[id]));
    return m;
  }, [heap, ids]);

  const mutatedSet = useMemo(
    () => new Set(Array.isArray(heapDiff?.mutated) ? heapDiff.mutated : []),
    [heapDiff],
  );

  const changedFields = useMemo(() => {
    const raw = heapDiff?.changed_fields;
    if (!raw || typeof raw !== "object") return new Map<string, Set<string>>();
    const m = new Map<string, Set<string>>();
    for (const [id, names] of Object.entries(raw)) {
      if (Array.isArray(names)) m.set(id, new Set(names.map(String)));
    }
    return m;
  }, [heapDiff]);

  const inbound = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const id of ids) m.set(id, []);
    const push = (target: string, source: string) => {
      const list = m.get(target);
      if (list) list.push(source);
    };
    for (const id of ids) {
      const refs = entries.get(id)?.refs;
      if (!refs || typeof refs !== "object") continue;
      for (const [field, target] of Object.entries(refs)) {
        for (const t of strTargets(target)) push(t, `${id}.${field}`);
      }
    }
    if (vars && typeof vars === "object") {
      for (const [name, value] of Object.entries(vars)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const obj = value as Record<string, unknown>;
        const id = obj.$id;
        if (typeof id === "number" && !Number.isNaN(id) && m.has(String(id))) {
          push(String(id), name);
          continue;
        }
        const ref = obj.$ref;
        if (typeof ref === "number" && m.has(String(ref))) push(String(ref), name);
      }
    }
    return m;
  }, [entries, ids, vars]);

  const isCycle = (id: string): boolean => {
    const refs = entries.get(id)?.refs;
    if (!refs || typeof refs !== "object") return false;
    return Object.values(refs).some((t) => strTargets(t).includes(id));
  };

  if (ids.length === 0) return null;

  return (
    <div data-testid="heap-panel" className="flex flex-col gap-1 px-3 py-1.5 border-b border-zinc-800/50">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        <span className="font-mono">{open ? "▾" : "▸"}</span>
        <span className="font-medium uppercase tracking-wide">Heap</span>
        <span className="font-mono text-zinc-600">({ids.length})</span>
        {mutatedSet.size > 0 && (
          <span className="font-mono text-[10px]" style={{ color: "var(--viz-flash, #f59e0b)" }}>
            · {mutatedSet.size} changed
          </span>
        )}
      </button>

      {open && (
        <div className="flex flex-col gap-1.5 py-1">
          {ids.map((id) => {
            const entry = entries.get(id) ?? {};
            const flashed = mutatedSet.has(id);
            const changed = changedFields.get(id);
            const sources = inbound.get(id) ?? [];
            const cycle = isCycle(id);
            const highlighted = hoveredId !== null && (hoveredId === id || (inbound.get(hoveredId) ?? []).includes(id) || strTargetsOf(entries.get(hoveredId)?.refs).includes(id));
            const fieldRows = entry.fields && typeof entry.fields === "object"
              ? Object.entries(entry.fields)
              : [];
            const refRows = entry.refs && typeof entry.refs === "object"
              ? Object.entries(entry.refs)
              : [];
            return (
              <div key={id}>
                <div
                  data-testid="heap-node"
                  data-heap-id={id}
                  data-flash={flashed ? "true" : "false"}
                  onMouseEnter={() => setHoveredId(id)}
                  onMouseLeave={() => setHoveredId((cur) => (cur === id ? null : cur))}
                  className="rounded border px-2 py-1 font-mono text-[11px]"
                  style={{
                    borderColor: flashed ? "var(--viz-flash, #f59e0b)" : highlighted ? "var(--viz-alias-edge, #a1a1aa)" : "#3f3f46",
                    backgroundColor: flashed ? "rgba(245, 158, 11, 0.12)" : "#27272a",
                    boxShadow: flashed ? "0 0 6px rgba(245, 158, 11, 0.4)" : undefined,
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-zinc-500">#{id}</span>
                    {typeof entry.type === "string" && (
                      <span className="text-zinc-400">{entry.type}</span>
                    )}
                    {typeof entry.addr === "string" && (
                      <span className="text-zinc-600 text-[10px]">{entry.addr}</span>
                    )}
                    {cycle && (
                      <span className="text-[10px] px-1 rounded bg-red-500/20 text-red-400">$cycle</span>
                    )}
                    {sources.length >= 2 && (
                      <span className="text-[10px] text-zinc-500">×{sources.length} refs</span>
                    )}
                  </div>
                  {fieldRows.map(([k, v]) => (
                    <div
                      key={k}
                      data-changed-field={changed?.has(k) ? "true" : "false"}
                      className="flex gap-1"
                      style={changed?.has(k) ? { color: "var(--viz-flash, #f59e0b)" } : undefined}
                    >
                      <span className="text-zinc-500">{k}</span>
                      <span className="text-zinc-200">= {fmtScalar(v)}</span>
                    </div>
                  ))}
                  {refRows.map(([k, v]) => {
                    const targets = strTargets(v);
                    const inboundHit = hoveredId !== null && targets.includes(hoveredId);
                    return (
                      <div
                        key={k}
                        data-alias-highlight={inboundHit ? "true" : "false"}
                        className="flex gap-1"
                        style={inboundHit ? { color: "var(--viz-alias-edge, #a1a1aa)" } : undefined}
                      >
                        <span className="text-zinc-500">{k}</span>
                        <span className="text-zinc-200">→ {targets.length > 0 ? targets.map((t) => `#${t}`).join(", ") : "unknown"}</span>
                      </div>
                    );
                  })}
                </div>
                {sources.length >= 2 && (
                  <div
                    data-testid="alias-edge"
                    data-alias-target={id}
                    data-alias-highlight={hoveredId === id ? "true" : "false"}
                    className="font-mono text-[10px] px-2 py-0.5"
                    style={{
                      color: "var(--viz-alias-edge, #a1a1aa)",
                      fontWeight: hoveredId === id ? 700 : 400,
                    }}
                  >
                    ⤷ {sources.join(" · ")} → #{id}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function strTargetsOf(refs: Record<string, unknown> | undefined): string[] {
  if (!refs || typeof refs !== "object") return [];
  const out: string[] = [];
  for (const v of Object.values(refs)) out.push(...strTargets(v));
  return out;
}
