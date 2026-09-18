/**
 * tests/dp-overlay.test.ts — dp_table overlay from algorithm context (todo 6).
 *
 * Run (no new deps — repo has no vitest; esbuild ships inside vite):
 *   node node_modules/esbuild/bin/esbuild tests/dp-overlay.test.ts --bundle \
 *     --platform=node --format=cjs --jsx=automatic --loader:.css=empty \
 *     --define:import.meta.env='{}' \
 *     --outfile=/tmp/dp-overlay.test.cjs --log-level=error \
 *   && node --test /tmp/dp-overlay.test.cjs
 * (format MUST be cjs: react-dom/server does require("util") internally,
 * which an esm bundle cannot satisfy — "Dynamic require not supported".)
 *
 * (Bare `npx tsc ... && node --test` cannot be used here: the registry
 * import graph pulls .tsx visuals, a .css import via GraphAlgorithmVisual,
 * and vite-only `import.meta.env` — all handled by the esbuild flags above.
 * React.createElement (no-JSX) style is kept in THIS file so no jsx config
 * beyond the bundler flag is needed for the test body itself.)
 *
 * RED on pre-todo-6 tree: useContainerType takes a single arg, so the DP
 * slug is ignored — the LIS row routes "vector" (not "dp_table"), the plain
 * 2D array routes "grid" (not "dp_table"), and useUIStore has no
 * setActiveSlug (store-level TypeError). The non-DP / null-slug / jagged /
 * unknown-slug assertions already pass on HEAD by design (fail-closed guards
 * documenting today's behavior that must not change).
 *
 * GREEN: LIS row under a DP slug routes "dp_table"; the SAME payload under
 * a non-DP slug, a null slug, or no slug keeps "vector"; plain 2D number
 * arrays route "dp_table" only under a DP slug; jagged arrays still route
 * "graph" even under a DP slug; unknown slugs fail closed to vector/grid;
 * the store persists the slug set at click time (survives Visualize -> `/`
 * navigation, which drops the URL slug).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useContainerType } from "../src/hooks/useContainerType";
import { VISUAL_REGISTRY } from "../src/components/ContainerVisuals/registry";
import { DPTableVisual } from "../src/components/ContainerVisuals/DPTableVisual";
import { VectorVisual } from "../src/components/ContainerVisuals/VectorVisual";
import { useUIStore } from "../src/store/uiStore";

/** Exact algorithm slug (algorithms.ts:732) for the LIS guide. */
const DP_SLUG = "longest-increasing-subsequence";
/** Exact algorithm slug (algorithms.ts:63) — no DP semantics. */
const NON_DP_SLUG = "binary-search";
/** No guide carries this slug — must fail closed. */
const UNKNOWN_SLUG = "not-a-real-algorithm";

/** LIS DP row as the tracer serializes a bare vector<int>. */
function lisRow(): number[] {
  return [1, 3, 2, 4, 5];
}

/** Plain (rectangular) 2D number array. */
function plainGrid(): number[][] {
  return [
    [1, 2],
    [3, 4],
  ];
}

/** Jagged adjacency-list shape — must stay graph under ANY slug. */
function jagged(): number[][] {
  return [[1, 2, 3], [4], [5, 6]];
}

describe("dp overlay routing (1D)", () => {
  it("positive: LIS row under DP slug routes to dp_table", () => {
    assert.equal(useContainerType(lisRow(), DP_SLUG), "dp_table");
  });

  it("dual: SAME payload under non-DP slug keeps vector", () => {
    assert.equal(useContainerType(lisRow(), NON_DP_SLUG), "vector");
  });

  it("baseline: null slug (direct navigation) behaves exactly as today", () => {
    assert.equal(useContainerType(lisRow(), null), "vector");
    assert.equal(useContainerType(lisRow(), null), useContainerType(lisRow()));
  });

  it("baseline: omitted slug behaves exactly as today", () => {
    assert.equal(useContainerType(lisRow()), "vector");
  });

  it("fail closed: unknown slug keeps vector", () => {
    assert.equal(useContainerType(lisRow(), UNKNOWN_SLUG), "vector");
  });

  it("precision: non-integer 1D arrays stay vector even under DP slug", () => {
    assert.equal(useContainerType([1.5, 2.5], DP_SLUG), "vector");
    assert.equal(useContainerType(["a", "b"], DP_SLUG), "vector");
  });

  it("precision: empty array stays vector even under DP slug", () => {
    assert.equal(useContainerType([], DP_SLUG), "vector");
  });
});

describe("dp overlay routing (2D)", () => {
  it("positive: plain 2D numbers under DP slug route to dp_table", () => {
    assert.equal(useContainerType(plainGrid(), DP_SLUG), "dp_table");
  });

  it("dual: SAME payload under non-DP slug keeps grid", () => {
    assert.equal(useContainerType(plainGrid(), NON_DP_SLUG), "grid");
  });

  it("baseline: null slug keeps grid", () => {
    assert.equal(useContainerType(plainGrid(), null), "grid");
  });

  it("must-not-alter: jagged under DP slug still routes graph", () => {
    assert.equal(useContainerType(jagged(), DP_SLUG), "graph");
  });

  it("must-not-alter: jagged under non-DP slug still routes graph", () => {
    assert.equal(useContainerType(jagged(), NON_DP_SLUG), "graph");
  });

  it("fail closed: unknown slug keeps grid", () => {
    assert.equal(useContainerType(plainGrid(), UNKNOWN_SLUG), "grid");
  });
});

describe("dp overlay slug persistence (store-level)", () => {
  it("set-then-read survives after the setter call (navigation-safe)", () => {
    // Simulates click-time set (Algorithms/Visualize handleTryIt store the
    // slug alongside setCode BEFORE navigate("/"), which drops the URL slug).
    useUIStore.getState().setActiveSlug("coin-change");
    assert.equal(useUIStore.getState().activeSlug, "coin-change");
    useUIStore.getState().setActiveSlug(null);
    assert.equal(useUIStore.getState().activeSlug, null);
  });
});

describe("dp overlay static markup (manual-QA artifact)", () => {
  it("registry dp_table renders dp-cells with a current_cell marker", () => {
    const html = renderToStaticMarkup(
      React.createElement(VISUAL_REGISTRY.dp_table, {
        value: {
          _type: "dp_table",
          data: [lisRow()],
          current_cell: [0, 2],
        },
        name: "dp",
      }),
    );
    assert.match(html, /data-testid="dp-cell"/);
    assert.match(html, /data-current="true"/);
  });

  it("bare LIS row renders as 1xN dp-cells through DPTableVisual", () => {
    const html = renderToStaticMarkup(
      React.createElement(DPTableVisual, { value: lisRow(), name: "dp" }),
    );
    assert.match(html, /data-testid="dp-cell"/);
  });

  it("same LIS row through VectorVisual renders no dp-cells", () => {
    const html = renderToStaticMarkup(
      React.createElement(VectorVisual, { value: lisRow(), name: "dp" }),
    );
    assert.doesNotMatch(html, /data-testid="dp-cell"/);
  });
});
