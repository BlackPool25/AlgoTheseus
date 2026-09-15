import { test, expect, type Page } from "@playwright/test";
import {
  createCompressedNDJSON,
  createLargeVectorNDJSON,
} from "./mockData";

async function setupWithMock(page: Page, ndjson: string) {
  await page.route("**/execute", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: ndjson,
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
  await page.waitForTimeout(300);
}

test.describe("Compression boundary landing UX (T14)", () => {
  test("22: next lands on group start boundary with N-identical-steps affordance", async ({
    page,
  }) => {
    // enter(0) + 5 identical states(1-5) + exit(6) → group {1..5, count 5}
    await setupWithMock(page, createCompressedNDJSON(5));

    await expect(page.getByText(/Step 1 \/ 7/)).toBeVisible();

    await page.getByLabel("Next step").click();
    await page.waitForTimeout(300);

    // Must land ON the group boundary (group {1..5} → "Steps 2–6"), not skip past it
    await expect(page.getByText(/Steps 2–6 \/ 7/)).toBeVisible();
    // Visible "N identical steps" affordance while on the boundary
    await expect(page.getByText(/5 identical steps/)).toBeVisible();
  });

  test("23: second next exits past group; prev lands on group end boundary", async ({
    page,
  }) => {
    await setupWithMock(page, createCompressedNDJSON(5));

    await page.getByLabel("Next step").click();
    await page.waitForTimeout(300);
    await expect(page.getByText(/Steps 2–6 \/ 7/)).toBeVisible();

    // Second next traverses past the collapsed group to the exit step
    await page.getByLabel("Next step").click();
    await page.waitForTimeout(300);
    await expect(page.getByText(/Step 7 \/ 7/)).toBeVisible();

    // Prev from after the group lands ON the group end boundary (group label)
    await page.getByLabel("Previous step").click();
    await page.waitForTimeout(300);
    await expect(page.getByText(/Steps 2–6 \/ 7/)).toBeVisible();
    await expect(page.getByText(/5 identical steps/)).toBeVisible();

    // Another prev exits before the group (step index 0)
    await page.getByLabel("Previous step").click();
    await page.waitForTimeout(300);
    await expect(page.getByText(/Step 1 \/ 7/)).toBeVisible();
  });

  test("24: reachability audit — expand all groups, every raw step renders", async ({
    page,
  }) => {
    await setupWithMock(page, createCompressedNDJSON(5));

    // Expand every collapsed group first (land on boundary to reveal toggle)
    await page.getByLabel("Next step").click();
    await page.waitForTimeout(300);
    const expandBtn = page.getByLabel("Expand compressed step group");
    if (await expandBtn.isVisible()) {
      await expandBtn.click();
      await page.waitForTimeout(300);
    }

    // Step through ALL raw indices; each must render its step label (100% reachable)
    const total = 7;
    for (let i = 0; i < total; i++) {
      await goToStep(page, i);
      await expect(
        page.getByText(new RegExp(`Step ${i + 1} \\/ ${total}`)),
      ).toBeVisible();
    }
  });

  test("25: single-step trace (no groups) scrubs exactly as before", async ({
    page,
  }) => {
    // 3 distinct events → no compression groups; prev/next move one step each
    await setupWithMock(page, createLargeVectorNDJSON());

    await expect(page.getByText(/Step 1 \/ 3/)).toBeVisible();
    await expect(page.getByText(/identical/)).toHaveCount(0);

    await page.getByLabel("Next step").click();
    await page.waitForTimeout(300);
    await expect(page.getByText(/Step 2 \/ 3/)).toBeVisible();
    await expect(page.getByText(/identical/)).toHaveCount(0);

    await page.getByLabel("Next step").click();
    await page.waitForTimeout(300);
    await expect(page.getByText(/Step 3 \/ 3/)).toBeVisible();

    await page.getByLabel("Previous step").click();
    await page.waitForTimeout(300);
    await expect(page.getByText(/Step 2 \/ 3/)).toBeVisible();
  });
});
