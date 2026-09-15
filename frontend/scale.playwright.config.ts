import { defineConfig } from "@playwright/test";

/**
 * scale.playwright.config.ts — Todo 26 isolated-port bench config.
 *
 * The default config serves :3000 with reuseExistingServer; a sibling
 * snapshot-regen agent may own :3000 concurrently, so this bench runs its
 * OWN Vite instance on :3001 (strictPort) with CI semantics forced:
 * forbidOnly + no server reuse + single worker. Run with CI=1.
 */
export default defineConfig({
  testDir: "./tests",
  testMatch: ["scale-slo.spec.ts"],
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://localhost:3001",
    viewport: { width: 1280, height: 800 },
    actionTimeout: 30000,
  },
  webServer: {
    command: "node ../node_modules/vite/bin/vite.js --port 3001 --strictPort",
    port: 3001,
    reuseExistingServer: false,
    timeout: 60000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
