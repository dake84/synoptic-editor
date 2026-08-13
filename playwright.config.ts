import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/behaviour",
  fullyParallel: true,
  reporter: "list",
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      command:
        "npm run harness:build && npx --yes serve harness -l 4173 --no-request-logging",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command:
        "npm run spike:phase0:build && npx --yes serve spikes/phase-0 -l 4174 --no-request-logging",
      url: "http://127.0.0.1:4174",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  use: {
    baseURL: "http://127.0.0.1:4173",
  },
});
