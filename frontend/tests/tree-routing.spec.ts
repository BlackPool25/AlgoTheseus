/**
 * tests/tree-routing.spec.ts — tree-shaped struct routing lock (todo 2).
 *
 * Run: npx vitest run tests/tree-routing.spec.ts
 *
 * RED on HEAD: a BST TreeNode ({val,left,right} pointer-shaped) routes to
 * "struct" → PrimitiveFallback ({keys} fallback), even though
 * StructGraphVisual already renders trees — nothing routes to it.
 *
 * GREEN: tight predicate routes pointer-shaped left+right + scalar label
 * to "tree"; bare numeric pairs fail closed to struct/map (never tree).
 */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
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
    expect(useContainerType(bst3())).toBe("tree");
  });

  it("negative: scalar left/right pair with $addr stays struct (not tree)", () => {
    expect(
      useContainerType({ $id: 9, $addr: "0xddd", left: 1, right: 2, label: "x" }),
    ).toBe("struct");
  });

  it("negative: bare numeric pair without $addr never routes to tree", () => {
    expect(useContainerType({ left: 1, right: 2 })).not.toBe("tree");
  });

  it("no regression: $addr+next still routes to linked_list", () => {
    expect(
      useContainerType({
        $id: 1,
        $addr: "0xaaa",
        val: 1,
        next: { $id: 2, $addr: "0xbbb", val: 2, next: null },
      }),
    ).toBe("linked_list");
  });

  it("no regression: cyclic structs still route to struct sentinel", () => {
    expect(useContainerType({ $cycle: true })).toBe("struct");
    expect(useContainerType({ $depth_limit: true })).toBe("struct");
  });

  it("no regression: null children count as pointer-shaped (leaf BST node is a tree)", () => {
    expect(
      useContainerType({ $id: 2, $addr: "0xbbb", val: 1, left: null, right: null }),
    ).toBe("tree");
  });
});

describe("tree registry adapter", () => {
  it("registry maps tree kind to TreeAdapter (not PrimitiveFallback)", () => {
    expect(VISUAL_REGISTRY.tree).toBe(TreeAdapter);
    expect(VISUAL_REGISTRY.tree).not.toBe(PrimitiveFallback);
    expect(VISUAL_REGISTRY.struct).toBe(PrimitiveFallback);
  });

  it("positive: 3-node BST renders labeled SVG tree nodes", () => {
    const html = renderToStaticMarkup(
      React.createElement(TreeAdapter, { value: bst3(), name: "root" }),
    );
    expect(html).toContain("<svg");
    const nodes = html.match(/data-testid="struct-node"/g) ?? [];
    expect(nodes.length).toBe(3);
    expect(html).toContain('data-label="2"');
    expect(html).toContain('data-label="1"');
    expect(html).toContain('data-label="3"');
  });

  it("negative: scalar pair routes to struct → PrimitiveFallback, never SVG", () => {
    const v = { $id: 9, $addr: "0xddd", left: 1, right: 2, label: "x" };
    const kind = useContainerType(v);
    expect(kind).toBe("struct");
    const Component = VISUAL_REGISTRY[kind];
    expect(Component).toBe(PrimitiveFallback);
    const html = renderToStaticMarkup(
      React.createElement(Component, { value: v, name: "p" }),
    );
    expect(html).not.toContain("<svg");
    expect(html).toContain('data-testid="primitive-fallback"');
  });
});
