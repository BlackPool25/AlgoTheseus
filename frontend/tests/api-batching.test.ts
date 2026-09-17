/**
 * tests/api-batching.test.ts — Wave7 4.2 frontend batching locks.
 *
 *   1. 5 rapid identical batchedExecuteBatch() calls coalesce into 1 POST
 *      (50ms debounce window, shared promise).
 *   2. fetchWith429Retry() honors integer Retry-After, retries (max 3),
 *      and succeeds after 429 backoff.
 *
 * Run (no new deps — repo has no vitest; esbuild ships with vite):
 *   ../node_modules/.bin/esbuild tests/api-batching.test.ts --bundle \
 *     --platform=node --format=esm --define:import.meta.env='{}' \
 *     --outfile=/tmp/api-batching.test.mjs --log-level=error \
 *   && node --test /tmp/api-batching.test.mjs
 *
 * Must NOT change: NDJSON parsing (streamExecute), pollJob 1s/60s defaults.
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  batchedExecuteBatch,
  fetchWith429Retry,
  type ExecuteBatchResponseItem,
} from "../src/utils/api";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function batchItem(test_id: string): ExecuteBatchResponseItem {
  return {
    test_id,
    stdout: "ok",
    compile_error: null,
    runtime_error: null,
    timed_out: false,
    truncated: false,
    trace: [],
    cfg_nodes: [],
    cfg_edges: [],
    total_steps: 1,
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("batchedExecuteBatch", () => {
  it("coalesces 5 rapid identical calls into 1 fetch with a shared result", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return jsonResponse([batchItem("t1"), batchItem("t2")]);
    }) as typeof fetch;

    const req = { code: "print(1)", test_ids: ["t1", "t2"] };
    const results = await Promise.all([
      batchedExecuteBatch(req),
      batchedExecuteBatch(req),
      batchedExecuteBatch(req),
      batchedExecuteBatch(req),
      batchedExecuteBatch(req),
    ]);

    assert.equal(calls, 1);
    for (const r of results) {
      assert.deepEqual(r, [batchItem("t1"), batchItem("t2")]);
    }
  });
});

describe("fetchWith429Retry", () => {
  it("honors Retry-After and succeeds after 429 backoff", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) {
        return new Response("Rate limit exceeded", {
          status: 429,
          headers: { "Retry-After": "0" },
        });
      }
      return jsonResponse({ ok: true });
    }) as typeof fetch;

    const res = await fetchWith429Retry("http://localhost/execute-batch", {
      method: "POST",
    });
    assert.equal(res.status, 200);
    assert.equal(calls, 2);
    assert.deepEqual(await res.json(), { ok: true });
  });
});
