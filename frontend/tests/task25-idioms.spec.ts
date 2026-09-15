/**
 * tests/task25-idioms.spec.ts — Todo 25 (H3 per-structure visual idioms).
 *
 * RED-first: each test asserts the render-spec idiom BEFORE production
 * changes. Expected RED: data-flash / data-changing / data-terminal /
 * heap-array-strip / map-note attrs do not exist yet.
 *
 * Web-first assertions only (getByTestId, toHaveAttribute, toHaveCount).
 * Seeded runs: same NDJSON every run; repeat 3x for flaky-timing probe.
 */

import { test, expect, type Page } from "@playwright/test";

// ── Minimal NDJSON builder ──────────────────────────────────────────

interface Ev {
  type: string;
  [k: string]: unknown;
}

function ndjson(events: Ev[]): string {
  const lines = events.map((e) => JSON.stringify({ type: "event", data: e }));
  const n = events.length;
  lines.push(
    JSON.stringify({
      type: "cfg",
      stdout: "",
      runtime_error: null,
      timed_out: false,
      truncated: false,
      cfg_nodes: [
        { id: "n0", type: "func_start", lines: [1], label: "main()", children: ["n1"], trace_indices: [0] },
        { id: "n1", type: "line", lines: [2, 3], label: "body", children: ["n2"], trace_indices: Array.from({ length: n }, (_, i) => i) },
        { id: "n2", type: "func_end", lines: [4], label: "return", children: [], trace_indices: [n - 1] },
      ],
      cfg_edges: [
        { source: "n0", target: "n1", label: "" },
        { source: "n1", target: "n2", label: "" },
      ],
      total_steps: n,
    }),
  );
  return lines.join("\n") + "\n";
}

const enter = (): Ev => ({ type: "enter", line: 1, func: "main", depth: 1, params: {} });
const state = (vars: Record<string, unknown>, extra?: Record<string, unknown>): Ev => ({
  type: "state", line: 2, func: "main", depth: 1, vars, ...extra,
});
const exit = (): Ev => ({ type: "exit", line: 4, func: "main", depth: 1, return_val: 0 });

async function setup(page: Page, body: string) {
  await page.route("**/execute", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/x-ndjson", body });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /^Run$/ }).click();
  await page.waitForSelector('input[aria-label="Trace step"]', { timeout: 10000 });
  await page.waitForTimeout(400);
}

async function goToStep(page: Page, step: number) {
  await page.evaluate((s) => {
    const el = document.querySelector<HTMLInputElement>('input[aria-label="Trace step"]');
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, String(s));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, step);
  await page.waitForTimeout(1000);
}

// ── Tests ───────────────────────────────────────────────────────────

test.describe("task25 per-structure idioms (RED-first)", () => {
  test("vector: single-cell mutation flashes exactly one cell", async ({ page }) => {
    await setup(page, ndjson([enter(), state({ arr: [1, 2, 3] }), state({ arr: [1, 9, 3] }), exit()]));
    await goToStep(page, 2);
    const cells = page.getByTestId("changed-cell");
    await expect(cells).toHaveCount(3);
    await expect(page.locator('[data-testid="changed-cell"][data-flash="true"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="changed-cell"][data-flash="true"]')).toHaveAttribute("data-index", "1");
  });

  test("stack: push flashes the new top cell only", async ({ page }) => {
    await setup(page, ndjson([
      enter(),
      state({ stk: { top: 8, items: [8, 3] } }),
      state({ stk: { top: 42, items: [42, 8, 3] } }),
      exit(),
    ]));
    await goToStep(page, 2);
    await expect(page.locator('[data-testid="changed-cell"][data-flash="true"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="changed-cell"][data-flash="true"]')).toHaveAttribute("data-index", "0");
  });

  test("queue: enqueue flashes the new tail cell only", async ({ page }) => {
    await setup(page, ndjson([
      enter(),
      state({ q: { front: 10, items: [10, 20] } }),
      state({ q: { front: 10, items: [10, 20, 30] } }),
      exit(),
    ]));
    await goToStep(page, 2);
    await expect(page.locator('[data-testid="changed-cell"][data-flash="true"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="changed-cell"][data-flash="true"]')).toHaveAttribute("data-index", "2");
  });

  test("heap: array-strip dual + sift-swap pair flash", async ({ page }) => {
    await setup(page, ndjson([
      enter(),
      state({ pq: { _type: "pq", top: 5, items: [5, 1, 4] } }),
      state({ pq: { _type: "pq", top: 1, items: [1, 5, 4] } }),
      exit(),
    ]));
    await goToStep(page, 2);
    await expect(page.getByTestId("heap-array-strip")).toBeVisible();
    const flashed = page.locator('[data-testid="heap-tree-node"][data-flash="true"]');
    await expect(flashed).toHaveCount(2);
  });

  test("map: changed-key flash + rehash note in step_desc", async ({ page }) => {
    await setup(page, ndjson([
      enter(),
      state({ m: { a: 1, b: 2 } }),
      state({ m: { a: 1, b: 9 } }, { step_desc: "rehash: 8 → 16 buckets" }),
      exit(),
    ]));
    await goToStep(page, 2);
    await expect(page.locator('[data-testid="map-row"][data-flash="true"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="map-row"][data-flash="true"]')).toHaveAttribute("data-key", "b");
    await expect(page.getByTestId("step-desc-header")).toHaveText("rehash: 8 → 16 buckets");
  });

  test("set: insert flashes the added member only", async ({ page }) => {
    await setup(page, ndjson([
      enter(),
      state({ s: { _type: "set", items: [1, 2] } }),
      state({ s: { _type: "set", items: [1, 2, 3] } }),
      exit(),
    ]));
    await goToStep(page, 2);
    await expect(page.locator('[data-testid="set-chip"][data-flash="true"]')).toHaveCount(1);
  });

  test("trie: terminal badges + creation flash on new node", async ({ page }) => {
    const t1 = { _type: "trie", root: { edges: { c: { ch: "c", edges: { a: { ch: "a", isEnd: true } } } } } };
    const t2 = { _type: "trie", root: { edges: { c: { ch: "c", edges: { a: { ch: "a", isEnd: true, edges: { t: { ch: "t", isEnd: true } } } } } } } };
    await setup(page, ndjson([enter(), state({ trieVar: t1 }), state({ trieVar: t2 }), exit()]));
    await goToStep(page, 2);
    const terminals = page.locator('[data-testid="trie-node"][data-terminal="true"]');
    await expect(terminals.count()).resolves.toBeGreaterThanOrEqual(1);
    await expect(page.locator('[data-testid="trie-node"][data-flash="true"]')).toHaveCount(1);
  });

  test("grid: one written cell flashes via changingCells", async ({ page }) => {
    await setup(page, ndjson([
      enter(),
      state({ board: [[1, 2], [3, 4]] }),
      state({ board: [[1, 9], [3, 4]] }),
      exit(),
    ]));
    await goToStep(page, 2);
    await expect(page.locator('[data-testid="grid-cell"][data-changing="true"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="grid-cell"][data-changing="true"]')).toHaveAttribute("data-pos", "0,1");
  });

  test("dp: heatmap current cell + dependency arrows", async ({ page }) => {
    await setup(page, ndjson([
      enter(),
      state({ dp: { _type: "dp_table", data: [[0, 1], [2, 3]], current_cell: [1, 1], formula: "dp[i][j]=dp[i-1][j]+dp[i][j-1]", dependencies: [[-1, 0], [0, -1]] } }),
      exit(),
    ]));
    await goToStep(page, 1);
    await expect(page.locator('[data-testid="dp-cell"][data-current="true"]')).toHaveCount(1);
    await expect(page.getByTestId("dp-arrow")).toHaveCount(2);
  });

  test("linked-list: single $id mutation flashes alone (currentAddr)", async ({ page }) => {
    const n = (id: number, addr: string, val: number, next: unknown) => ({ $id: id, $addr: addr, val, next });
    const e = (type: string, fields: Record<string, unknown>, refs: Record<string, unknown>, addr: string) => ({ type, fields, refs, addr });
    await setup(page, ndjson([
      enter(),
      state(
        { head: n(1, "0x100", 1, n(2, "0x200", 2, n(3, "0x300", 3, null))) },
        {
          heap: {
            "1": e("struct", { val: 1 }, { next: "2" }, "0x100"),
            "2": e("struct", { val: 2 }, { next: "3" }, "0x200"),
            "3": e("struct", { val: 3, next: null }, {}, "0x300"),
          },
          heap_diff: { added: ["1", "2", "3"], removed: [], mutated: [], changed_fields: {} },
        },
      ),
      state(
        { head: n(1, "0x100", 1, n(2, "0x200", 20, n(3, "0x300", 3, null))) },
        {
          heap: {
            "1": e("struct", { val: 1 }, { next: "2" }, "0x100"),
            "2": e("struct", { val: 20 }, { next: "3" }, "0x200"),
            "3": e("struct", { val: 3, next: null }, {}, "0x300"),
          },
          heap_diff: { added: [], removed: [], mutated: ["2"], changed_fields: { "2": ["val"] } },
        },
      ),
      exit(),
    ]));
    await goToStep(page, 2);
    await expect(page.locator('[data-ll-highlight="true"]')).toHaveCount(1);
  });

  test("sync view: cross-view $id flash on shared mutation", async ({ page }) => {
    await setup(page, ndjson([
      enter(),
      state(
        {
          multiView: {
            _type: "multi_structure",
            structures: [
              { name: "adj", value: { _type: "graph", adj: [[1], [0]] }, kind: "graph", label: "Adj" },
              { name: "seen", value: [{ $id: 2, v: 1 }], kind: "vector", label: "Seen" },
            ],
            connections: [{ source: "adj", target: "seen", label: "BFS" }],
          },
        },
        { heap_diff: { added: [], removed: [], mutated: ["2"], changed_fields: { "2": ["v"] } } },
      ),
      exit(),
    ]));
    await goToStep(page, 1);
    await expect(page.locator('[data-mutated-flash="true"]')).toHaveCount(1);
  });

  test("missing data renders PrimitiveFallback, never blank", async ({ page }) => {
    await setup(page, ndjson([enter(), state({ ghost: null, nothing: undefined as unknown }), exit()]));
    await goToStep(page, 1);
    await expect(page.getByTestId("primitive-fallback").first()).toBeVisible();
  });

  test("graph: frozen layout across steps (no re-layout)", async ({ page }) => {
    const g = { _type: "graph", adj: [[1, 2], [0, 3], [0], [1]], state: [3, 1, 0, 0] };
    const g2 = { _type: "graph", adj: [[1, 2], [0, 3], [0], [1]], state: [3, 3, 1, 0] };
    await setup(page, ndjson([enter(), state({ graph: g }), state({ graph: g2 }), exit()]));
    await goToStep(page, 1);
    const before = await page.locator('[data-node-index]').evaluateAll((els) =>
      els.map((el) => `${el.getAttribute("data-node-index")}:${Math.round(el.getBoundingClientRect().x)},${Math.round(el.getBoundingClientRect().y)}`).join("|"),
    );
    await goToStep(page, 2);
    const after = await page.locator('[data-node-index]').evaluateAll((els) =>
      els.map((el) => `${el.getAttribute("data-node-index")}:${Math.round(el.getBoundingClientRect().x)},${Math.round(el.getBoundingClientRect().y)}`).join("|"),
    );
    expect(after).toEqual(before);
  });
});
