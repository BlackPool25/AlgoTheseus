/**
 * tests/theme.spec.ts — todo 24 multi-palette theme system.
 *
 * - Switcher lists the 8 frozen palettes; selecting one sets data-theme.
 * - Choice persists via localStorage across reload.
 * - Unknown data-theme falls back to zinc-dark with a console warning.
 * - One canonical-trace screenshot per palette lands in .omo/evidence/.
 */
import { test, expect, type Page } from "@playwright/test";
import { createMockNDJSON, STEPS } from "./mockData";
import { THEMES } from "../src/theme";

async function setupWithMock(page: Page) {
  await page.route("**/execute", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: createMockNDJSON(),
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
  await page.waitForTimeout(1000);
}

const themeOf = (page: Page) =>
  page.evaluate(() => document.documentElement.dataset.theme);

test.describe("Theme switcher", () => {
  test("switcher lists 8 palettes, default is zinc-dark", async ({ page }) => {
    await setupWithMock(page);
    const select = page.getByLabel("Theme");
    await expect(select).toBeVisible();
    await expect(select).toHaveValue("zinc-dark");
    expect(await themeOf(page)).toBe("zinc-dark");
    const options = await select.locator("option").allTextContents();
    expect(options).toEqual([...THEMES]);
  });

  test("selecting a theme applies data-theme and persists it", async ({
    page,
  }) => {
    await setupWithMock(page);
    const select = page.getByLabel("Theme");
    await select.selectOption("nord");
    expect(await themeOf(page)).toBe("nord");
    expect(
      await page.evaluate(() => localStorage.getItem("algo-theseus-theme")),
    ).toBe("nord");
  });

  test("theme survives reload via localStorage", async ({ page }) => {
    await setupWithMock(page);
    await page.getByLabel("Theme").selectOption("gruvbox-dark");
    await page.reload();
    await expect(page.getByRole("button", { name: /^Run$/ })).toBeVisible();
    expect(await themeOf(page)).toBe("gruvbox-dark");
    await expect(page.getByLabel("Theme")).toHaveValue("gruvbox-dark");
  });

  test("unknown data-theme falls back to default with console warning", async ({
    page,
  }) => {
    const warnings: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "warning") warnings.push(msg.text());
    });
    await page.addInitScript(() => {
      localStorage.setItem("algo-theseus-theme", "bogus-theme");
    });
    await page.goto("/");
    await expect(page.getByRole("button", { name: /^Run$/ })).toBeVisible();
    expect(await themeOf(page)).toBe("zinc-dark");
    expect(warnings.some((w) => w.includes("bogus-theme"))).toBe(true);
  });

  test("legacy dsa-viz-theme key migrates to algo-theseus-theme on startup", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("algo-theseus-theme");
      localStorage.setItem("dsa-viz-theme", "nord");
    });
    await page.goto("/");
    await expect(page.getByRole("button", { name: /^Run$/ })).toBeVisible();
    expect(await themeOf(page)).toBe("nord");
    await expect(page.getByLabel("Theme")).toHaveValue("nord");
    expect(
      await page.evaluate(() => localStorage.getItem("algo-theseus-theme")),
    ).toBe("nord");
    expect(
      await page.evaluate(() => localStorage.getItem("dsa-viz-theme")),
    ).toBeNull();
  });

  test("unknown legacy value falls back to default, never unstyled", async ({
    page,
  }) => {
    const warnings: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "warning") warnings.push(msg.text());
    });
    await page.addInitScript(() => {
      localStorage.removeItem("algo-theseus-theme");
      localStorage.setItem("dsa-viz-theme", "bogus-legacy");
    });
    await page.goto("/");
    await expect(page.getByRole("button", { name: /^Run$/ })).toBeVisible();
    expect(await themeOf(page)).toBe("zinc-dark");
    expect(warnings.some((w) => w.includes("bogus-legacy"))).toBe(true);
  });

  test("missing keys entirely default to zinc-dark with no crash", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("algo-theseus-theme");
      localStorage.removeItem("dsa-viz-theme");
    });
    await page.goto("/");
    await expect(page.getByRole("button", { name: /^Run$/ })).toBeVisible();
    expect(await themeOf(page)).toBe("zinc-dark");
  });

  test("light theme visibly re-skins the app shell and editor", async ({
    page,
  }) => {
    await setupWithMock(page);
    await page.waitForSelector(".monaco-editor", { timeout: 20000 });
    await page.getByLabel("Theme").selectOption("light");
    await page.waitForTimeout(500);
    const headerBg = await page.evaluate(
      () => getComputedStyle(document.querySelector("header")!).backgroundColor,
    );
    // light --viz-body-bg #fdf6e3 (header uses bg-viz-body, byte-identical
    // to bg-zinc-900 #18181b under zinc-dark).
    expect(headerBg).toBe("rgb(253, 246, 227)");
    const editorBg = await page.evaluate(
      () =>
        getComputedStyle(document.querySelector(".monaco-editor")!)
          .backgroundColor,
    );
    // monaco `vs` surface (#FFFFFE) — fails today (hardcoded vs-dark #1e1e1e).
    expect(editorBg).toBe("rgb(255, 255, 254)");
  });

  test("canonical-trace screenshot per palette", async ({ page }) => {
    await setupWithMock(page);
    await goToStep(page, STEPS.VECTOR);
    const select = page.getByLabel("Theme");
    for (const name of THEMES) {
      await select.selectOption(name);
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `../.omo/evidence/theme-${name}.png`,
        animations: "disabled",
        fullPage: false,
      });
      expect(await themeOf(page)).toBe(name);
    }
  });
});
