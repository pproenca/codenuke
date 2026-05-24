import { defineConfig } from "vitest/config";

// Root Vitest config. TypeScript is transpiled on the fly, and pnpm workspace
// symlinks resolve `@codenuke/*` imports to each package's `src/index.ts`
// (their `exports` map), so tests run without a prior build step.
export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    globals: false,
  },
});
