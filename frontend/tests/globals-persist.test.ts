/**
 * tests/globals-persist.test.ts — globals visible on non-state steps (todo 10).
 *
 * Run (no new deps — repo has no vitest; esbuild ships inside vite):
 *   node node_modules/esbuild/bin/esbuild tests/globals-persist.test.ts --bundle \
 *     --platform=node --format=cjs --jsx=automatic --loader:.css=empty \
 *     --define:import.meta.env='{}' \
 *     --outfile=/tmp/globals-persist.test.cjs --log-level=error \
 *   && node --test /tmp/globals-persist.test.cjs
 * (format MUST be cjs: react-dom/server does require("util") internally,
 * which an esm bundle cannot satisfy — "Dynamic require not supported".
 * Run from frontend/ so the StatePanel.tsx source read below resolves.)
 *
 * SEAM (task-8 SSR finding applies here too): StatePanel reads everything
 * from the zustand traceStore, and zustand v5 wires useSyncExternalStore
 * with getServerSnapshot = selector(getInitialState()) — under
 * renderToStaticMarkup React ALWAYS uses the server snapshot, i.e. the
 * EMPTY initial store, so the panel renders "Run a program..." no matter
 * what loadTrace/setStep did beforehand. No jsdom in repo, no new deps
 * allowed. The spec therefore pins the fix at two seams:
 *   (1) pure helpers in scopeDisplay.ts — findLastGlobalsSnapshot /
 *       resolveDisplayGlobals / computeGlobalRowStates (mirrors the vars
 *       carried pattern: resolveDisplayVars + computeRowStates);
 *   (2) source wiring — StatePanel's globals region must forward-fill via
 *       those helpers and pass per-row status (not hardcoded "normal");
 *   (3) row behavior — a VariableRow with the carried/changed statuses
 *       renders the exact dimmed/flash treatments.
 *
 * RED on pre-todo-10 tree: helpers do not exist (TypeError), the globals
 * gating is `currentEvent.type === "state"` so iter/branch/exit steps
 * render zero globals (flicker), and globals rows hardcode
 * status="normal" so a changed global never flashes.
 *
 * GREEN: globals persist dimmed (carried) across iter/branch/exit steps;
 * changed globals flash as new (changed/added); state steps with
 * unchanged globals stay normal; empty-globals traces render as before
 * (section hidden).
 *
 * Manual-QA fixture table (loop trace, globals g):
 *   step 0 enter                          -> no globals section (no prior)
 *   step 1 state  globals {g:1}           -> g=1 live, normal
 *   step 2 iter                           -> g=1 carried (dimmed)
 *   step 3 branch                         -> g=1 carried (dimmed)
 *   step 4 state  globals {g:1}           -> g=1 live, normal (no flash)
 *   step 5 iter                           -> g=1 carried (dimmed)
 *   step 6 state  globals {g:2}           -> g=2 live, CHANGED (flash)
 *   step 7 exit                           -> g=2 carried (dimmed)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  computeGlobalRowStates,
  findLastGlobalsSnapshot,
  resolveDisplayGlobals,
} from "../src/utils/scopeDisplay";
import type { TraceEvent } from "../src/types/trace";
import { VariableRow } from "../src/components/StatePanel/VariableRow";

/** Loop trace with a single global g; see fixture table in header. */
const TRACE: TraceEvent[] = [
  { type: "enter", line: 1, func: "main", depth: 1, params: {} },
  {
    type: "state",
    line: 2,
    func: "main",
    depth: 1,
    vars: { i: 0 },
    globals: { g: 1 },
  },
  { type: "iter", line: 2, func: "main", depth: 1, iteration: 1 },
  {
    type: "branch",
    line: 2,
    func: "main",
    depth: 1,
    condition: "i < 3",
    taken: true,
  },
  {
    type: "state",
    line: 2,
    func: "main",
    depth: 1,
    vars: { i: 1 },
    globals: { g: 1 },
  },
  { type: "iter", line: 2, func: "main", depth: 1, iteration: 2 },
  {
    type: "state",
    line: 2,
    func: "main",
    depth: 1,
    vars: { i: 2 },
    globals: { g: 2 },
  },
  { type: "exit", line: 4, func: "main", depth: 1, return_val: 3 },
];

/** Resolve + status the globals at one step, mirroring the panel wiring. */
function globalsAt(step: number): Map<string, string> {
  const event = TRACE[step];
  const live =
    event.type === "state" &&
    event.globals != null &&
    typeof event.globals === "object";
  const last = findLastGlobalsSnapshot(TRACE, live ? step - 1 : step);
  const prev = findLastGlobalsSnapshot(TRACE, step - 1);
  const display = resolveDisplayGlobals(event, live ? null : last);
  const rows = computeGlobalRowStates(
    display,
    live ? (prev?.globals ?? null) : null,
    live,
  );
  return new Map(rows.map((r) => [r.name, r.status]));
}

describe("globals forward-fill (loop-trace fixture)", () => {
  it("iter step carries last-seen globals as carried (dimmed)", () => {
    assert.deepEqual(globalsAt(2), new Map([["g", "carried"]]));
  });

  it("branch step carries last-seen globals as carried (dimmed)", () => {
    assert.deepEqual(globalsAt(3), new Map([["g", "carried"]]));
  });

  it("exit step carries last-seen globals as carried (dimmed)", () => {
    assert.deepEqual(globalsAt(7), new Map([["g", "carried"]]));
  });

  it("unchanged globals on a state step stay normal (no flash)", () => {
    assert.deepEqual(globalsAt(4), new Map([["g", "normal"]]));
  });

  it("changed globals on a state step flash as changed", () => {
    assert.deepEqual(globalsAt(6), new Map([["g", "changed"]]));
  });

  it("first live globals step is normal (no spurious added)", () => {
    const event = TRACE[1];
    const display = resolveDisplayGlobals(event, null);
    assert.equal(display.carried, false);
    const rows = computeGlobalRowStates(display, null, true);
    assert.deepEqual(
      rows.map((r) => [r.name, r.status]),
      [["g", "normal"]],
    );
  });

  it("added global on a state step flashes as added", () => {
    // G fixture: live {g:2, h:9} against prev base {g:2} -> g normal,
    // h added (mirrors computeRowStates added semantics).
    const withNew = resolveDisplayGlobals(
      {
        type: "state",
        line: 2,
        func: "main",
        depth: 1,
        vars: {},
        globals: { g: 2, h: 9 },
      },
      null,
    );
    const addedRows = computeGlobalRowStates(withNew, { g: 2 }, true);
    assert.deepEqual(
      new Map(addedRows.map((r) => [r.name, r.status])),
      new Map([
        ["g", "normal"],
        ["h", "added"],
      ]),
    );
  });

  it("empty-globals traces resolve empty (section stays hidden, as before)", () => {
    const bare: TraceEvent[] = [
      { type: "enter", line: 1, func: "main", depth: 1, params: {} },
      { type: "state", line: 2, func: "main", depth: 1, vars: { i: 0 } },
      { type: "iter", line: 2, func: "main", depth: 1, iteration: 1 },
      { type: "exit", line: 4, func: "main", depth: 1, return_val: 0 },
    ];
    for (let step = 0; step < bare.length; step++) {
      const event = bare[step];
      const live =
        event.type === "state" &&
        "globals" in event &&
        event.globals != null &&
        typeof event.globals === "object";
      assert.equal(live, false, `step ${step} must have no live globals`);
      const last = findLastGlobalsSnapshot(bare, step);
      assert.equal(last, null, `step ${step} must have no carried globals`);
      const display = resolveDisplayGlobals(event, last);
      assert.deepEqual(display.entries, []);
      assert.equal(display.carried, false);
    }
  });

  it("enter step with no prior globals resolves empty", () => {
    const last = findLastGlobalsSnapshot(TRACE, 0);
    assert.equal(last, null);
    const display = resolveDisplayGlobals(TRACE[0], last);
    assert.deepEqual(display.entries, []);
  });
});

describe("StatePanel globals wiring (source pins)", () => {
  const candidates = [
    join(process.cwd(), "src/components/StatePanel/StatePanel.tsx"),
    join(process.cwd(), "frontend/src/components/StatePanel/StatePanel.tsx"),
  ];
  const found = candidates.find((p) => existsSync(p));
  assert.ok(
    found,
    `StatePanel.tsx not found; run from frontend/ (tried ${candidates.join(", ")})`,
  );
  const src = readFileSync(found, "utf8");
  // Scoped to the globals region only (task-8's caller-frame
  // `status="normal"` below must NOT match).
  const globalsBlock = src.slice(
    src.indexOf("liveGlobals"),
    src.indexOf("{/* Per-frame var tables"),
  );

  it("globals gating is not state-only (forward-fills control steps)", () => {
    assert.match(globalsBlock, /findLastGlobalsSnapshot/);
    assert.match(globalsBlock, /resolveDisplayGlobals/);
    // Old render path rendered the live payload directly (flicker on
    // control steps); the forward-filled display must replace it.
    assert.doesNotMatch(globalsBlock, /Object\.entries\(currentEvent\.globals\)/);
  });

  it("globals rows use per-row status (changed still flashes, carried dims)", () => {
    assert.match(globalsBlock, /computeGlobalRowStates/);
    assert.match(globalsBlock, /status=\{[^}]*\.status\}/);
    assert.doesNotMatch(globalsBlock, /status="normal"/);
  });
});

describe("globals row treatments (mirror vars-carried convention)", () => {
  // Convention mirrored from VariableRow.tsx ROW_STYLE / VALUE_STYLE:
  // carried -> VALUE_STYLE "text-viz-ink/60", name "text-viz-ink/40", no
  // badge; changed -> row "bg-amber-500/15" + "changed" badge.
  it("carried global renders dimmed with no badge", () => {
    const html = renderToStaticMarkup(
      React.createElement(VariableRow, {
        name: "g",
        value: 1,
        status: "carried",
      }),
    );
    assert.match(html, /text-viz-ink\/40/);
    assert.match(html, /text-viz-ink\/60/);
    assert.doesNotMatch(html, /changed/);
    assert.doesNotMatch(html, />new</);
  });

  it("changed global renders amber flash with changed badge", () => {
    const html = renderToStaticMarkup(
      React.createElement(VariableRow, {
        name: "g",
        value: 2,
        status: "changed",
      }),
    );
    assert.match(html, /bg-amber-500\/15/);
    assert.match(html, /changed/);
  });
});
