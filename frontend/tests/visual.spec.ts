/**
 * tests/visual.spec.ts — Playwright visual regression + integration tests.
 *
 * Tests (18 total):
 *   1-2:  Full workflow (page load, mock API, Run, stdout/error)
 *   3-13: Each visual component renders correctly with mock data
 *   14-15:Scrubber navigation (prev/next, compressed-step groups)
 *   16:   Virtualized list scroll behavior
 *   17:   Multi-structure resize handle
 *   18:   Branch event badge display
 *
 * All mock the /execute endpoint with NDJSON — no Docker needed.
 */

import { test, expect, type Page } from "@playwright/test";
import {
  createMockNDJSON,
  createLargeVectorNDJSON,
  createCompressedNDJSON,
  createCompileErrorNDJSON,
  STEPS,
} from "./mockData";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Mock the NDJSON streaming /execute endpoint, load the page, click Run,
 * and wait for the trace scrubber to appear.
 */
async function setupWithMock(page: Page, ndjson?: string) {
  const body = ndjson ?? createMockNDJSON();

  await page.route("**/execute", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body,
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: /^Run$/ }).click();
  await page.waitForSelector('input[aria-label="Trace step"]', { timeout: 10000 });
  await page.waitForTimeout(400);
}

/**
 * Navigate to a specific trace step via the range slider.
 */
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
  await page.waitForTimeout(1000);
}

/**
 * Screenshot a variable row by its display name.
 * Walks up two parents from the text node to the variable-row div.
 */
/**
 * Locator for the state panel (contains "Variables" header).
 */
function statePanel(page: Page) {
  return page.getByText("Variables", { exact: true }).locator("xpath=../..");
}

/**
 * Screenshot a variable row within the state panel.
 * Scoping avoids Monaco editor matches for common names like "arr".
 */
async function screenshotVarRow(
  page: Page,
  name: string,
  screenshotName: string,
) {
  const panel = statePanel(page);
  const varText = panel.getByText(name, { exact: true });
  const varRow = varText.locator("xpath=../..");
  await expect(varRow).toHaveScreenshot(screenshotName, {
    animations: "disabled",
    threshold: 0.02,
  });
}

/**
 * Full-page screenshot. Higher maxDiffPixels because the Monaco editor
 * has slight sub-pixel rendering differences across runs.
 */
async function screenshotFullPage(page: Page, name: string) {
  // Higher threshold because the Monaco editor renders differently on each
  // run (canvas-based rendering). 20% catches major layout breaks while
  // tolerating editor pixel noise.
  await expect(page).toHaveScreenshot(name, {
    animations: "disabled",
    fullPage: false,
    threshold: 0.20,
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe("Full workflow integration", () => {
  test("1: page loads, Run button clicked, trace scrubber appears", async ({ page }) => {
    await setupWithMock(page);

    await expect(page.locator('input[aria-label="Trace step"]')).toBeVisible();
    await expect(page.getByText("Variables", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Run$/ })).toBeEnabled();

    await screenshotFullPage(page, "01-full-workflow-after-run.png");
  });

  test("2: stdout banner and compile-error path", async ({ page }) => {
    await setupWithMock(page);
    await expect(page.getByText(/Found at index/).first()).toBeVisible();
    await screenshotFullPage(page, "02a-stdout-banner.png");

    await page.unroute("**/execute");
    await page.route("**/execute", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: createCompileErrorNDJSON(),
      });
    });
    await page.getByRole("button", { name: /^Run$/ }).click();
    await page.waitForTimeout(600);
    await expect(page.getByText(/expected ';'/)).toBeVisible();
    await screenshotFullPage(page, "02b-compile-error-banner.png");
  });
});

test.describe("Visual component screenshots", () => {
  test("3: VectorVisual renders indexed boxes", async ({ page }) => {
    await setupWithMock(page);
    await goToStep(page, STEPS.VECTOR);
    await screenshotVarRow(page, "arr", "03-vector-visual.png");
  });

  test("4: MapVisual renders key-value table", async ({ page }) => {
    await setupWithMock(page);
    await goToStep(page, STEPS.MAP);
    await screenshotVarRow(page, "myMap", "04-map-visual.png");
  });

  test("5: StackVisual renders vertical stack with top marker", async ({ page }) => {
    await setupWithMock(page);
    await goToStep(page, STEPS.STACK);
    await expect(page.getByText("top →")).toBeVisible();
    await screenshotVarRow(page, "stk", "05-stack-visual.png");
  });

  test("6: QueueVisual renders horizontal queue with front/back arrows", async ({ page }) => {
    await setupWithMock(page);
    await goToStep(page, STEPS.QUEUE);
    await expect(page.getByText("front")).toBeVisible();
    await expect(page.getByText("back")).toBeVisible();
    await screenshotVarRow(page, "q", "06-queue-visual.png");
  });

  test("7: GridVisual renders 2D heatmap grid", async ({ page }) => {
    await setupWithMock(page);
    await goToStep(page, STEPS.GRID);
    await screenshotVarRow(page, "board", "07-grid-visual.png");
  });

  test("8: DPTableVisual renders DP grid with arrows & highlight", async ({ page }) => {
    await setupWithMock(page);
    await goToStep(page, STEPS.DP_TABLE);
    await expect(page.getByText("dp_table").first()).toBeVisible();
    await expect(page.getByText("dependency")).toBeVisible();
    await screenshotVarRow(page, "dp", "08-dp-table-visual.png");
  });

  test("9: GraphAlgorithmVisual renders graph with React Flow", async ({ page }) => {
    await setupWithMock(page);
    await goToStep(page, STEPS.GRAPH);
    await expect(page.getByText("graph").first()).toBeVisible();
    await expect(page.locator(".react-flow__renderer").first()).toBeVisible();
    await screenshotVarRow(page, "graph", "09-graph-visual.png");
  });

  test("10: TrieVisual renders SVG prefix tree", async ({ page }) => {
    await setupWithMock(page);
    await goToStep(page, STEPS.TRIE);
    await expect(page.getByText("trie").first()).toBeVisible();
    await screenshotVarRow(page, "trieVar", "10-trie-visual.png");
  });

  test("11: LinkedListVisual renders SVG linked list with arrows", async ({ page }) => {
    await setupWithMock(page);
    await goToStep(page, STEPS.LINKED_LIST);
    await expect(page.getByText("singly-linked")).toBeVisible();
    await screenshotVarRow(page, "list", "11-linked-list-visual.png");
  });

  test("12: HeapVisual renders binary heap SVG tree", async ({ page }) => {
    await setupWithMock(page);
    await goToStep(page, STEPS.HEAP);
    // Heap type badge — the hyphen character may be regular or non-breaking
    await expect(page.getByText(/heap/).first()).toBeVisible();
    await page.waitForTimeout(2500);
    await screenshotVarRow(page, "pq", "12-heap-visual.png");
  });

  test("13: MultiStructureSyncView renders multiple panels with connectors", async ({ page }) => {
    await setupWithMock(page);
    await goToStep(page, STEPS.MULTI_STRUCTURE);
    await expect(page.getByText("Adjacency", { exact: true })).toBeVisible();
    await expect(page.getByText("BFS Queue", { exact: true })).toBeVisible();
    await screenshotVarRow(page, "multiView", "13-multi-structure-visual.png");
  });
});

test.describe("Scrubber navigation", () => {
  test("14: slider and prev/next buttons navigate correctly", async ({ page }) => {
    await setupWithMock(page);

    await expect(page.getByText(/Step 1 \/ 16/)).toBeVisible();

    await page.getByLabel("Next step").click();
    await page.waitForTimeout(300);
    await expect(page.getByText(/Step 2 \/ 16/)).toBeVisible();

    await page.getByLabel("Previous step").click();
    await page.waitForTimeout(300);
    await expect(page.getByText(/Step 1 \/ 16/)).toBeVisible();

    await goToStep(page, STEPS.EXIT);
    await expect(page.getByText(/Step 16 \/ 16/)).toBeVisible();
  });

  test("15: compressed-step group displays and can be expanded", async ({ page }) => {
    const ndjson = createCompressedNDJSON(5);
    await setupWithMock(page, ndjson);

    await goToStep(page, 2);
    await page.waitForTimeout(400);

    await expect(page.getByText(/identical/)).toBeVisible();

    const scrubberBar = page
      .locator('input[aria-label="Trace step"]')
      .locator("xpath=../../..");
    await expect(scrubberBar).toHaveScreenshot("15-scrubber-compressed.png", {
      animations: "disabled",
    });

    await page.getByLabel("Expand compressed step group").click();
    await page.waitForTimeout(300);
    await expect(
      page.getByLabel("Expand compressed step group"),
    ).not.toBeVisible();
  });
});

test.describe("Virtualization", () => {
  test("16: virtualized vector renders and scrolls", async ({ page }) => {
    const ndjson = createLargeVectorNDJSON();
    await setupWithMock(page, ndjson);
    await goToStep(page, 1);

    await expect(page.getByText(/largeArr/).first()).toBeVisible();
    await expect(page.getByText(/vector.*150/)).toBeVisible();

    await screenshotVarRow(page, "largeArr", "16a-virtualized-vector.png");

    // Scroll the vector's overflow-x-auto container far right.
    // The VectorVisual wraps virtualized items in a div with overflow-x-auto.
    await page.evaluate(() => {
      const containers = document.querySelectorAll('[class*="overflow-x-auto"]');
      for (const el of containers) {
        // Scroll the one that has enough content (total size > 2000)
        const firstChild = el.firstElementChild as HTMLElement | null;
        if (firstChild && firstChild.offsetWidth > 2000) {
          el.scrollLeft = firstChild.offsetWidth;
          break;
        }
      }
    });
    await page.waitForTimeout(1000);

    // After scrolling, the last few items should be in the virtualizer's viewport.
    // Value at index 149 is 298.
    await expect(page.getByText("298").first()).toBeVisible();
    await screenshotVarRow(page, "largeArr", "16b-virtualized-vector-scrolled.png");
  });
});

test.describe("Multi-structure sync view resizing", () => {
  test("17: drag handle resizes panels", async ({ page }) => {
    await setupWithMock(page);
    await goToStep(page, STEPS.MULTI_STRUCTURE);

    const resizeHandle = page.locator('[class*="cursor-col-resize"]');
    await expect(resizeHandle).toBeVisible();

    const box = await resizeHandle.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x - 80, box.y + box.height / 2, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(500);
    }

    await screenshotVarRow(page, "multiView", "17-multi-structure-resized.png");
  });
});

test.describe("Branch event display", () => {
  test("18: branch event badge shows taken/not-taken state", async ({ page }) => {
    await setupWithMock(page);
    await goToStep(page, STEPS.BRANCH);

    await expect(page.getByText("branch: false")).toBeVisible();
    await expect(page.getByText("arr[mid] == target").first()).toBeVisible();
    await screenshotFullPage(page, "18-branch-event.png");
  });
});
