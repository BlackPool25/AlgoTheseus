/**
 * tests/set-values.test.ts — Task 1 (viz-improvement-wave).
 *
 * The live backend emits {"_type":"set","values":[...]} (tracer.h __ser for
 * std::set/unordered_set/multiset), but the frontend readers only accepted
 * `.items`. Every live std::set fell into the opaque primitive fallback.
 *
 * Each reader is tested directly: N returned items == N rendered chips
 * (SetVisual maps asItems 1:1 to [data-testid="set-chip"]).
 *
 * Run: cd frontend && npx vitest run tests/set-values.test.ts
 */

import { describe, expect, it } from "vitest";
import { asItems } from "../src/components/ContainerVisuals/SetVisual";
import { setItems } from "../src/components/StatePanel/VariableRow";

const readers = { asItems, setItems };

describe("set readers accept the live `values` key", () => {
  for (const [name, read] of Object.entries(readers)) {
    it(`${name}: {_type:"set",values:[1,2,3]} yields 3 chips`, () => {
      expect(read({ _type: "set", values: [1, 2, 3] })).toEqual([1, 2, 3]);
    });
  }
});

describe("set readers keep existing shapes (no regression)", () => {
  for (const [name, read] of Object.entries(readers)) {
    it(`${name}: {_type:"set",items:[1,2,3]} still yields 3 chips`, () => {
      expect(read({ _type: "set", items: [1, 2, 3] })).toEqual([1, 2, 3]);
    });

    it(`${name}: plain array still yields chips`, () => {
      expect(read([1, 2, 3])).toEqual([1, 2, 3]);
    });

    it(`${name}: non-set shapes still yield null`, () => {
      expect(read({ _type: "set" })).toBeNull();
      expect(read(null)).toBeNull();
      expect(read(42)).toBeNull();
    });
  }
});
