/**
 * utils/scopeDisplay.ts — Intuitive variable-scope display (R5–R6).
 *
 * Pure helpers (no React, no store) so loop-control steps can forward-fill
 * the last live snapshot instead of rendering blank:
 *
 * - `liveVarsOf` — live payload of an event, or null when the event type
 *   carries no vars by schema (`iter` / `branch` / `exit`).
 * - `findLastLiveSnapshot` — bounded scan-back for the nearest preceding
 *   `state` / `enter` vars in the same `func` + `depth` frame.
 * - `resolveDisplayVars` — per-event-type display rule (spec §a): `state`
 *   and `enter` render live; `iter` / `branch` forward-fill the last live
 *   snapshot as carried (dimmed); `exit` shows the exiting frame's last
 *   snapshot as carried plus a `return_val` row when present.
 * - `computeRowStates` — added / changed / removed / carried treatments.
 *   Diff is always live-vs-last-LIVE (carried steps excluded from both
 *   sides), so a value held across blank iters flashes once on the
 *   mutating step and never on carried steps. Scalar comparison stays
 *   `JSON.stringify` (no deep-diff of containers per render — perf guard).
 * - `buildHighlightMap` — generalised index highlight: any finite
 *   non-negative integer scalar that is a valid index into a 1D array in
 *   scope qualifies; preference
 *   `mid → lo → hi → i → j → k → left → right → low → high → idx → index
 *   → pos → alphabetical`. 2D arrays stay excluded; fan-out to every
 *   qualifying 1D array is unchanged.
 */

import { assertNever } from "../types/trace";
import type { TraceEvent } from "../types/trace";

/** Visual treatment of one variable row. */
export type RowStatus = "normal" | "changed" | "added" | "removed" | "carried";

export interface DisplayRow {
  name: string;
  value: unknown;
  status: RowStatus;
}

/** Last live snapshot: vars plus the step they came from (for captions). */
export interface LastLive {
  vars: Record<string, unknown>;
  step: number;
}

export interface ResolvedDisplay {
  /** Vars to render (live payload or forward-filled snapshot). */
  vars: Record<string, unknown>;
  /** True when vars are carried (stale) rather than live. */
  carried: boolean;
  /** Step the carried snapshot was taken from (null when live/empty). */
  staleStep: number | null;
  /** `exit` return value (undefined when absent). */
  returnVal: unknown;
  hasReturnVal: boolean;
}

export interface HighlightResult {
  map: Record<string, number>;
  /** Name of the scalar chosen as the highlight source (null when none). */
  source: string | null;
  /** Human-readable caption, e.g. `▸ arr[i=3]` (null when none). */
  caption: string | null;
}

/** Cache key for the per-frame last-live snapshot. */
export function frameKey(func: string, depth: number): string {
  return `${func}@${depth}`;
}

/**
 * Live payload of an event, or null when the event type carries no vars
 * by schema (`iter` / `branch` / `exit`).
 */
export function liveVarsOf(
  event: TraceEvent | null | undefined,
): Record<string, unknown> | null {
  if (event === null || event === undefined) return null;
  switch (event.type) {
    case "state":
      return event.vars;
    case "enter":
      return event.params;
    case "iter":
    case "branch":
    case "exit":
      return null;
    default:
      return assertNever(event);
  }
}

/**
 * Bounded scan-back: nearest `state` / `enter` snapshot at or before
 * `fromStep` (inclusive) with matching `func` + `depth`. Returns null
 * when no live predecessor exists (safe fallback → empty display).
 */
export function findLastLiveSnapshot(
  trace: TraceEvent[],
  fromStep: number,
  func: string,
  depth: number,
): LastLive | null {
  const start = Math.min(fromStep, trace.length - 1);
  for (let i = start; i >= 0; i--) {
    const event = trace[i];
    if (event.func !== func || event.depth !== depth) continue;
    const live = liveVarsOf(event);
    if (live !== null) return { vars: live, step: i };
  }
  return null;
}

/**
 * Per-event-type display rule. `lastLive` is the nearest live snapshot in
 * the current frame (strictly before the current step when the current
 * step is itself live; at-or-before otherwise — the caller decides).
 */
export function resolveDisplayVars(
  currentEvent: TraceEvent,
  lastLive: LastLive | null,
): ResolvedDisplay {
  switch (currentEvent.type) {
    case "state":
      return {
        vars: currentEvent.vars,
        carried: false,
        staleStep: null,
        returnVal: undefined,
        hasReturnVal: false,
      };
    case "enter":
      return {
        vars: currentEvent.params,
        carried: false,
        staleStep: null,
        returnVal: undefined,
        hasReturnVal: false,
      };
    case "iter":
    case "branch":
      if (lastLive === null) {
        return {
          vars: {},
          carried: false,
          staleStep: null,
          returnVal: undefined,
          hasReturnVal: false,
        };
      }
      return {
        vars: lastLive.vars,
        carried: true,
        staleStep: lastLive.step,
        returnVal: undefined,
        hasReturnVal: false,
      };
    case "exit": {
      const returnVal = currentEvent.return_val;
      const hasReturnVal = returnVal !== undefined;
      if (lastLive === null) {
        return {
          vars: {},
          carried: false,
          staleStep: null,
          returnVal,
          hasReturnVal,
        };
      }
      return {
        vars: lastLive.vars,
        carried: true,
        staleStep: lastLive.step,
        returnVal,
        hasReturnVal,
      };
    }
    default:
      return assertNever(currentEvent);
  }
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Row treatments for one render. `display` is the resolved (possibly
 * carried) display; `lastLiveVars` is the last LIVE snapshot strictly
 * before the current step (null when none exists yet); `isLiveStep` is
 * false for carried steps.
 *
 * - carried step → every row dimmed, no badges; plus the `return` row
 *   (marked `added` so the new exit value stays visible).
 * - live step → changed (≠ last-live) / added (absent from last-live) /
 *   removed ghost (in last-live, absent now, exactly one live step —
 *   the next live step adopts current vars as its base) / normal.
 * - live step with no last-live base yet (first live event) → all normal
 *   (nothing is spuriously flagged `added`).
 */
export function computeRowStates(
  display: ResolvedDisplay,
  lastLiveVars: Record<string, unknown> | null,
  isLiveStep: boolean,
): DisplayRow[] {
  const rows: DisplayRow[] = [];

  if (!isLiveStep) {
    for (const [name, value] of Object.entries(display.vars)) {
      rows.push({ name, value, status: "carried" });
    }
    if (display.hasReturnVal) {
      rows.push({ name: "return", value: display.returnVal, status: "added" });
    }
    return rows;
  }

  for (const [name, value] of Object.entries(display.vars)) {
    if (lastLiveVars === null || !(name in lastLiveVars)) {
      rows.push({
        name,
        value,
        status: lastLiveVars === null ? "normal" : "added",
      });
    } else if (!sameJson(lastLiveVars[name], value)) {
      rows.push({ name, value, status: "changed" });
    } else {
      rows.push({ name, value, status: "normal" });
    }
  }

  if (lastLiveVars !== null) {
    for (const [name, value] of Object.entries(lastLiveVars)) {
      if (!(name in display.vars)) {
        rows.push({ name, value, status: "removed" });
      }
    }
  }

  return rows;
}

/**
 * Globals forward-fill (todo 10) — same carried pattern as vars.
 *
 * Globals are captured on `state` steps only (v2 additive `globals` on
 * StateEvent; absent/null on v1 traces), so `enter` / `iter` / `branch` /
 * `exit` steps forward-fill the last-seen snapshot as carried (dimmed via
 * the same RowStatus the vars path uses — VariableRow renders `carried`
 * with no badge, name `text-viz-ink/40`, value `text-viz-ink/60`).
 * Changed-ness is derived exactly like the vars path (JSON.stringify
 * against the last LIVE base), so a changed global flashes `changed` /
 * `added` instead of silently dimming.
 */

/** Last globals snapshot: payload plus the step it came from (caption). */
export interface LastGlobals {
  globals: Record<string, unknown>;
  step: number;
}

export interface ResolvedGlobals {
  /** Globals to render (live payload or forward-filled snapshot). */
  entries: Array<[string, unknown]>;
  /** True when entries are carried (stale) rather than live. */
  carried: boolean;
  /** Step the carried snapshot was taken from (null when live/empty). */
  staleStep: number | null;
}

/** Live globals payload of an event, or null when it carries none. */
function globalsOf(event: TraceEvent): Record<string, unknown> | null {
  if (event.type !== "state") return null;
  const g = event.globals;
  return g != null && typeof g === "object"
    ? (g as Record<string, unknown>)
    : null;
}

/**
 * Bounded scan-back: nearest `state` snapshot at or before `fromStep`
 * (inclusive) carrying a globals object. Returns null when no globals
 * were ever captured (safe fallback → empty display, as before).
 */
export function findLastGlobalsSnapshot(
  trace: TraceEvent[],
  fromStep: number,
): LastGlobals | null {
  const start = Math.min(fromStep, trace.length - 1);
  for (let i = start; i >= 0; i--) {
    const g = globalsOf(trace[i]);
    if (g !== null) return { globals: g, step: i };
  }
  return null;
}

/**
 * Globals display rule. `lastGlobals` is the nearest snapshot at or
 * before the current step (ignored when the current step is itself live
 * — the caller passes null there, mirroring resolveDisplayVars).
 */
export function resolveDisplayGlobals(
  currentEvent: TraceEvent,
  lastGlobals: LastGlobals | null,
): ResolvedGlobals {
  const live = globalsOf(currentEvent);
  if (live !== null) {
    return { entries: Object.entries(live), carried: false, staleStep: null };
  }
  if (lastGlobals === null) {
    return { entries: [], carried: false, staleStep: null };
  }
  return {
    entries: Object.entries(lastGlobals.globals),
    carried: true,
    staleStep: lastGlobals.step,
  };
}

/**
 * Row treatments for the globals section. `display` is the resolved
 * (possibly carried) display; `prevGlobals` is the last LIVE snapshot
 * strictly before the current step (null when none exists yet or when
 * the current step is itself carried); `isLiveStep` is false for
 * carried steps.
 *
 * - carried step → every row `carried` (dimmed, no badges).
 * - live step → changed (≠ last-live) / added (absent from last-live) /
 *   removed ghost / normal — mirroring computeRowStates.
 * - live step with no last-live base yet (first globals capture) → all
 *   normal (nothing spuriously flagged `added`).
 */
export function computeGlobalRowStates(
  display: ResolvedGlobals,
  prevGlobals: Record<string, unknown> | null,
  isLiveStep: boolean,
): DisplayRow[] {
  const rows: DisplayRow[] = [];

  if (!isLiveStep) {
    for (const [name, value] of display.entries) {
      rows.push({ name, value, status: "carried" });
    }
    return rows;
  }

  const current = Object.fromEntries(display.entries);
  for (const [name, value] of display.entries) {
    if (prevGlobals === null || !(name in prevGlobals)) {
      rows.push({
        name,
        value,
        status: prevGlobals === null ? "normal" : "added",
      });
    } else if (!sameJson(prevGlobals[name], value)) {
      rows.push({ name, value, status: "changed" });
    } else {
      rows.push({ name, value, status: "normal" });
    }
  }

  if (prevGlobals !== null) {
    for (const [name, value] of Object.entries(prevGlobals)) {
      if (!(name in current)) {
        rows.push({ name, value, status: "removed" });
      }
    }
  }

  return rows;
}

const INDEX_PREFERENCE: readonly string[] = [
  "mid",
  "lo",
  "hi",
  "i",
  "j",
  "k",
  "left",
  "right",
  "low",
  "high",
  "idx",
  "index",
  "pos",
];

function isTargetArray(value: unknown): value is unknown[] {
  return (
    Array.isArray(value) &&
    !(value.length > 0 && Array.isArray(value[0]))
  );
}

/**
 * Generalised index highlight (spec §c). The first qualifying scalar wins:
 * a finite non-negative integer that is a valid index (`0 ≤ v < length`)
 * into at least one 1D array in scope. The index fans out to every 1D
 * array it is a valid index into (2D arrays excluded, as before).
 * Out-of-range / non-integer / missing scalars qualify nothing.
 */
export function buildHighlightMap(
  vars: Record<string, unknown>,
): HighlightResult {
  const empty: HighlightResult = { map: {}, source: null, caption: null };
  const arrays: Array<[string, unknown[]]> = [];
  for (const [name, value] of Object.entries(vars)) {
    if (isTargetArray(value)) arrays.push([name, value]);
  }
  if (arrays.length === 0) return empty;

  const preferred = INDEX_PREFERENCE.filter((name) =>
    Object.hasOwn(vars, name),
  );
  const rest = Object.keys(vars)
    .filter((name) => !INDEX_PREFERENCE.includes(name))
    .sort();
  for (const name of [...preferred, ...rest]) {
    const v = vars[name];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) continue;
    const targets = arrays.filter(([, arr]) => v < arr.length);
    if (targets.length === 0) continue;
    const map: Record<string, number> = {};
    for (const [arrName] of targets) map[arrName] = v;
    return {
      map,
      source: name,
      caption: `▸ ${targets[0][0]}[${name}=${v}]`,
    };
  }
  return empty;
}
