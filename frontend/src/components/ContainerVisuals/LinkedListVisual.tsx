/**
 * components/ContainerVisuals/LinkedListVisual.tsx
 *
 * Animated SVG linked list renderer. Walks "next"/"prev" pointers from the
 * head node, draws horizontal boxes with directional arrows, and supports:
 *
 *   - Singly-linked (→) and doubly-linked (↔) arrow styles
 *   - Current-pointer / iterator highlighting via $addr match
 *   - Cycle detection — red cycle badge on the sentinel node
 *   - Animated node insertion (slide-in + fade) and deletion (fade-out)
 *   - 500-node soft limit with truncation warning
 */

import { useMemo, useRef, useEffect, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface FlatNode {
  id: string;
  label: string;
  addr?: string;
  isCycleSentinel: boolean;
  /** If this sentinel's next points back to an earlier node, store that id here. */
  cycleTargetId?: string;
}

interface Props {
  value: unknown;
  name: string;
  /** If set, the node whose $addr matches will get highlight styling. */
  currentAddr?: string;
}

// ── Layout constants ───────────────────────────────────────────────────────────

const NODE_W = 60;
const NODE_H = 34;
const ARROW_LEN = 36;
/** Horiz. stride per node (box + arrow + padding) */
const STEP = NODE_W + ARROW_LEN + 16;
const SVG_PAD = 10;
const SVG_H = 70;
/** Label rows: non-cycle nodes max chars, cycle node label is short. */
const LABEL_MAX = 6;

// ── SVG helpers ────────────────────────────────────────────────────────────────

/** Build an SVG <defs> block with arrowhead markers. */
function ArrowDefs() {
  return (
    <defs>
      <marker id="ll-forward" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <path d="M0,0 L0,6 L8,3 Z" fill="#52525b" />
      </marker>
      <marker id="ll-backward" markerWidth="6" markerHeight="5" refX="5" refY="2.5" orient="auto">
        <path d="M6,0 L6,5 L0,2.5 Z" fill="#52525b" />
      </marker>
      <marker id="ll-cycle-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <path d="M0,0 L0,6 L8,3 Z" fill="#ef4444" />
      </marker>
      <marker id="ll-highlight-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <path d="M0,0 L0,6 L8,3 Z" fill="#f59e0b" />
      </marker>
    </defs>
  );
}

// ── Data linearisation ─────────────────────────────────────────────────────────

/**
 * Walk the `next` (and optionally `prev`) pointers, collecting a flat array
 * of renderable nodes.  Stops at cycle sentinel, null, or >500 nodes.
 */
function linearise(
  head: unknown,
  labelField = "val",
  nextField = "next",
  maxNodes = 500,
): { flat: FlatNode[]; hasCycle: boolean } {
  const seen = new Set<unknown>();
  const flat: FlatNode[] = [];
  let cur = head;
  let idx = 0;

  while (cur && typeof cur === "object" && !Array.isArray(cur) && idx < maxNodes) {
    const obj = cur as Record<string, unknown>;

    if (seen.has(cur)) break;
    seen.add(cur);

    // Cycle sentinel produced by backend serialiser
    if (obj.$cycle === true) {
      const addr = (obj.$addr as string) ?? undefined;
      flat.push({
        id: addr ?? `cycle-${idx}`,
        label: "↩",
        addr,
        isCycleSentinel: true,
      });
      break;
    }

    const addr = (obj.$addr as string) ?? undefined;

    // Try common label fields
    const rawLabel = String(
      obj[labelField] ?? obj.value ?? obj.data ?? "?",
    );

    flat.push({
      id: addr ?? `node-${idx}`,
      label: rawLabel === "?" && obj.$addr
        ? (obj.$addr as string).slice(-4)
        : rawLabel,
      addr,
      isCycleSentinel: false,
    });
    idx++;

    // Advance to next node
    const nextVal = obj[nextField] ?? obj.nxt ?? null;
    if (!nextVal || typeof nextVal !== "object" || Array.isArray(nextVal)) break;

    // Detect cycle by address reference (no $cycle sentinel)
    const nextObj = nextVal as Record<string, unknown>;
    if (addr && nextObj.$addr && seen.has(nextVal)) {
      const targetId = (nextObj.$addr as string) ?? undefined;
      if (targetId) {
        flat[flat.length - 1].cycleTargetId = targetId;
      }
      flat.push({
        id: `cycle-ref-${idx}`,
        label: "↩",
        addr: undefined,
        isCycleSentinel: true,
        cycleTargetId: targetId,
      });
      break;
    }

    cur = nextVal;
  }

  return { flat, hasCycle: flat.some((n) => n.isCycleSentinel) };
}

/** Quick check for `prev` field presence → doubly-linked rendering. */
function hasPrevField(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return "prev" in obj;
}

// ── CSS keyframes (injected once as a <style> tag) ─────────────────────────────

const ANIM_STYLE_ID = "ll-visual-anim";

function injectAnimStyle() {
  if (typeof document === "undefined" || document.getElementById(ANIM_STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = ANIM_STYLE_ID;
  el.textContent = `
    @keyframes ll-slide-in {
      from { opacity: 0; transform: translateX(-20px) scale(0.92); }
      to   { opacity: 1; transform: translateX(0) scale(1); }
    }
    @keyframes ll-fade-out {
      from { opacity: 1; transform: scale(1); }
      to   { opacity: 0; transform: scale(0.85); }
    }
    .ll-enter { animation: ll-slide-in 0.3s ease-out both; }
    .ll-exit  { animation: ll-fade-out 0.25s ease-in both; }
  `;
  document.head.appendChild(el);
}

// ── Component ──────────────────────────────────────────────────────────────────

export function LinkedListVisual({ value, name, currentAddr }: Props) {
  // Linearise once per value
  const { flat, hasCycle } = useMemo(() => linearise(value), [value]);
  const isDoubly = useMemo(() => hasPrevField(value), [value]);

  // ── Animation state ──────────────────────────────────────────────────────
  /** Nodes currently in the render list (keeps exiting nodes alive). */
  const [renderList, setRenderList] = useState<FlatNode[]>([]);
  /** IDs of nodes currently playing the exit animation. */
  const [exitingIds, setExitingIds] = useState<Set<string>>(new Set());
  /** IDs of nodes that should render with opacity:0 on the next frame. */
  const [enteringIds, setEnteringIds] = useState<Set<string>>(new Set());

  const prevSerialised = useRef("");

  // Diff incoming flat list vs current render list
  useEffect(() => {
    injectAnimStyle();

    const currSerialised = flat.map((n) => n.id).join(",");
    if (currSerialised === prevSerialised.current) return; // no structural change
    prevSerialised.current = currSerialised;

    const currMap = new Map(flat.map((n) => [n.id, n]));
    const prevMap = new Map(renderList.map((n) => [n.id, n]));

    const exiting = new Set<string>();
    const entering = new Set<string>();

    for (const id of prevMap.keys()) if (!currMap.has(id)) exiting.add(id);
    for (const id of currMap.keys()) if (!prevMap.has(id)) entering.add(id);

    if (exiting.size > 0) {
      // Keep exiting nodes temporarily
      setExitingIds(exiting);
      setRenderList(
        renderList
          .filter((n) => !exiting.has(n.id))
          .concat(flat.filter((n) => !prevMap.has(n.id))),
      );

      const timer = setTimeout(() => {
        setRenderList(flat);
        setExitingIds(new Set());
      }, 300);
      return () => clearTimeout(timer);
    }

    // No exiting nodes — just update
    setRenderList(flat);

    if (entering.size > 0) {
      setEnteringIds(entering);
      const raf = requestAnimationFrame(() => setEnteringIds(new Set()));
      return () => cancelAnimationFrame(raf);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat]);

  // Initial render
  useEffect(() => {
    if (renderList.length === 0 && flat.length > 0) {
      setRenderList(flat);
      prevSerialised.current = flat.map((n) => n.id).join(",");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat]);

  const svgW = Math.max(
    60,
    renderList.length * STEP + SVG_PAD * 2 + (hasCycle ? 40 : 0),
  );

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-1">
      {/* Header */}
      <div className="flex items-center gap-2 text-[10px] text-zinc-500">
        <span>
          {name}: {isDoubly ? "doubly" : "singly"}-linked list
          {hasCycle && <span className="text-red-400 ml-1">(cycle)</span>}
        </span>
        {flat.length > 500 && (
          <span className="text-amber-500">truncated</span>
        )}
      </div>

      <div className="overflow-x-auto pb-1">
        <svg width={svgW} height={SVG_H} className="block">
          <ArrowDefs />

          {renderList.map((node, i) => {
            const x = i * STEP + SVG_PAD;
            const y = SVG_PAD + 4;
            const isExiting = exitingIds.has(node.id);
            const isEntering = enteringIds.has(node.id);
            const isHighlighted =
              currentAddr !== undefined && node.addr === currentAddr;
            const isCycle = node.isCycleSentinel;
            const classes = [
              isEntering && !isExiting ? "ll-enter" : "",
              isExiting ? "ll-exit" : "",
            ]
              .filter(Boolean)
              .join(" ");

            // ── backward arrow (doubly-linked) ──
            const prevArrow =
              isDoubly && i > 0 && !isCycle ? (
                <line
                  key={`pa-${node.id}`}
                  x1={x - ARROW_LEN - 16 + 1}
                  y1={y + NODE_H + 4}
                  x2={x - 16}
                  y2={y + NODE_H + 4}
                  stroke="#52525b"
                  strokeWidth={1}
                  markerEnd="url(#ll-backward)"
                />
              ) : null;

            // ── forward arrow ──
            const showForward =
              i < renderList.length - 1 && !node.isCycleSentinel;
            const forwardArrow = showForward ? (
              <line
                key={`fa-${node.id}`}
                x1={x + NODE_W}
                y1={y + NODE_H / 2}
                x2={x + NODE_W + ARROW_LEN}
                y2={y + NODE_H / 2}
                stroke={
                  node.cycleTargetId
                    ? "#ef4444"
                    : isHighlighted
                      ? "#f59e0b"
                      : "#52525b"
                }
                strokeWidth={isHighlighted || node.cycleTargetId ? 2 : 1.5}
                markerEnd={
                  node.cycleTargetId
                    ? "url(#ll-cycle-arrow)"
                    : isHighlighted
                      ? "url(#ll-highlight-arrow)"
                      : "url(#ll-forward)"
                }
              />
            ) : null;

            // ── cycle return arrow (curved) ──
            let cycleReturn = null;
            if (node.cycleTargetId && renderList.length > 1) {
              const targetIdx = renderList.findIndex(
                (n) => n.id === node.cycleTargetId,
              );
              if (targetIdx !== -1 && targetIdx < i) {
                const tx = targetIdx * STEP + SVG_PAD + NODE_W / 2;
                const ty = SVG_PAD + 4 + NODE_H + 8;
                const cx = (tx + x) / 2;
                const qy = Math.min(ty, y + NODE_H + 40);
                cycleReturn = (
                  <path
                    key={`cr-${node.id}`}
                    d={`M ${tx} ${ty} Q ${cx} ${qy} ${x + NODE_W / 2} ${y + NODE_H + 8}`}
                    fill="none"
                    stroke="#ef4444"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    markerEnd="url(#ll-cycle-arrow)"
                  />
                );
              }
            }

            // ── node group ──
            return (
              <g
                key={node.id}
                className={classes}
                style={{
                  transition: "transform 0.3s ease, opacity 0.3s ease",
                }}
              >
                {prevArrow}
                {forwardArrow}
                {cycleReturn}

                {/* Node body */}
                <rect
                  x={x}
                  y={y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={4}
                  className={
                    isCycle
                      ? "fill-red-900/60 stroke-red-500"
                      : isHighlighted
                        ? "fill-stone-900 stroke-amber-400"
                        : "fill-stone-900 stroke-stone-600"
                  }
                  strokeWidth={isHighlighted || isCycle ? 2 : 1.5}
                />

                {/* Label text */}
                <text
                  x={x + NODE_W / 2}
                  y={y + NODE_H / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="fill-zinc-200 text-[11px]"
                  fontFamily="monospace"
                >
                  {node.label.length > LABEL_MAX
                    ? node.label.slice(0, LABEL_MAX)
                    : node.label}
                </text>

                {/* Cycle badge */}
                {isCycle && (
                  <>
                    <circle
                      cx={x + NODE_W - 10}
                      cy={y - 6}
                      r={10}
                      fill="#ef4444"
                      className="drop-shadow-sm"
                    />
                    <text
                      x={x + NODE_W - 10}
                      y={y - 6}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="white"
                      fontSize={10}
                      fontFamily="monospace"
                    >
                      ↻
                    </text>
                  </>
                )}

                {/* Head label on first node */}
                {i === 0 && !isCycle && (
                  <text
                    x={x + NODE_W / 2}
                    y={y - 6}
                    textAnchor="middle"
                    className="fill-zinc-500 text-[9px]"
                    fontFamily="monospace"
                  >
                    head
                  </text>
                )}

                {/* Address label below box */}
                {node.addr && !isCycle && (
                  <text
                    x={x + NODE_W / 2}
                    y={y + NODE_H + 12}
                    textAnchor="middle"
                    className="fill-zinc-600 text-[8px]"
                    fontFamily="monospace"
                  >
                    {node.addr.length > 10
                      ? node.addr.slice(0, 10)
                      : node.addr}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Soft limit warning */}
      {flat.length > 500 && (
        <div className="text-[10px] text-amber-400 mt-0.5">
          ⚠ List has {flat.length} nodes — showing truncated view
        </div>
      )}
    </div>
  );
}
