/**
 * tests/theme-matrix.spec.ts — todo 31 Wave-7 frontend matrix.
 *
 * 8 themes x 3 canonical fixtures (bsearch, print-loop, linked-list) = 24
 * cells. Each cell asserts the key testids render under that palette and
 * saves one screenshot to .omo/evidence/matrix-<theme>-<fixture>.png for
 * HUMAN eyeball — never pixel-exact gold-compared.
 *
 * Plus a seeded 200-jump random-walk scrub test: every jump asserts the
 * displayed step covers the store step and no console/page errors fired.
 * Replays deterministically via the SEED env var.
 *
 * Fixture map (mockData.ts factories):
 *   bsearch      = createFrameStdoutNDJSON @ step 4 (2 frames, stdout, gutter pair)
 *   print-loop   = createPrintLoopNDJSON   @ step 2 (program output grows)
 *   linked-list  = createHeapPanelNDJSON   @ step 3 (heap nodes + alias edge)
 */

import { test, expect, type Page } from "@playwright/test";
import {
  createFrameStdoutNDJSON,
  createPrintLoopNDJSON,
  createHeapPanelNDJSON,
  createMockNDJSON,
} from "./mockData";
import { THEMES } from "../src/theme";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Console/page errors collected during a test. Failing cell names the palette. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${String(err)}`));
  return errors;
}

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
  await page.waitForSelector('input[aria-label="Trace step"]', {
    timeout: 10000,
  });
  await page.waitForTimeout(400);
}

/** Navigate to a trace step via the range slider (store step source of truth). */
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

/** Store step = the slider's live value (value={currentStep} in TraceScrubber). */
const storeStep = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector<HTMLInputElement>(
      'input[aria-label="Trace step"]',
    );
    return el ? Number(el.value) : -1;
  });

/** Mulberry32 — deterministic PRNG so SEED replays the exact walk. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 24-cell theme x fixture matrix ───────────────────────────────────────────

type FixtureName = "bsearch" | "print-loop" | "linked-list";

const FIXTURE_STEP: Record<FixtureName, number> = {
  bsearch: 4, // nested helper frame: 2 frame tables + stdout + gutter pair
  "print-loop": 2, // stdout "1\n2\n" visible in program output
  "linked-list": 3, // heap mutation + alias var on id "2", self-cycle on "3"
};

const FIXTURE_NDJSON: Record<FixtureName, () => string> = {
  bsearch: createFrameStdoutNDJSON,
  "print-loop": createPrintLoopNDJSON,
  "linked-list": createHeapPanelNDJSON,
};

for (const theme of THEMES) {
  for (const fixture of Object.keys(FIXTURE_STEP) as FixtureName[]) {
    test(`matrix: [${theme}] x [${fixture}] renders testids + screenshot`, async ({
      page,
    }) => {
      const errors = collectErrors(page);
      await setupWithMock(page, FIXTURE_NDJSON[fixture]());
      const tag = `[palette=${theme} fixture=${fixture}]`;

      await page.getByLabel("Theme").selectOption(theme);
      await expect(
        page.evaluate(() => document.documentElement.dataset.theme),
        `${tag} data-theme not applied`,
      ).resolves.toBe(theme);

      await goToStep(page, FIXTURE_STEP[fixture]);

      if (fixture === "bsearch") {
        await expect(
          page.getByTestId("frame-table"),
          `${tag} frame-table missing (expected 2 nested frames)`,
        ).toHaveCount(2);
        await expect(
          page.getByTestId("program-output"),
          `${tag} program-output missing`,
        ).toBeVisible();
        await expect(
          page.getByTestId("gutter-prev"),
          `${tag} gutter-prev missing`,
        ).toBeVisible();
        await expect(
          page.getByTestId("gutter-next"),
          `${tag} gutter-next missing`,
        ).toBeVisible();
      } else if (fixture === "print-loop") {
        const box = page.getByTestId("program-output");
        await expect(
          box,
          `${tag} program-output missing`,
        ).toBeVisible();
        await expect(
          box,
          `${tag} program-output should show grown stdout "1\\n2"`,
        ).toContainText("2");
        // Scrubber + step label prove the step connection on this fixture.
        await expect(
          page.locator('input[aria-label="Trace step"]'),
          `${tag} scrubber missing`,
        ).toBeVisible();
        await expect(
          page.getByText(/^Step 3 \/ 5/),
          `${tag} step label wrong (expected Step 3 / 5)`,
        ).toBeVisible();
      } else {
        // linked-list: heap panel is collapsed by default — expand BEFORE
        // asserting, or the cell reads stale collapsed state.
        const panel = page.getByTestId("heap-panel");
        await expect(
          panel,
          `${tag} heap-panel missing`,
        ).toBeVisible();
        await panel.getByRole("button", { name: /heap/i }).click();
        await expect(
          panel.getByTestId("heap-node"),
          `${tag} heap-node missing (expected 3 after expand)`,
        ).toHaveCount(3);
        await expect(
          panel.getByTestId("alias-edge"),
          `${tag} alias-edge missing (ids "2" and "3" each have 2 inbound)`,
        ).toHaveCount(2);
      }

      await page.screenshot({
        path: `../.omo/evidence/matrix-${theme}-${fixture}.png`,
        animations: "disabled",
        fullPage: false,
      });

      expect(errors, `${tag} console/page errors:\n${errors.join("\n")}`).toEqual(
        [],
      );
    });
  }
}

// ── Seeded random-walk scrub ─────────────────────────────────────────────────

test("scrub random-walk: 200 seeded jumps, displayed step == store step, zero errors", async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors = collectErrors(page);
  const seed = Number(process.env.SEED ?? 31);
  const rand = mulberry32(seed);

  await setupWithMock(page, createMockNDJSON());
  const total = await page.evaluate(() => {
    const el = document.querySelector<HTMLInputElement>(
      'input[aria-label="Trace step"]',
    );
    return el ? Number(el.max) + 1 : -1;
  });
  expect(total, "trace total steps unreadable from slider max").toBeGreaterThan(1);

  // Expand-then-step: a collapsed identical-steps group shows a "Steps A–B"
  // range label instead of a single step — expand so every jump asserts 1:1.
  const expandBtn = page.getByLabel("Expand compressed step group");
  if (await expandBtn.isVisible().catch(() => false)) {
    await expandBtn.click();
    await page.waitForTimeout(300);
  }

  const slider = page.locator('input[aria-label="Trace step"]');
  for (let jump = 0; jump < 200; jump++) {
    const target = Math.floor(rand() * total);
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
    }, target);
    // Short settle: walk asserts plumbing, not paint.
    await page.waitForTimeout(120);

    // Render never crashes: scrubber + state panel survive every jump.
    // Snapshot diagnostics BEFORE asserting so a crash names the step.
    const sliderVisible = await slider
      .isVisible()
      .catch(() => false);
    if (!sliderVisible) {
      const bodyLen = await page
        .evaluate(() => document.body.innerHTML.length)
        .catch(() => -1);
      throw new Error(
        `[seed=${seed} jump=${jump}] scrubber vanished after jump to ${target} ` +
          `(body ${bodyLen} chars). errors so far:\n${errors.join("\n") || "(none)"}`,
      );
    }
    const stored = await storeStep(page);
    expect(
      stored,
      `[seed=${seed} jump=${jump}] store step ${stored} != jump target ${target}`,
    ).toBe(target);

    // Displayed step always equals store step.
    const label = await page
      .getByText(/^Steps? \d+/)
      .first()
      .textContent()
      .catch(() => null);
    expect(
      label,
      `[seed=${seed} jump=${jump}] no step label after jump to ${target}`,
    ).not.toBeNull();
    const m = label!.match(/^Steps? (\d+)(?:–(\d+))? \/ (\d+)/);
    expect(
      m,
      `[seed=${seed} jump=${jump}] unparseable step label "${label}"`,
    ).not.toBeNull();
    if (m![2]) {
      // Collapsed identical group: store step must fall inside the range.
      const lo = Number(m![1]) - 1;
      const hi = Number(m![2]) - 1;
      expect(
        stored >= lo && stored <= hi,
        `[seed=${seed} jump=${jump}] store ${stored} outside displayed ${label}`,
      ).toBe(true);
    } else {
      expect(
        Number(m![1]) - 1,
        `[seed=${seed} jump=${jump}] displayed "${label}" != store ${stored}`,
      ).toBe(stored);
    }
    expect(
      Number(m![3]),
      `[seed=${seed} jump=${jump}] total changed mid-walk`,
    ).toBe(total);
  }

  expect(
    errors,
    `random-walk console/page errors (seed=${seed}):\n${errors.join("\n")}`,
  ).toEqual([]);
});
