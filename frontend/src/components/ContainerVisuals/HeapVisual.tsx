/**
 * components/ContainerVisuals/HeapVisual.tsx — Binary heap as an SVG tree.
 *
 * Renders a priority_queue as a complete binary tree (not just a list).
 * Detects push/pop operations by comparing consecutive snapshots and
 * animates bubble-up / bubble-down with CSS transitions.
 *
 * Heap type (min/max) is auto-detected from the comparator result.
 *
 * Data shape: { top: T, items: T[] } where items[0] is the root.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { renderCellValue } from "../../utils/format";
import { flashStyle } from "./flash";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum nodes to render in the SVG tree. Beyond this, show a collapsed view. */
const MAX_NODES = 63;

/** Horizontal gap between sibling nodes at the leaf level (for layout calc). */
const LEAF_GAP = 8;

/** Vertical gap between tree levels in px. */
const V_GAP = 56;

/** Node box width in px. */
const NODE_W = 40;

/** Node box height in px. */
const NODE_H = 28;

/** Padding around the SVG content. */
const PAD = 24;

/** Duration of a single swap animation step in ms. */
const SWAP_MS = 350;

/** Duration of the "appear" / "removed" initial phase in ms. */
const PHASE_MS = 300;

// ── Types ─────────────────────────────────────────────────────────────────────

type HeapType = "min" | "max";

type AnimPhase =
  | "idle"
  | "push-appear" // new node fades in at bottom
  | "push-bubble" // bubble-up swaps in progress
  | "pop-mark"    // top marked for removal
  | "pop-sink";   // bubble-down swaps in progress

/** Timeout choreography derived during render; the effect only schedules it. */
type AnimPlan =
  | { kind: "none" }
  | { kind: "push"; prev: unknown[]; curr: unknown[] }
  | { kind: "pop"; prev: unknown[]; curr: unknown[] }
  | { kind: "reorder"; curr: unknown[]; swaps: [number, number][] };

interface HeapData {
  top: unknown;
  items: unknown[];
}

interface Props {
  value: unknown;
  /** Indices that mutated this step (sift-swap pair) — flash both together. */
  changedIndices?: number[];
}

/** Parse the heap envelope at the boundary; non-heap values render fallback. */
function asHeapData(value: unknown): HeapData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.items)) return null;
  return { top: record.top, items: record.items };
}

interface NodePos {
  index: number;
  x: number;
  y: number;
  label: string;
}

interface Edge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

// ── Heap helpers ──────────────────────────────────────────────────────────────

function getLeftChild(i: number): number {
  return (i << 1) | 1;
}

function getRightChild(i: number): number {
  return (i << 1) + 2;
}

function getLevel(i: number): number {
  return 31 - Math.clz32(i + 1);
}

/** Auto-detect min-heap or max-heap by sampling the root and its first child. */
function detectHeapType(items: unknown[]): HeapType {
  if (items.length < 2) return "min";
  const a = Number(items[0]);
  const b = Number(items[1]);
  return a <= b ? "min" : "max";
}

/** Find indices where the heap property is violated. */
function findViolations(items: unknown[], heapType: HeapType): Set<number> {
  const v = new Set<number>();
  const toNum = (x: unknown): number => {
    const n = Number(x);
    return Number.isFinite(n) ? n : NaN;
  };

  for (let i = 0; i < items.length; i++) {
    const val = toNum(items[i]);
    if (!Number.isFinite(val)) continue;

    const lc = getLeftChild(i);
    const rc = getRightChild(i);

    const checkChild = (ci: number): boolean => {
      if (ci >= items.length) return false;
      const cv = toNum(items[ci]);
      if (!Number.isFinite(cv)) return false;
      if (heapType === "max") return val < cv;
      return val > cv;
    };

    if (checkChild(lc)) {
      v.add(i);
      v.add(lc);
    }
    if (checkChild(rc)) {
      v.add(i);
      v.add(rc);
    }
  }
  return v;
}

/** Detect swap pairs between prev and current arrays (same length). */
function detectSwapPairs(
  prev: unknown[],
  curr: unknown[],
): [number, number][] {
  const pairs: [number, number][] = [];
  const changed: number[] = [];
  const len = Math.min(prev.length, curr.length);
  for (let i = 0; i < len; i++) {
    if (String(prev[i]) !== String(curr[i])) {
      changed.push(i);
    }
  }
  for (const i of changed) {
    for (const j of changed) {
      if (
        i < j &&
        String(prev[i]) === String(curr[j]) &&
        String(prev[j]) === String(curr[i])
      ) {
        pairs.push([i, j]);
      }
    }
  }
  return pairs;
}

// ── Tree layout ───────────────────────────────────────────────────────────────

function computeLayout(items: unknown[]): {
  nodes: NodePos[];
  edges: Edge[];
  width: number;
  height: number;
} {
  if (items.length === 0) return { nodes: [], edges: [], width: 0, height: 0 };

  const maxLevel = getLevel(items.length - 1);
  const leafCount = 1 << maxLevel; // 2^maxLevel
  const totalWidth = leafCount * (NODE_W + LEAF_GAP);

  const xs: number[] = [];
  const ys: number[] = [];

  function assign(i: number, depth: number, left: number, right: number) {
    if (i >= items.length) return;
    const mid = (left + right) / 2;
    xs[i] = mid;
    ys[i] = depth * V_GAP;

    const lc = getLeftChild(i);
    const rc = getRightChild(i);
    if (lc < items.length) assign(lc, depth + 1, left, mid);
    if (rc < items.length) assign(rc, depth + 1, mid, right);
  }

  assign(0, 0, 0, totalWidth);

  const nodes: NodePos[] = [];
  const edges: Edge[] = [];

  for (let i = 0; i < items.length && i < MAX_NODES; i++) {
    nodes.push({
      index: i,
      x: xs[i] + PAD,
      y: ys[i] + PAD,
      label: String(items[i]),
    });
  }

  for (let i = 0; i < items.length && i < MAX_NODES; i++) {
    const lc = getLeftChild(i);
    const rc = getRightChild(i);
    if (lc < items.length && lc < MAX_NODES) {
      edges.push({
        x1: xs[i] + PAD + NODE_W / 2,
        y1: ys[i] + PAD + NODE_H,
        x2: xs[lc] + PAD + NODE_W / 2,
        y2: ys[lc] + PAD,
      });
    }
    if (rc < items.length && rc < MAX_NODES) {
      edges.push({
        x1: xs[i] + PAD + NODE_W / 2,
        y1: ys[i] + PAD + NODE_H,
        x2: xs[rc] + PAD + NODE_W / 2,
        y2: ys[rc] + PAD,
      });
    }
  }

  const w = totalWidth + PAD * 2 + NODE_W;
  const h = (maxLevel + 1) * V_GAP + PAD * 2 + NODE_H;

  return { nodes, edges, width: w, height: h };
}

// ── Inline keyframes ──────────────────────────────────────────────────────────

const KEYFRAMES = `
@keyframes heap-node-appear {
  from { opacity: 0; transform: scale(0.4); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes heap-node-disappear {
  from { opacity: 1; transform: scale(1); }
  to   { opacity: 0; transform: scale(0.4); }
}
`;

// ── Sub-components ────────────────────────────────────────────────────────────

function HeapNodeSVG({
  node,
  isTop,
  highlight,
  violation,
  appearing,
  disappearing,
  flashed,
}: {
  node: NodePos;
  isTop: boolean;
  highlight: "none" | "swap";
  violation: boolean;
  appearing: boolean;
  disappearing: boolean;
  flashed: boolean;
}) {
  let fill = "var(--viz-panel-bg)";
  let stroke = "var(--viz-panel-border)";
  let strokeW = 1.5;
  let textFill = "var(--viz-body-text)";

  if (violation) {
    fill = "rgba(245, 158, 11, 0.06)";
    stroke = "var(--viz-exception)";
    strokeW = 2;
    textFill = "var(--viz-exception)";
  } else if (highlight === "swap" || flashed) {
    fill = "rgba(245, 158, 11, 0.12)";
    stroke = "var(--viz-flash)";
    strokeW = 2;
    textFill = "var(--viz-flash)";
  } else if (isTop) {
    stroke = "var(--viz-flash)";
    strokeW = 1.5;
    textFill = "var(--viz-flash)";
  }

  const animStyle: React.CSSProperties = {};
  if (appearing) {
    animStyle.animation = "heap-node-appear 0.3s ease-out both";
  }
  if (disappearing) {
    animStyle.animation = "heap-node-disappear 0.3s ease-in both";
  }

  return (
    <g
      transform={`translate(${node.x},${node.y})`}
      style={animStyle}
      data-testid="heap-tree-node"
      data-index={node.index}
      data-flash={flashed || highlight !== "none" ? "true" : "false"}
    >
      <rect
        width={NODE_W}
        height={NODE_H}
        rx={4}
        style={{ fill, stroke, strokeWidth: strokeW }}
      />
      {disappearing && (
        <line
          x1={4} y1={4} x2={NODE_W - 4} y2={NODE_H - 4}
          style={{ stroke: "var(--viz-exception)" }}
          strokeWidth={2}
        />
      )}
      <text
        x={NODE_W / 2}
        y={NODE_H / 2 + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={11}
        fontFamily="monospace"
        style={{ pointerEvents: "none", fill: textFill }}
      >
        {node.label.length > 4 ? node.label.slice(0, 4) : node.label}
      </text>
    </g>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function HeapVisual({ value, changedIndices = [] }: Props) {
  // Stable identity per value: the render-phase adjustment below keys off it.
  const items = useMemo(() => asHeapData(value)?.items ?? [], [value]);
  const propFlash = new Set(changedIndices);

  // ── Animation state ──
  const [prevItems, setPrevItems] = useState<unknown[]>(items);
  const [animPhase, setAnimPhase] = useState<AnimPhase>("idle");
  const [animPlan, setAnimPlan] = useState<AnimPlan>({ kind: "none" });
  const [swapHighlight, setSwapHighlight] = useState<Set<number>>(new Set());
  const [violations, setViolations] = useState<Set<number>>(new Set());
  const [appearingIndex, setAppearingIndex] = useState<number | null>(null);
  const [disappearingIndex, setDisappearingIndex] = useState<number | null>(null);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const heapType = useMemo(() => detectHeapType(items), [items]);

  // Derive the animation reset during render (previous-items adjustment):
  // pure and batched, never a cascading effect. Timeout choreography for the
  // resulting plan lives in the effect below, which sets state only inside
  // timeout callbacks (async subscriptions).
  if (prevItems !== items) {
    const prev = prevItems;
    setPrevItems(items);
    setSwapHighlight(new Set());
    setViolations(
      prev.length === 0 || items.length === 0
        ? new Set<number>()
        : findViolations(items, heapType),
    );
    if (items.length === prev.length + 1) {
      // PUSH
      setAnimPhase("push-appear");
      setAppearingIndex(items.length - 1);
      setDisappearingIndex(null);
      setAnimPlan({ kind: "push", prev, curr: items });
    } else if (items.length === prev.length - 1) {
      // POP
      setAnimPhase("pop-mark");
      setDisappearingIndex(-1); // special: top element removed
      setAppearingIndex(null);
      setAnimPlan({ kind: "pop", prev, curr: items });
    } else {
      // REORDER (intermediate bubble step) or unrelated shape change
      const swaps =
        items.length === prev.length ? detectSwapPairs(prev, items) : [];
      setAppearingIndex(null);
      setDisappearingIndex(null);
      if (swaps.length > 0) {
        setAnimPhase("push-bubble"); // reuse bubble phase for any swap
        setAnimPlan({ kind: "reorder", curr: items, swaps });
      } else {
        setAnimPhase("idle");
        setAnimPlan({ kind: "none" });
      }
    }
  }

  // Timeout choreography for the plan derived above: the effect body only
  // clears pending timers and schedules new ones.
  useEffect(() => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];

    const later = (ms: number, fn: () => void): void => {
      timeoutsRef.current.push(setTimeout(fn, ms));
    };
    const settle = (curr: unknown[]): void => {
      setAnimPhase("idle");
      setSwapHighlight(new Set());
      setViolations(findViolations(curr, heapType));
    };
    const playSwaps = (swaps: [number, number][]): void => {
      swaps.forEach(([i, j], idx) => {
        later(idx * SWAP_MS, () => setSwapHighlight(new Set([i, j])));
      });
    };

    if (animPlan.kind === "push") {
      const { prev, curr } = animPlan;
      later(PHASE_MS, () => {
        setAppearingIndex(null);
        // Phase 2: bubble-up swaps
        setAnimPhase("push-bubble");
        playSwaps(detectSwapPairs(prev, curr));
        later(SWAP_MS * 3, () => settle(curr));
      });
    } else if (animPlan.kind === "pop") {
      const { prev, curr } = animPlan;
      later(PHASE_MS, () => {
        setDisappearingIndex(null);
        setAnimPhase("pop-sink");
        // After pop, the last element was moved to root and sinks down
        playSwaps(detectSwapPairs(prev, curr));
        later(SWAP_MS * 3, () => settle(curr));
      });
    } else if (animPlan.kind === "reorder") {
      const { curr, swaps } = animPlan;
      playSwaps(swaps);
      later(SWAP_MS * swaps.length + 100, () => settle(curr));
    }

    // Cleanup timeouts on unmount or before the next plan schedules.
    return () => {
      timeoutsRef.current.forEach(clearTimeout);
    };
  }, [animPlan, heapType]);

  // ── Layout ──
  const { nodes, edges, width, height } = useMemo(() => computeLayout(items), [items]);

  // ── Overflow handling ──
  const overflow = items.length > MAX_NODES ? items.length - MAX_NODES : 0;

  // ── Render ──
  return (
    <div className="flex flex-col gap-1">
      {/* Heap type badge */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono text-viz-ink/60">
          {heapType === "min" ? "min‑heap" : "max‑heap"}
        </span>
        <span className="text-[9px] text-viz-ink/60">
          · {items.length} item{items.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Array strip dual (render-spec §2: triangle array-tree dual view) */}
      {items.length > 0 && (
        <div data-testid="heap-array-strip" className="flex gap-0.5 overflow-x-auto pb-1">
          {items.slice(0, MAX_NODES).map((item, i) => {
            const flashed = swapHighlight.has(i) || propFlash.has(i);
            return (
              <div key={i} className="flex flex-col items-center shrink-0">
                <div
                  data-testid="heap-strip-cell"
                  data-index={i}
                  data-flash={flashed ? "true" : "false"}
                  className={`w-8 h-7 flex items-center justify-center text-xs font-mono truncate overflow-hidden border ${flashed ? "border-viz-flash bg-viz-flash/15 text-viz-flash" : "border-viz-line bg-viz-panel text-viz-ink"}`}
                  style={flashStyle(flashed)}
                  title={renderCellValue(item)}
                >
                  {renderCellValue(item)}
                </div>
                <div className="text-[10px] font-mono text-viz-ink/60">{i}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* SVG tree */}
      {items.length === 0 ? (
        <span className="text-[10px] text-viz-ink/60 italic">empty</span>
      ) : (
        <div className="overflow-auto max-w-full">
          <style>{KEYFRAMES}</style>
          <svg
            width={Math.max(width, 100)}
            height={Math.max(height, 40)}
            className="overflow-visible shrink-0"
            style={{ minWidth: width }}
          >
            {/* Edges */}
            {edges.map((e, i) => (
              <line
                key={`e-${i}`}
                x1={e.x1}
                y1={e.y1}
                x2={e.x2}
                y2={e.y2}
                strokeWidth={1.5}
                style={{ stroke: "var(--viz-panel-border)" }}
              />
            ))}

            {/* Nodes */}
            {nodes.map((node) => {
              const isTop = node.index === 0;
              const isAppearing = animPhase === "push-appear" && node.index === appearingIndex;
              const isDisappearing = animPhase === "pop-mark" && node.index === 0 && disappearingIndex === -1;
              const isHighlighted = swapHighlight.has(node.index);
              const isViolation = violations.has(node.index) && !isHighlighted && !propFlash.has(node.index);
              const flashed = isHighlighted || propFlash.has(node.index);

              let highlight: "none" | "swap" = "none";
              if (flashed) highlight = "swap";

              return (
                <HeapNodeSVG
                  key={`n-${node.index}`}
                  node={node}
                  isTop={isTop}
                  highlight={highlight}
                  violation={isViolation}
                  appearing={isAppearing}
                  disappearing={isDisappearing}
                  flashed={propFlash.has(node.index)}
                />
              );
            })}

            {/* Overflow marker */}
            {overflow > 0 && (
              <g transform={`translate(${PAD}, ${PAD + (getLevel(MAX_NODES - 1) + 1) * V_GAP + NODE_H + 8})`}>
                <text
                  fontSize={10}
                  fontFamily="monospace"
                  style={{ fill: "var(--viz-alias-edge)" }}
                >
                  +{overflow} more
                </text>
              </g>
            )}
          </svg>
        </div>
      )}

      {/* Index hints for top few levels */}
      {items.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
          {nodes.slice(0, Math.min(7, nodes.length)).map((n) => (
            <span key={n.index} className="text-[8px] text-zinc-700 font-mono">
              [{n.index}]
            </span>
          ))}
          {items.length > 7 && (
            <span className="text-[8px] text-zinc-700 font-mono">…</span>
          )}
        </div>
      )}
    </div>
  );
}
