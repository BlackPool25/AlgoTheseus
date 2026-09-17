import { test, expect, type Page } from "@playwright/test";
import type { MockTraceEvent } from "./mockData";

/**
 * Sidebar scroll: the desktop StatePanel must expose ONE unified scroll
 * container wrapping globals + frame tables + flat vars + HeapPanel.
 * Headers/footers/CallStack stay fixed; tall content must scroll, not clip.
 */

function createTallSidebarNDJSON(): string {
  const flatVars: Record<string, unknown> = {};
  for (let i = 0; i < 30; i++) flatVars[`var_${i}`] = i;
  const globals: Record<string, unknown> = {};
  for (let i = 0; i < 40; i++) globals[`g_${i}`] = i;
  const heap: Record<string, unknown> = {};
  for (let i = 1; i <= 8; i++) {
    heap[String(i)] = {
      type: "Node",
      fields: { val: i, tag: `node-${i}`, extra: `payload-${i}-with-a-long-tail` },
      refs: { next: i < 8 ? String(i + 1) : null },
      addr: `0x${(i * 0x100).toString(16)}`,
    };
  }
  const events: MockTraceEvent[] = [
    { type: "enter", line: 1, func: "main", depth: 1, params: {} },
    { type: "state", line: 2, func: "main", depth: 1, vars: { m: 1 } },
    { type: "enter", line: 3, func: "alpha", depth: 2, params: { n: 5 } },
    { type: "state", line: 4, func: "alpha", depth: 2, vars: { a: 2 } },
    { type: "enter", line: 5, func: "beta", depth: 3, params: { k: 7 } },
    {
      type: "state", line: 6, func: "beta", depth: 3,
      vars: { ...flatVars, head: { $id: 1 } },
      globals,
      heap,
      heap_diff: {
        added: ["1", "2", "3", "4", "5", "6", "7", "8"],
        removed: [],
        mutated: [],
        changed_fields: {},
      },
    },
    { type: "exit", line: 7, func: "beta", depth: 3, return_val: 0 },
    { type: "exit", line: 8, func: "alpha", depth: 2, return_val: 0 },
    { type: "exit", line: 9, func: "main", depth: 1, return_val: 0 },
  ];
  const lines = events.map((ev) => JSON.stringify({ type: "event", data: ev }));
  lines.push(
    JSON.stringify({
      type: "cfg",
      stdout: "",
      runtime_error: null,
      timed_out: false,
      truncated: false,
      cfg_nodes: [],
      cfg_edges: [],
      total_steps: events.length,
    }),
  );
  // Trailing newline is critical — the stream reader's split() + pop()
  // discards the last line otherwise, losing the cfg chunk.
  return lines.join("\n") + "\n";
}

async function setupWithMock(page: Page) {
  await page.route("**/execute", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: createTallSidebarNDJSON(),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /^Run$/ }).click();
  await page.waitForSelector('input[aria-label="Trace step"]', { timeout: 10000 });
  await page.waitForTimeout(400);
}

async function goToStep(page: Page, step: number) {
  await page.evaluate((s) => {
    const el = document.querySelector<HTMLInputElement>(
      'input[aria-label="Trace step"]',
    );
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(el, String(s));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, step);
  await page.waitForTimeout(600);
}

test("sidebar: single unified scroll container, no clipped content", async ({
  page,
}) => {
  await setupWithMock(page);

  // Step 5 = beta state: 3 frames on stack, 40 globals, 30 flat vars, heap.
  await goToStep(page, 5);
  await expect(page.getByTestId("globals-section")).toBeVisible();
  await expect(page.getByTestId("frame-table")).toHaveCount(4); // globals + 3 frames
  await expect(page.getByTestId("heap-panel")).toBeVisible();

  // Open the heap so its nodes join the tall content.
  await page.getByTestId("heap-panel").getByRole("button").click();
  await expect(page.getByTestId("heap-node")).toHaveCount(8);

  const result = await page.evaluate(() => {
    const sidebar = document.querySelector(".at-reserve-state");
    if (!sidebar) return { error: "no sidebar" } as const;
    const isScroller = (el: Element) => {
      const s = getComputedStyle(el);
      const h = el as HTMLElement;
      return (
        (s.overflowY === "auto" || s.overflowY === "scroll") &&
        h.scrollHeight > h.clientHeight + 1
      );
    };
    const scrollers = [...sidebar.querySelectorAll("*")].filter(isScroller);
    const sections = [
      ...sidebar.querySelectorAll(
        '[data-testid="globals-section"], [data-testid="frame-table"], [data-testid="heap-panel"]',
      ),
    ];
    const rows = [
      ...sidebar.querySelectorAll(
        '[data-testid="heap-node"], [data-testid="frame-table"]',
      ),
    ];
    // One common ACTIVE scroller must contain every section.
    const common = scrollers.filter((sc) =>
      sections.every((sec) => sc.contains(sec)),
    );
    // A row is clipped when it overflows its nearest active scroller's
    // visible box and that scroller cannot scroll to reveal it, or when it
    // has no scrollable ancestor at all (parent chain overflow-hidden).
    let clipped = 0;
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      let anc: Element | null = row.parentElement;
      let host: Element | null = null;
      while (anc && anc !== sidebar) {
        if (isScroller(anc)) {
          host = anc;
          break;
        }
        anc = anc.parentElement;
      }
      if (!host) {
        // No scrollable ancestor: visible only if inside the viewport.
        if (r.bottom > window.innerHeight + 1 || r.top < 0) clipped++;
      } else {
        const hb = host.getBoundingClientRect();
        const canScroll =
          (host as HTMLElement).scrollHeight >
          (host as HTMLElement).clientHeight + 1;
        if ((r.bottom > hb.bottom + 1 || r.top < hb.top - 1) && !canScroll)
          clipped++;
      }
    }
    return {
      scrollerCount: scrollers.length,
      commonCount: common.length,
      sectionCount: sections.length,
      rowCount: rows.length,
      clipped,
      scrollable:
        common.length > 0
          ? (common[0] as HTMLElement).scrollHeight >
            (common[0] as HTMLElement).clientHeight + 1
          : false,
    };
  });

  expect(result).toMatchObject({ sectionCount: 6 });
  // Single unified container holds ALL sections and actually scrolls.
  expect(result).toMatchObject({ commonCount: 1, scrollable: true });
  // Nothing clipped: every row reachable via that one container.
  expect(result).toMatchObject({ clipped: 0 });
});
