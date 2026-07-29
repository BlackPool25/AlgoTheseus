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

interface HeapData {
  top: unknown;
  items: unknown[];
}

interface Props {
  value: HeapData;
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
  return (i << 1) | 2;
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
}: {
  node: NodePos;
  isTop: boolean;
  highlight: "none" | "pink" | "green";
  violation: boolean;
  appearing: boolean;
  disappearing: boolean;
}) {
  let fill = "#27272a";
  let stroke = "#52525b";
  let strokeW = 1.5;
  let textFill = "#e4e4e7";

  if (violation) {
    fill = "rgba(239,68,68,0.12)";
    stroke = "#ef4444";
    strokeW = 2;
    textFill = "#fca5a5";
  } else if (highlight === "pink") {
    fill = "rgba(236,72,153,0.12)";
    stroke = "#ec4899";
    strokeW = 2;
    textFill = "#f472b6";
  } else if (highlight === "green") {
    fill = "rgba(16,185,129,0.12)";
    stroke = "#10b981";
    strokeW = 2;
    textFill = "#6ee7b7";
  } else if (isTop) {
    stroke = "#f59e0b";
    strokeW = 1.5;
    textFill = "#f59e0b";
  }

  const animStyle: React.CSSProperties = {};
  if (appearing) {
    animStyle.animation = "heap-node-appear 0.3s ease-out both";
  }
  if (disappearing) {
    animStyle.animation = "heap-node-disappear 0.3s ease-in both";
  }

  return (
    <g transform={`translate(${node.x},${node.y})`} style={animStyle}>
      <rect
        width={NODE_W}
        height={NODE_H}
        rx={4}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeW}
      />
      {disappearing && (
        <line
          x1={4} y1={4} x2={NODE_W - 4} y2={NODE_H - 4}
          stroke="#ef4444" strokeWidth={2}
        />
      )}
      <text
        x={NODE_W / 2}
        y={NODE_H / 2 + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={textFill}
        fontSize={11}
        fontFamily="monospace"
        style={{ pointerEvents: "none" }}
      >
        {node.label.length > 4 ? node.label.slice(0, 4) : node.label}
      </text>
    </g>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function HeapVisual({ value }: Props) {
  const items = value.items ?? [];

  // ── Animation state ──
  const prevItemsRef = useRef<unknown[]>([]);
  const [animPhase, setAnimPhase] = useState<AnimPhase>("idle");
  const [swapHighlight, setSwapHighlight] = useState<Set<number>>(new Set());
  const [violations, setViolations] = useState<Set<number>>(new Set());
  const [appearingIndex, setAppearingIndex] = useState<number | null>(null);
  const [disappearingIndex, setDisappearingIndex] = useState<number | null>(null);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const heapType = useMemo(() => detectHeapType(items), [items]);

  // Detect operation and animate
  useEffect(() => {
    const prev = prevItemsRef.current;
    prevItemsRef.current = items;

    // Clear any pending timeouts from previous animation
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];

    setAppearingIndex(null);
    setDisappearingIndex(null);
    setSwapHighlight(new Set());

    if (prev.length === 0 || items.length === 0) {
      setAnimPhase("idle");
      setViolations(new Set());
      return;
    }

    // Compute violations for current state
    const currViolations = findViolations(items, heapType);
    setViolations(currViolations);

    // --- Detect operation ---
    if (items.length === prev.length + 1) {
      // PUSH
      setAnimPhase("push-appear");
      const newIdx = items.length - 1;
      setAppearingIndex(newIdx);

      // Phase 1: new node appears (PHASE_MS)
      const t1 = setTimeout(() => {
        setAppearingIndex(null);

        // Phase 2: bubble-up swaps
        setAnimPhase("push-bubble");
        animateBubbleUp(prev, items);

        // After bubble-up, check remaining violations
        const t3 = setTimeout(() => {
          setAnimPhase("idle");
          setSwapHighlight(new Set());
          setViolations(findViolations(items, heapType));
        }, SWAP_MS * 3);

        timeoutsRef.current.push(t3);
      }, PHASE_MS);
      timeoutsRef.current.push(t1);
    } else if (items.length === prev.length - 1) {
      // POP
      setAnimPhase("pop-mark");
      setDisappearingIndex(-1); // special: top element removed

      const t1 = setTimeout(() => {
        setDisappearingIndex(null);
        setAnimPhase("pop-sink");
        animateBubbleDown(prev, items);

        const t3 = setTimeout(() => {
          setAnimPhase("idle");
          setSwapHighlight(new Set());
          setViolations(findViolations(items, heapType));
        }, SWAP_MS * 3);
        timeoutsRef.current.push(t3);
      }, PHASE_MS);
      timeoutsRef.current.push(t1);
    } else if (items.length === prev.length) {
      // REORDER (intermediate bubble-up/down step)
      const swaps = detectSwapPairs(prev, items);
      if (swaps.length > 0) {
        setAnimPhase("push-bubble"); // reuse bubble phase for any swap
        animateSwaps(swaps);

        const t = setTimeout(() => {
          setAnimPhase("idle");
          setSwapHighlight(new Set());
          setViolations(findViolations(items, heapType));
        }, SWAP_MS * swaps.length + 100);
        timeoutsRef.current.push(t);
      } else {
        setAnimPhase("idle");
      }
    }

    // ── helpers ──

    function animateSwaps(swaps: [number, number][]) {
      swaps.forEach(([i, j], idx) => {
        const t = setTimeout(() => {
          setSwapHighlight(new Set([i, j]));
        }, idx * SWAP_MS);
        timeoutsRef.current.push(t);
      });

      const t = setTimeout(() => {
        setSwapHighlight(new Set());
      }, swaps.length * SWAP_MS + 50);
      timeoutsRef.current.push(t);
    }

    function animateBubbleUp(prev: unknown[], curr: unknown[]) {
      const swaps = detectSwapPairs(prev, curr);
      swaps.forEach(([i, j], idx) => {
        const t = setTimeout(() => {
          setSwapHighlight(new Set([i, j]));
        }, idx * SWAP_MS);
        timeoutsRef.current.push(t);
      });
    }

    function animateBubbleDown(prev: unknown[], curr: unknown[]) {
      // After pop, the last element was moved to root and sinks down
      const swaps = detectSwapPairs(prev, curr);
      swaps.forEach(([i, j], idx) => {
        const t = setTimeout(() => {
          setSwapHighlight(new Set([i, j]));
        }, idx * SWAP_MS);
        timeoutsRef.current.push(t);
      });
    }

    // Cleanup timeouts on unmount
    return () => {
      timeoutsRef.current.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, heapType]);

  // ── Layout ──
  const { nodes, edges, width, height } = useMemo(() => computeLayout(items), [items]);

  // ── Overflow handling ──
  const overflow = items.length > MAX_NODES ? items.length - MAX_NODES : 0;

  // ── Render ──
  return (
    <div className="flex flex-col gap-1">
      {/* Heap type badge */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono text-zinc-500">
          {heapType === "min" ? "min‑heap" : "max‑heap"}
        </span>
        <span className="text-[9px] text-zinc-600">
          · {items.length} item{items.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* SVG tree */}
      {items.length === 0 ? (
        <span className="text-[10px] text-zinc-600 italic">empty</span>
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
                stroke="#3f3f46"
                strokeWidth={1.5}
              />
            ))}

            {/* Nodes */}
            {nodes.map((node) => {
              const isTop = node.index === 0;
              const isAppearing = animPhase === "push-appear" && node.index === appearingIndex;
              const isDisappearing = animPhase === "pop-mark" && node.index === 0 && disappearingIndex === -1;
              const isHighlighted = swapHighlight.has(node.index);
              const isViolation = violations.has(node.index) && !isHighlighted;

              // If pop animation: the last element (which became root) highlights differently
              let highlight: "none" | "pink" | "green" = "none";
              if (isHighlighted) highlight = "pink";
              if (animPhase === "push-bubble" && isHighlighted) highlight = "pink";

              return (
                <HeapNodeSVG
                  key={`n-${node.index}`}
                  node={node}
                  isTop={isTop}
                  highlight={highlight}
                  violation={isViolation}
                  appearing={isAppearing}
                  disappearing={isDisappearing}
                />
              );
            })}

            {/* Overflow marker */}
            {overflow > 0 && (
              <g transform={`translate(${PAD}, ${PAD + (getLevel(MAX_NODES - 1) + 1) * V_GAP + NODE_H + 8})`}>
                <text
                  fill="#a1a1aa"
                  fontSize={10}
                  fontFamily="monospace"
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
