/**
 * tests/scopeDisplay.test.ts — R5/R6 behavior locks.
 *
 * Run: npx tsc tests/scopeDisplay.test.ts src/utils/scopeDisplay.ts
 *   src/types/trace.ts --outDir /tmp/sdtest --module commonjs
 *   --target es2022 --moduleResolution node --skipLibCheck --strict \
 *   && node --test /tmp/sdtest/tests/scopeDisplay.test.js
 *
 * Fixture mirrors createForLoopNDJSON in ./mockData:
 * 0 enter, 1 state(i=0), 2 iter, 3 state(i=1), 4 iter,
 * 5 state(i=2, tmp removed, arr mutated), 6 exit(return 3).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildHighlightMap,
  computeRowStates,
  findLastLiveSnapshot,
  resolveDisplayVars,
} from "../src/utils/scopeDisplay";
import type { TraceEvent } from "../src/types/trace";

const TRACE: TraceEvent[] = [
  { type: "enter", line: 1, func: "main", depth: 1, params: {} },
  {
    type: "state",
    line: 2,
    func: "main",
    depth: 1,
    vars: { arr: [10, 20, 30], i: 0, tmp: 10 },
  },
  { type: "iter", line: 2, func: "main", depth: 1, iteration: 1 },
  {
    type: "state",
    line: 2,
    func: "main",
    depth: 1,
    vars: { arr: [10, 20, 30], i: 1, tmp: 20 },
  },
  { type: "iter", line: 2, func: "main", depth: 1, iteration: 2 },
  {
    type: "state",
    line: 3,
    func: "main",
    depth: 1,
    vars: { arr: [10, 99, 30], i: 2 },
  },
  { type: "exit", line: 4, func: "main", depth: 1, return_val: 3 },
];

function statusOf(step: number): Map<string, string> {
  const event = TRACE[step];
  const isLive = event.type === "state" || event.type === "enter";
  const lastLive = findLastLiveSnapshot(
    TRACE,
    isLive ? step - 1 : step,
    event.func,
    event.depth,
  );
  const display = resolveDisplayVars(event, isLive ? null : lastLive);
  const rows = computeRowStates(display, lastLive?.vars ?? null, isLive);
  return new Map(rows.map((r) => [r.name, r.status]));
}

describe("resolveDisplayVars (R5 forward-fill)", () => {
  it("iter renders carried vars with stale flag (M1 falsifier inverted)", () => {
    const lastLive = findLastLiveSnapshot(TRACE, 2, "main", 1);
    assert.deepEqual(lastLive, {
      vars: { arr: [10, 20, 30], i: 0, tmp: 10 },
      step: 1,
    });
    const display = resolveDisplayVars(TRACE[2], lastLive);
    assert.deepEqual(display.vars, { arr: [10, 20, 30], i: 0, tmp: 10 });
    assert.equal(display.carried, true);
    assert.equal(display.staleStep, 1);
  });

  it("iter with no live predecessor falls back to empty (not carried)", () => {
    const display = resolveDisplayVars(TRACE[2], null);
    assert.deepEqual(display.vars, {});
    assert.equal(display.carried, false);
  });

  it("exit shows exiting frame carried plus return_val row", () => {
    const lastLive = findLastLiveSnapshot(TRACE, 6, "main", 1);
    assert.equal(lastLive?.step, 5);
    const display = resolveDisplayVars(TRACE[6], lastLive);
    assert.equal(display.carried, true);
    assert.equal(display.hasReturnVal, true);
    assert.equal(display.returnVal, 3);
    const rows = computeRowStates(display, null, false);
    const byName = new Map(rows.map((r) => [r.name, r.status]));
    assert.equal(byName.get("return"), "added");
    assert.equal(byName.get("i"), "carried");
  });

  it("scan-back stays within func+depth", () => {
    const other: TraceEvent[] = [
      { type: "enter", line: 1, func: "f", depth: 2, params: { z: 9 } },
      ...TRACE,
    ];
    const found = findLastLiveSnapshot(other, 3, "main", 1);
    assert.equal(found?.step, 2);
  });
});

describe("computeRowStates (R6 treatments)", () => {
  it("flash fires on true mutation across a blank gap, stays silent on hold", () => {
    const held = statusOf(3);
    assert.equal(held.get("i"), "changed");
    assert.equal(held.get("tmp"), "changed");
    assert.equal(held.get("arr"), "normal");

    const gap = statusOf(5);
    assert.equal(gap.get("arr"), "changed");
    assert.equal(gap.get("i"), "changed");
  });

  it("carried steps never flash", () => {
    for (const step of [2, 4]) {
      const statuses = statusOf(step);
      for (const status of statuses.values()) {
        assert.equal(status, "carried");
      }
    }
  });

  it("ghost removed row appears for exactly one live step", () => {
    assert.equal(statusOf(5).get("tmp"), "removed");
    const nextLive = findLastLiveSnapshot(TRACE, 5, "main", 1);
    const rows = computeRowStates(
      {
        vars: { arr: [10, 99, 30], i: 2 },
        carried: false,
        staleStep: null,
        returnVal: undefined,
        hasReturnVal: false,
      },
      nextLive?.vars ?? null,
      true,
    );
    assert.ok(!rows.some((r) => r.name === "tmp"));
  });

  it("added name flags new for exactly one live step", () => {
    assert.equal(statusOf(1).get("arr"), "added");
    assert.equal(statusOf(3).get("arr"), "normal");
  });
});

describe("buildHighlightMap (R6 highlight)", () => {
  it("i-indexed vector highlights with caption", () => {
    const vars = { arr: [10, 20, 30], i: 1 };
    const result = buildHighlightMap(vars);
    assert.deepEqual(result.map, { arr: 1 });
    assert.equal(result.source, "i");
    assert.equal(result.caption, "▸ arr[i=1]");
  });

  it("mid keeps preference over i", () => {
    const vars = { arr: [1, 3, 5, 7, 9], mid: 2, i: 0 };
    const result = buildHighlightMap(vars);
    assert.deepEqual(result.map, { arr: 2 });
    assert.equal(result.source, "mid");
  });

  it("2D arrays are excluded; out-of-range qualifies nothing", () => {
    assert.deepEqual(
      buildHighlightMap({ board: [[1, 0], [0, 1]], i: 0 }).map,
      {},
    );
    assert.deepEqual(buildHighlightMap({ arr: [1, 2], i: 7 }).map, {});
    assert.deepEqual(buildHighlightMap({ arr: [1, 2], i: -1 }).map, {});
  });
});
