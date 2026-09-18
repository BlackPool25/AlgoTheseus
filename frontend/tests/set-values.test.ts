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
 * Run (no new deps — repo convention is node:test; esbuild ships with vite, and the
 * empty CSS loader absorbs the @xyflow style import in VariableRow's
 * registry chain):
 *   node -e "require('esbuild').buildSync({entryPoints:['tests/set-values.test.ts'],bundle:true,platform:'node',format:'esm',jsx:'automatic',define:{'import.meta.env':'{}'},loader:{'.css':'empty'},outfile:'/tmp/set-values.test.mjs',logLevel:'error'})" \
 *   && node --test /tmp/set-values.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { asItems, setItems } from "../src/utils/setItems";

const readers = { asItems, setItems };

describe("set readers accept the live `values` key", () => {
  for (const [name, read] of Object.entries(readers)) {
    it(`${name}: {_type:"set",values:[1,2,3]} yields 3 chips`, () => {
      assert.deepEqual(read({ _type: "set", values: [1, 2, 3] }), [1, 2, 3]);
    });
  }
});

describe("set readers keep existing shapes (no regression)", () => {
  for (const [name, read] of Object.entries(readers)) {
    it(`${name}: {_type:"set",items:[1,2,3]} still yields 3 chips`, () => {
      assert.deepEqual(read({ _type: "set", items: [1, 2, 3] }), [1, 2, 3]);
    });

    it(`${name}: plain array still yields chips`, () => {
      assert.deepEqual(read([1, 2, 3]), [1, 2, 3]);
    });

    it(`${name}: non-set shapes still yield null`, () => {
      assert.equal(read({ _type: "set" }), null);
      assert.equal(read(null), null);
      assert.equal(read(42), null);
    });
  }
});
