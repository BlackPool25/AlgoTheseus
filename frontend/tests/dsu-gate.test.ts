/**
 * tests/dsu-gate.test.ts — Task 3 DSU false-trigger gate.
 *
 * Run: npx tsc tests/dsu-gate.test.ts src/hooks/useContainerType.ts
 *   --outDir /tmp/dsutest --module commonjs --target es2022
 *   --moduleResolution node --skipLibCheck --strict --esModuleInterop \
 *   && node --test /tmp/dsutest/tests/dsu-gate.test.js
 *
 * RED-first: a plain scoreboard struct {p:[0,1,2,3], r:[0,0,1,2]}
 * (identity parents, monotonically rising "ranks") matches the old
 * shape-only heuristic and routes "dsu" → wrong visual.
 *
 * GREEN: scoreboard routes "struct"; real union-find states
 * (with at least one merged set) still route "dsu".
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { useContainerType } from "../src/hooks/useContainerType";

describe("dsu gate", () => {
  it("scoreboard {p:[0,1,2,3],r:[0,0,1,2]} is NOT dsu", () => {
    const kind = useContainerType({
      $id: 7,
      $addr: "0xbeef",
      p: [0, 1, 2, 3],
      r: [0, 0, 1, 2],
    });
    assert.notEqual(kind, "dsu");
    assert.equal(kind, "struct");
  });

  it("true DSU [0,0,0,3]/[1,0,0,0] still routes dsu", () => {
    const kind = useContainerType({
      $id: 1,
      $addr: "0xabc",
      p: [0, 0, 0, 3],
      r: [1, 0, 0, 0],
    });
    assert.equal(kind, "dsu");
  });

  it("union-find preset end-state p=[0,0,0,3,3]/r=[1,0,0,1,0] routes dsu", () => {
    const kind = useContainerType({
      $id: 2,
      $addr: "0xdef",
      p: [0, 0, 0, 3, 3],
      r: [1, 0, 0, 1, 0],
    });
    assert.equal(kind, "dsu");
  });

  it("fresh DSU (identity parents, zero ranks) stays struct, not dsu", () => {
    // Indistinguishable from a scoreboard — fail closed to struct.
    const kind = useContainerType({
      $id: 3,
      $addr: "0x123",
      p: [0, 1, 2, 3],
      r: [0, 0, 0, 0],
    });
    assert.notEqual(kind, "dsu");
  });
});
