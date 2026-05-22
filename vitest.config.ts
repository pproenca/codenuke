import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "experiments/**/*.test.mjs"],
    restoreMocks: true,
    testTimeout: 30_000,
  },
});
