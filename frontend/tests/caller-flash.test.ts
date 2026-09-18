/**
 * tests/caller-flash.test.ts — heap flash in caller frames (todo 8).
 *
 * Run (no new deps — repo has no vitest; esbuild ships inside vite):
 *   node node_modules/esbuild/bin/esbuild tests/caller-flash.test.ts --bundle \
 *     --platform=node --format=cjs --jsx=automatic --loader:.css=empty \
 *     --define:import.meta.env='{}' \
 *     --outfile=/tmp/caller-flash.test.cjs --log-level=error \
 *   && node --test /tmp/caller-flash.test.cjs
 * (format MUST be cjs: react-dom/server does require("util") internally,
 * which an esm bundle cannot satisfy — "Dynamic require not supported".
 * Run from frontend/ so the StatePanel.tsx source read below resolves.)
 *
 * (Bare `npx tsc ... && node --test` cannot be used here: the VariableRow
 * import graph pulls .tsx visuals, a .css import via GraphAlgorithmVisual,
 * and vite-only `import.meta.env` — all handled by the esbuild flags above.
 * React.createElement (no-JSX) style is kept in THIS file so no jsx config
 * beyond the bundler flag is needed for the test body itself.)
 *
 * WHY NOT render StatePanel directly: StatePanel reads everything from the
 * zustand traceStore, and zustand v5 wires useSyncExternalStore with
 * getServerSnapshot = selector(getInitialState()) — under
 * renderToStaticMarkup React ALWAYS uses the server snapshot, i.e. the
 * EMPTY initial store, so the panel renders "Run a program..." no matter
 * what loadTrace/setStep did beforehand (verified with a probe: getState()
 * shows the loaded event while a subscribed component renders NULL).
 * No jsdom/happy-dom is installed and no new deps are allowed, so
 * client-rendering is out. The spec therefore pins the fix at its two
 * observable seams:
 *   (1) source wiring — the VariableRow inside StatePanel's caller
 *       `frameEntries.map` must receive heap/heapDiff/prevValue/
 *       highlightIndex (fails on HEAD = RED, passes after = GREEN);
 *   (2) row behavior — a VariableRow with the caller-frame prop set
 *       flashes the mutated node exactly once and stays silent otherwise.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VariableRow } from "../src/components/StatePanel/VariableRow";
import { SameObjectRef } from "../src/components/StatePanel/StatePanel";
import { isHeapFlash } from "../src/utils/heapFlash";

const ADDR_HEAD = "0xAAA111";
const ADDR_MID = "0xBBB222";
const ADDR_TAIL = "0xCCC333";

/** 3-node singly-linked list; the middle node is the mutated one. */
function threeNodeList(headId: number) {
  return {
    $id: headId,
    $addr: ADDR_HEAD,
    val: 10,
    next: {
      $addr: ADDR_MID,
      val: 20,
      next: { $addr: ADDR_TAIL, val: 30, next: null },
    },
  };
}

/** Heap table + diff for the nested-trace fixture (middle node mutated). */
function heapProps() {
  return {
    heap: {
      "1": { addr: ADDR_HEAD },
      "2": { addr: ADDR_MID },
      "3": { addr: ADDR_TAIL },
      "9": { addr: ADDR_HEAD },
      "10": { addr: ADDR_MID },
      "11": { addr: ADDR_TAIL },
    } as Record<string, unknown>,
    heapDiff: { added: [], removed: [], mutated: ["2", "10"], changed_fields: {} },
  };
}

/** Locate the StatePanel.tsx source from the test cwd (frontend/). */
function statePanelSource(): string {
  const candidates = [
    join(process.cwd(), "src/components/StatePanel/StatePanel.tsx"),
    join(process.cwd(), "frontend/src/components/StatePanel/StatePanel.tsx"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p, "utf8");
  }
  throw new Error(
    `StatePanel.tsx not found; run from frontend/ (tried ${candidates.join(", ")})`,
  );
}

/**
 * The caller-frame VariableRow block: the <VariableRow> rendered inside
 * `frameEntries.map` (as opposed to the current-frame `rows.map` and the
 * flat-list fallback). Fails loudly if the structure ever drifts.
 */
function callerRowBlock(src: string): string {
  const mapIdx = src.indexOf("frameEntries.map(");
  assert.ok(mapIdx !== -1, "caller frameEntries.map block must exist");
  const rowIdx = src.indexOf("<VariableRow", mapIdx);
  assert.ok(rowIdx !== -1, "caller frame must render a <VariableRow");
  const endIdx = src.indexOf("/>", rowIdx);
  assert.ok(endIdx !== -1, "caller <VariableRow must be self-closed");
  return src.slice(rowIdx, endIdx);
}

function countFlash(html: string): number {
  return html.split('data-ll-highlight="true"').length - 1;
}

describe("caller-frame heap flash wiring (StatePanel source)", () => {
  it("caller-frame VariableRows receive heap (RED on HEAD)", () => {
    assert.match(callerRowBlock(statePanelSource()), /heap=\{heap\}/);
  });

  it("caller-frame VariableRows receive heapDiff (RED on HEAD)", () => {
    assert.match(callerRowBlock(statePanelSource()), /heapDiff=\{heapDiff\}/);
  });

  it("caller-frame VariableRows receive prevValue (RED on HEAD)", () => {
    assert.match(callerRowBlock(statePanelSource()), /prevValue=/);
  });

  it("caller-frame VariableRows receive highlightIndex (RED on HEAD)", () => {
    assert.match(callerRowBlock(statePanelSource()), /highlightIndex=/);
  });

  it("HeapPanel data derivation untouched (no new heap props computed)", () => {
    const src = statePanelSource();
    assert.ok(!src.includes("buildHeap"), "no new heap derivation helper");
  });
});

describe("caller-frame heap flash behavior (VariableRow markup)", () => {
  it("baseline: current-frame prop set flashes the mutated node", () => {
    const { heap, heapDiff } = heapProps();
    const html = renderToStaticMarkup(
      React.createElement(VariableRow, {
        name: "head",
        value: threeNodeList(9),
        status: "changed",
        heap,
        heapDiff,
        prevValue: undefined,
      }),
    );
    assert.equal(countFlash(html), 1);
  });

  it("RED control: pre-fix caller props (no heap wiring) show NO flash", () => {
    const html = renderToStaticMarkup(
      React.createElement(VariableRow, {
        name: "list",
        value: threeNodeList(1),
        status: "normal",
      }),
    );
    assert.equal(countFlash(html), 0);
  });

  it("caller-frame prop set flashes the mutated node (GREEN after fix)", () => {
    const { heap, heapDiff } = heapProps();
    const html = renderToStaticMarkup(
      React.createElement(VariableRow, {
        name: "list",
        value: threeNodeList(1),
        status: "normal",
        highlightIndex: undefined,
        heap,
        heapDiff,
        prevValue: undefined,
      }),
    );
    assert.equal(countFlash(html), 1);
  });

  it("non-mutated nodes stay unhighlighted in the caller row", () => {
    const { heap, heapDiff } = heapProps();
    const html = renderToStaticMarkup(
      React.createElement(VariableRow, {
        name: "list",
        value: threeNodeList(1),
        status: "normal",
        heap,
        heapDiff,
        prevValue: undefined,
      }),
    );
    // Exactly the mutated middle node's rect flashes; head + tail keep
    // the default stroke.
    assert.equal(html.split("stroke-amber-400").length - 1, 1);
  });

  it("undefined heap/heapDiff renders without flash and without throwing", () => {
    const html = renderToStaticMarkup(
      React.createElement(VariableRow, {
        name: "list",
        value: threeNodeList(1),
        status: "normal",
        highlightIndex: undefined,
        heap: undefined,
        heapDiff: undefined,
        prevValue: undefined,
      }),
    );
    assert.match(html, /singly-linked list/);
    assert.equal(countFlash(html), 0);
  });
});

/**
 * The dedup (`same-object-ref`) branch: the `if (owner)` block inside
 * `frameEntries.map`, i.e. everything before the caller <VariableRow.
 * On the REALISTIC shape (__heap_ids is a void*-keyed global map, so the
 * same heap object carries the SAME $id in every frame) the caller row
 * ALWAYS dedups — the wired VariableRow above never executes there.
 */
function ownerBranchBlock(src: string): string {
  const mapIdx = src.indexOf("frameEntries.map(");
  assert.ok(mapIdx !== -1, "caller frameEntries.map block must exist");
  const ownerIdx = src.indexOf("if (owner)", mapIdx);
  assert.ok(ownerIdx !== -1, "dedup `if (owner)` branch must exist");
  const rowIdx = src.indexOf("<VariableRow", mapIdx);
  assert.ok(rowIdx !== -1, "caller frame must render a <VariableRow");
  assert.ok(ownerIdx < rowIdx, "dedup branch must precede the caller row");
  return src.slice(ownerIdx, rowIdx);
}

describe("realistic shared-$id dedup flash (StatePanel source)", () => {
  it("dedup branch consults heap mutation state (RED: never flashes)", () => {
    assert.match(ownerBranchBlock(statePanelSource()), /isHeapFlash/);
  });

  it("dedup branch renders observable flash markup (RED: never flashes)", () => {
    const src = statePanelSource();
    assert.match(ownerBranchBlock(src), /flashing=\{isHeapFlash/);
    assert.match(src, /data-testid="same-object-ref"[\s\S]{0,200}data-flash/);
  });

  it("dedup matching semantics untouched (owner search still $id-based)", () => {
    const src = statePanelSource();
    const mapIdx = src.indexOf("frameEntries.map(");
    const rowIdx = src.indexOf("<VariableRow", mapIdx);
    const region = src.slice(mapIdx, rowIdx);
    assert.match(region, /collectIdentityIds/);
    assert.match(ownerBranchBlock(src), /SameObjectRef/);
  });

  it("dedup branch passes the value ids with in-scope heapDiff", () => {
    assert.match(
      ownerBranchBlock(statePanelSource()),
      /isHeapFlash\(ids, heapDiff\?\.mutated\)/,
    );
  });
});

describe("isHeapFlash helper", () => {
  it("true on $id overlap (mutated object referenced by the row)", () => {
    assert.equal(isHeapFlash(["1", "2", "3"], ["2"]), true);
  });

  it("false on disjoint sets (non-mutated dedup stays silent)", () => {
    assert.equal(isHeapFlash(["1", "2"], ["99"]), false);
  });

  it("false on empty ids, null/undefined/empty mutated", () => {
    assert.equal(isHeapFlash([], ["2"]), false);
    assert.equal(isHeapFlash(["1"], null), false);
    assert.equal(isHeapFlash(["1"], undefined), false);
    assert.equal(isHeapFlash(["1"], []), false);
  });

  it("strict string compare: numeric 2 never matches string '2'", () => {
    assert.equal(isHeapFlash(["2"], ["2"]), true);
    assert.equal(isHeapFlash(["2"], [2] as unknown as string[]), false);
  });
});

describe("realistic shared-$id dedup flash markup (SameObjectRef)", () => {
  it("mutated shared object: dedup line flashes", () => {
    const html = renderToStaticMarkup(
      React.createElement(SameObjectRef, {
        name: "list",
        ownerFunc: "insert",
        flashing: isHeapFlash(["1", "2"], ["2", "10"]),
      }),
    );
    assert.match(html, /list: same object as insert\(\)/);
    assert.match(html, /data-flash="true"/);
    assert.match(html, /245, 158, 11/);
  });

  it("non-mutated shared object: dedup line renders exactly as before", () => {
    const html = renderToStaticMarkup(
      React.createElement(SameObjectRef, {
        name: "list",
        ownerFunc: "insert",
        flashing: isHeapFlash(["1", "2"], ["99"]),
      }),
    );
    assert.match(html, /list: same object as insert\(\)/);
    assert.ok(!html.includes("data-flash"), "silent line carries no flash attr");
    assert.ok(!html.includes("style="), "silent line carries no flash style");
  });
});
