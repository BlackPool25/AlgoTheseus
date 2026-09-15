/**
 * components/ContainerVisuals/MultiStructureSyncView.tsx — Side-by-side
 * multi-structure visualisation synchronised to the same trace step.
 *
 * Arranges 2–3 container visuals in a resizable horizontal row,
 * or 4+ in a 2-column grid.  Each sub-visual is dispatched from the
 * same `ContainerKind` used by VariableRow, so all existing container
 * components are reused directly.
 *
 * An optional SVG overlay draws connector lines between related structures
 * (e.g. adjacency-list → visited array → queue in a BFS trace).
 *
 * Connector positions are computed via `getBoundingClientRect` relative
 * to the wrapping container, kept in sync by a ResizeObserver.
 */

import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import type { ContainerKind } from "../../hooks/useContainerType";
import { VISUAL_REGISTRY } from "./registry";
import { ErrorBoundary } from "./ErrorBoundary";
import { StructGraphVisual, type RenderAs } from "./StructGraphVisual";
import { useTraceStore } from "../../store/traceStore";

// ── Public types ─────────────────────────────────────────────────────────────

export interface StructureDef {
  /** Variable name (must be unique — used as a DOM key + query selector). */
  name: string;
  /** Current value from the trace step. */
  value: unknown;
  /** Container kind — same discriminant used by `useContainerType`. */
  kind: ContainerKind;
  /** Optional display label (falls back to `name`). */
  label?: string;
  /** Extra metadata required for `"struct"` rendering. */
  structMeta?: {
    renderAs: RenderAs;
    labelField?: string;
    leftField?: string;
    rightField?: string;
    nextField?: string;
  };
}

export interface ConnectionDef {
  /** `name` of the source structure. */
  source: string;
  /** `name` of the target structure. */
  target: string;
  /** Optional label shown midway along the connector. */
  label?: string;
}

interface MultiStructureSyncViewProps {
  structures: StructureDef[];
  connections?: ConnectionDef[];
  /** Optional name for the entire multi-structure group. */
  name?: string;
}

// ── Internal types ──────────────────────────────────────────────────────────

interface ConnectorLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
}

/** Minimum panel width as a percentage of the container in horizontal layout. */
const MIN_PCT = 15;

// ── Fallback render ─────────────────────────────────────────────────────────

function renderFallback(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return `"${value}"`;
  if (Array.isArray(value)) {
    if (value.length > 8)
      return `[${value.slice(0, 8).join(", ")}, …(${value.length})]`;
    return `[${value.join(", ")}]`;
  }
  return JSON.stringify(value, null, 0);
}

// ── Structure content dispatch ──────────────────────────────────────────────

/** Mutated $ids at the current step (cross-view flash sync source). */
function useMutatedIds(): Set<string> {
  const currentEvent = useTraceStore((s) => s.currentEvent);
  return useMemo(() => {
    if (!currentEvent || currentEvent.type !== "state") return new Set<string>();
    const diff = (currentEvent as unknown as Record<string, unknown>).heap_diff as
      | { mutated?: unknown }
      | null
      | undefined;
    const mutated = Array.isArray(diff?.mutated) ? diff.mutated : [];
    return new Set(mutated.map(String));
  }, [currentEvent]);
}

/** True when the value embeds any of the mutated $ids. */
function embedsMutatedId(value: unknown, mutated: Set<string>): boolean {
  if (mutated.size === 0 || value === null || value === undefined) return false;
  let json: string;
  try {
    json = JSON.stringify(value) ?? "";
  } catch {
    return false;
  }
  for (const id of mutated) {
    if (json.includes(`"$id":${id}`)) return true;
  }
  return false;
}

function renderStructureContent(def: StructureDef): React.ReactNode {
  const { name, value, kind, label, structMeta } = def;
  const displayName = label ?? name;

  // struct needs extra layout metadata from structMeta — handle separately
  if (kind === "struct") {
    return (
      <StructGraphVisual
        value={value as Record<string, unknown> | null}
        renderAs={structMeta?.renderAs ?? "tree"}
        labelField={structMeta?.labelField}
        leftField={structMeta?.leftField}
        rightField={structMeta?.rightField}
        nextField={structMeta?.nextField}
      />
    );
  }

  const Component = VISUAL_REGISTRY[kind];
  if (!Component) {
    return (
      <span className="break-all text-xs font-mono text-viz-ink">
        {renderFallback(value)}
      </span>
    );
  }

  return (
    <ErrorBoundary>
      <Component value={value} name={displayName} />
    </ErrorBoundary>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function MultiStructureSyncView({
  structures,
  connections,
  name,
}: MultiStructureSyncViewProps) {
  /* ── Layout mode ───────────────────────────────────────────────── */
  const count = structures.length;
  const isHorizontal = count >= 2 && count <= 3;
  const isGrid = count >= 4;

  /* ── Panel resizing (horizontal layout only) ───────────────────── */
  const initRatios = useMemo(
    () => structures.map(() => 100 / count),
    [structures, count],
  );
  const [flexRatios, setFlexRatios] = useState<number[]>(initRatios);

  // Keep ratios in sync when the number of structures changes
  useEffect(() => {
    setFlexRatios(initRatios);
  }, [initRatios]);

  const containerRef = useRef<HTMLDivElement>(null);

  const handleResizeStart = useCallback(
    (panelIndex: number) => (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startRatios = [...flexRatios];

      const onMove = (me: MouseEvent) => {
        const el = containerRef.current;
        if (!el) return;
        const containerWidth = el.getBoundingClientRect().width;
        if (containerWidth <= 0) return;

        const dx = me.clientX - startX;
        const deltaPct = (dx / containerWidth) * 100;

        let left = startRatios[panelIndex] + deltaPct;
        let right = startRatios[panelIndex + 1] - deltaPct;

        // Clamp both sides to MIN_PCT
        if (left < MIN_PCT) {
          right -= MIN_PCT - left;
          left = MIN_PCT;
        }
        if (right < MIN_PCT) {
          left -= MIN_PCT - right;
          right = MIN_PCT;
        }

        const newRatios = [...startRatios];
        newRatios[panelIndex] = Math.max(MIN_PCT, left);
        newRatios[panelIndex + 1] = Math.max(MIN_PCT, right);
        setFlexRatios(newRatios);
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [flexRatios],
  );

  /* ── Cross-view $id flash sync (T12) ─────────────────────────────── */
  const mutatedIds = useMutatedIds();
  const flashFor = useCallback(
    (value: unknown) => embedsMutatedId(value, mutatedIds),
    [mutatedIds],
  );

  /* ── Connector lines ──────────────────────────────────────────── */
  const [connectorLines, setConnectorLines] = useState<ConnectorLine[]>([]);

  const computeConnectors = useCallback(() => {
    if (!connections || !containerRef.current) {
      setConnectorLines([]);
      return;
    }

    const containerRect = containerRef.current.getBoundingClientRect();
    const lines: ConnectorLine[] = [];

    for (const conn of connections) {
      const fromEl = containerRef.current.querySelector<HTMLElement>(
        `[data-structure-name="${conn.source}"]`,
      );
      const toEl = containerRef.current.querySelector<HTMLElement>(
        `[data-structure-name="${conn.target}"]`,
      );
      if (!fromEl || !toEl) continue;

      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();

      // Connect from top-center of each panel
      lines.push({
        x1: fromRect.left + fromRect.width / 2 - containerRect.left,
        y1: fromRect.top - containerRect.top,
        x2: toRect.left + toRect.width / 2 - containerRect.left,
        y2: toRect.top - containerRect.top,
        label: conn.label,
      });
    }

    setConnectorLines(lines);
  }, [connections]);

  // Initial computation + ResizeObserver for layout changes
  useEffect(() => {
    computeConnectors();
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(computeConnectors);
    observer.observe(el);
    return () => observer.disconnect();
  }, [computeConnectors]);

  /* ── Empty state ──────────────────────────────────────────────── */
  if (count === 0) {
    return (
      <div className="flex flex-col gap-1 px-3 py-2">
        {name && (
          <span className="text-xs text-viz-ink/60">{name}: multi-structure</span>
        )}
        <span className="text-[10px] text-viz-ink/60 italic">no structures</span>
      </div>
    );
  }

  /* ── Render ───────────────────────────────────────────────────── */
  return (
    <div className="flex flex-col gap-2">
      {/* Header */}
      {name && (
        <div className="flex items-center gap-2 px-1">
          <span className="text-xs text-viz-ink/60">{name}</span>
          <span className="text-[10px] text-viz-ink/60">
            {count} view{count !== 1 ? "s" : ""}
            {isHorizontal ? " · horizontal" : isGrid ? " · grid" : ""}
          </span>
        </div>
      )}

      {/* Panels + SVG overlay */}
      <div ref={containerRef} className="relative">
        {/* Panel layout */}
        {isHorizontal ? (
          <div className="flex flex-row items-stretch gap-0">
            {structures.map((def, i) => (
              <div
                key={def.name}
                className="relative min-w-0"
                style={{ flex: `${flexRatios[i]}%` }}
              >
                {/* Panel body */}
                <div
                  data-structure-name={def.name}
                  data-mutated-flash={flashFor(def.value) ? "true" : "false"}
                  className="border rounded bg-viz-body/30 overflow-hidden mx-px"
                  style={{
                    borderColor: flashFor(def.value)
                      ? "var(--viz-flash)"
                      : "rgba(63, 63, 70, 0.5)",
                  }}
                >
                  <div className="flex items-center justify-between px-2 py-1 border-b border-viz-line bg-viz-body/60">
                    <span className="text-[10px] font-mono text-viz-ink/60 truncate">
                      {def.label ?? def.name}
                    </span>
                    <span className="text-[9px] text-viz-ink/60 uppercase shrink-0 ml-1">
                      {def.kind}
                    </span>
                  </div>
                  <div className="p-2 overflow-auto">
                    {renderStructureContent(def)}
                  </div>
                </div>

                {/* Resize handle */}
                {i < count - 1 && (
                  <div
                    className="absolute inset-y-0 right-0 w-2 cursor-col-resize z-20 flex items-center justify-center"
                    style={{ transform: "translateX(50%)" }}
                    onMouseDown={handleResizeStart(i)}
                  >
                    <div className="w-0.5 h-8 rounded-full bg-viz-line group-hover:bg-amber-500/60 transition-colors duration-150" />
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : isGrid ? (
          <div className="grid grid-cols-2 gap-2">
            {structures.map((def) => (
              <div
                key={def.name}
                data-structure-name={def.name}
                data-mutated-flash={flashFor(def.value) ? "true" : "false"}
                className="border rounded bg-viz-body/30 overflow-hidden"
                style={{
                  borderColor: flashFor(def.value)
                    ? "var(--viz-flash)"
                    : "rgba(63, 63, 70, 0.5)",
                }}
              >
                <div className="flex items-center justify-between px-2 py-1 border-b border-viz-line bg-viz-body/60">
                  <span className="text-[10px] font-mono text-viz-ink/60 truncate">
                    {def.label ?? def.name}
                  </span>
                  <span className="text-[9px] text-viz-ink/60 uppercase shrink-0 ml-1">
                    {def.kind}
                  </span>
                </div>
                <div className="p-2 overflow-auto">
                  {renderStructureContent(def)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Single panel */
          <div
            data-structure-name={structures[0].name}
            data-mutated-flash={flashFor(structures[0].value) ? "true" : "false"}
            className="border rounded bg-viz-body/30 overflow-hidden"
            style={{
              borderColor: flashFor(structures[0].value)
                ? "var(--viz-flash)"
                : "rgba(63, 63, 70, 0.5)",
            }}
          >
            <div className="flex items-center justify-between px-2 py-1 border-b border-viz-line bg-viz-body/60">
              <span className="text-[10px] font-mono text-viz-ink/60">
                {structures[0].label ?? structures[0].name}
              </span>
              <span className="text-[9px] text-viz-ink/60 uppercase">
                {structures[0].kind}
              </span>
            </div>
            <div className="p-2 overflow-auto">
              {renderStructureContent(structures[0])}
            </div>
          </div>
        )}

        {/* SVG connector overlay */}
        {connectorLines.length > 0 && (
          <svg
            className="pointer-events-none absolute inset-0 z-10 w-full h-full overflow-visible"
            aria-hidden="true"
          >
            <defs>
              <marker
                id="multi-conn-arrow"
                markerWidth="6"
                markerHeight="6"
                refX="5"
                refY="3"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L0,6 L6,3 z" fill="var(--viz-alias-edge)" />
              </marker>
            </defs>
            {connectorLines.map((line, i) => (
              <g key={i}>
                <line
                  x1={line.x1}
                  y1={line.y1}
                  x2={line.x2}
                  y2={line.y2}
                  stroke="var(--viz-alias-edge)"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  markerEnd="url(#multi-conn-arrow)"
                  opacity={0.7}
                />
                {line.label && (
                  <text
                    x={(line.x1 + line.x2) / 2}
                    y={(line.y1 + line.y2) / 2 - 6}
                    textAnchor="middle"
                    fontSize={9}
                    fontFamily="monospace"
                    style={{ fill: "var(--viz-alias-edge)" }}
                  >
                    {line.label}
                  </text>
                )}
              </g>
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}
