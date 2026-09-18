/**
 * tests/tree-routing.test.ts — tree-shaped struct routing lock (todo 2).
 *
 * Run (no new deps — repo has no vitest; esbuild ships inside vite):
 *   node node_modules/esbuild/bin/esbuild tests/tree-routing.test.ts --bundle \
 *     --platform=node --format=cjs --jsx=automatic --loader:.css=empty \
 *     --define:import.meta.env='{}' \
 *     --outfile=/tmp/tree-routing.test.cjs --log-level=error \
 *   && node --test /tmp/tree-routing.test.cjs
 * (format MUST be cjs: react-dom/server does require("util") internally,
 * which an esm bundle cannot satisfy — "Dynamic require not supported".)
 *
 * (Bare `npx tsc ... && node --test` cannot be used here: the registry
 * import graph pulls .tsx visuals, a .css import via GraphAlgorithmVisual,
 * and vite-only `import.meta.env` — all handled by the esbuild flags above.
 * React.createElement (no-JSX) style is kept in THIS file so no jsx config
 * beyond the bundler flag is needed for the test body itself.)
 *
 * RED on pre-todo-2 tree: a BST TreeNode ({val,left,right} pointer-shaped)
 * routes to "struct" → PrimitiveFallback, even though StructGraphVisual
 * already renders trees — nothing routes to it.
 *
 * GREEN: tight predicate routes pointer-shaped left+right + scalar label
 * to "tree"; bare numeric pairs fail closed to struct/map (never tree).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useContainerType } from "../src/hooks/useContainerType";
import { VISUAL_REGISTRY } from "../src/components/ContainerVisuals/registry";
import {
  PrimitiveFallback,
  TreeAdapter,
} from "../src/components/ContainerVisuals/registryComponents";

/** 3-node BST as serializer_gen _emit_struct emits it: $id+$addr+fields. */
function bst3() {
  return {
    $id: 1,
    $addr: "0xaaa",
    val: 2,
    left: { $id: 2, $addr: "0xbbb", val: 1, left: null, right: null },
    right: { $id: 3, $addr: "0xccc", val: 3, left: null, right: null },
  };
}

describe("tree routing", () => {
  it("positive: 3-node BST routes to tree", () => {
    assert.equal(useContainerType(bst3()), "tree");
  });

  it("negative: scalar left/right pair with $addr stays struct (not tree)", () => {
    assert.equal(
      useContainerType({ $id: 9, $addr: "0xddd", left: 1, right: 2, label: "x" }),
      "struct",
    );
  });

  it("negative: bare numeric pair without $addr never routes to tree", () => {
    assert.notEqual(useContainerType({ left: 1, right: 2 }), "tree");
  });

  it("no regression: $addr+next still routes to linked_list", () => {
    assert.equal(
      useContainerType({
        $id: 1,
        $addr: "0xaaa",
        val: 1,
        next: { $id: 2, $addr: "0xbbb", val: 2, next: null },
      }),
      "linked_list",
    );
  });

  it("no regression: cyclic structs still route to struct sentinel", () => {
    assert.equal(useContainerType({ $cycle: true }), "struct");
    assert.equal(useContainerType({ $depth_limit: true }), "struct");
  });

  it("no regression: null children count as pointer-shaped (leaf BST node is a tree)", () => {
    assert.equal(
      useContainerType({ $id: 2, $addr: "0xbbb", val: 1, left: null, right: null }),
      "tree",
    );
  });
});

describe("tree registry adapter", () => {
  it("registry maps tree kind to TreeAdapter (not PrimitiveFallback)", () => {
    assert.equal(VISUAL_REGISTRY.tree, TreeAdapter);
    assert.notEqual(VISUAL_REGISTRY.tree, PrimitiveFallback);
    assert.equal(VISUAL_REGISTRY.struct, PrimitiveFallback);
  });

  it("positive: 3-node BST renders labeled SVG tree nodes", () => {
    const html = renderToStaticMarkup(
      React.createElement(TreeAdapter, { value: bst3(), name: "root" }),
    );
    assert.match(html, /<svg/);
    const nodes = html.match(/data-testid="struct-node"/g) ?? [];
    assert.equal(nodes.length, 3);
    assert.match(html, /data-label="2"/);
    assert.match(html, /data-label="1"/);
    assert.match(html, /data-label="3"/);
  });

  it("negative: scalar pair routes to struct → PrimitiveFallback, never SVG", () => {
    const v = { $id: 9, $addr: "0xddd", left: 1, right: 2, label: "x" };
    const kind = useContainerType(v);
    assert.equal(kind, "struct");
    const Component = VISUAL_REGISTRY[kind];
    assert.equal(Component, PrimitiveFallback);
    const html = renderToStaticMarkup(
      React.createElement(Component, { value: v, name: "p" }),
    );
    assert.doesNotMatch(html, /<svg/);
    assert.match(html, /data-testid="primitive-fallback"/);
  });
});
