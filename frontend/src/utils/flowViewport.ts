/**
 * utils/flowViewport.ts — pure viewport-refit decision helpers for TraceFlow.
 *
 * The CFG flowchart fits once per load, but the three resizable columns
 * (editor/CFG/state) + window resizes change the flow container's pixel size
 * afterwards. These helpers decide when an automatic re-fit is wanted, so the
 * component stays a thin ResizeObserver/effect wrapper and the policy itself
 * is unit-testable without a DOM (repo has no jsdom/happy-dom).
 */

/** Debounce for panel-drag resize bursts (avoid refitting 60x/sec). */
export const FLOW_REFIT_DEBOUNCE_MS = 150;

/** Padding used for every automatic fitView, matching the initial fit. */
export const FLOW_FIT_PADDING = 0.2;

export interface AutoRefitInput {
  /** True once the user manually panned/zoomed (ReactFlow onMoveStart). */
  userMoved: boolean;
  /** Current container content-box size in px. */
  width: number;
  height: number;
  /** Container size at the last observation. */
  prevWidth: number;
  prevHeight: number;
}

/**
 * Should the flow auto re-fit right now?
 * - Respects the user's manual viewport (never steal the camera back).
 * - Ignores zero-size containers (hidden mobile tab — nothing to fit into).
 * - Ignores observations where the size did not actually change
 *   (ResizeObserver also fires for reasons other than resizes).
 */
export function shouldAutoRefit(input: AutoRefitInput): boolean {
  if (input.userMoved) return false;
  if (input.width <= 0 || input.height <= 0) return false;
  if (input.width === input.prevWidth && input.height === input.prevHeight) {
    return false;
  }
  return true;
}

/**
 * Key watched by the auto-fit effect. Changes when expanding/collapsing a
 * loop node reveals or hides nodes (visible count) or when the expanded set
 * itself toggles, so newly revealed nodes re-fit even though the store's
 * total cfgNodes.length never changes.
 */
export function visibleFitKey(visibleCount: number, expandedCount: number): string {
  return `${visibleCount}:${expandedCount}`;
}
