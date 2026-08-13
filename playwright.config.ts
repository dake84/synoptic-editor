import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/behaviour",
  fullyParallel: true,
  reporter: "list",
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
