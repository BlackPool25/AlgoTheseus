import { defineConfig } from "@playwright/test";

/**
 * Playwright config for DSA Visualizer visual tests.
 *
 * Starts the Vite dev server before tests, runs against it.
 * Screenshots are stored in frontend/tests/screenshots/.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : 1,
  timeout: 60000,
  expect: {
    toHaveScreenshot: {
      threshold: 0.01, // 1% pixel diff tolerance per component
    },
  },
  use: {
    baseURL: "http://localhost:3000",
    viewport: { width: 1280, height: 800 },
    actionTimeout: 15000,
    trace: "on-first-retry",
  },
  webServer: {
    command: "bun run dev",
    port: 3000,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
