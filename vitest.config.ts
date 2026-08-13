import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "risk-gate/**/*.test.ts"],
    passWithNoTests: true,
  },
});
