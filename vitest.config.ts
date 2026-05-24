import { fileURLToPath } from "node:url";

// Resolve @codenuke/* package names to each slice's source entry. This lets
// slices import one another by package name without a prior install; once
// `pnpm install` links the workspace, these aliases become redundant.
//
// NOTE: exported as a plain object (not via `defineConfig`) so this config has
// no `vitest/config` import to resolve — the modernized tree has no local
// node_modules; tests run through the repo's pinned vitest binary.
const entry = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default {
  resolve: {
    alias: {
      "@codenuke/stats": entry("./packages/stats/src/main/stats.ts"),
      "@codenuke/value-proxy": entry("./packages/value-proxy/src/main/value-proxy.ts"),
      "@codenuke/json": entry("./packages/json-io/src/main/json.ts"),
      "@codenuke/guards": entry("./packages/guards/src/main/guards.ts"),
      "@codenuke/measure": entry("./packages/measure/src/main/measure.ts"),
      "@codenuke/exec": entry("./packages/exec/src/main/exec.ts"),
      "@codenuke/config": entry("./packages/config/src/main/config.ts"),
      "@codenuke/artifacts": entry("./packages/artifacts/src/main/artifacts.ts"),
      "@codenuke/substrate": entry("./packages/substrate/src/main/index.ts"),
      "@codenuke/changecost": entry("./packages/changecost/src/main/changecost.ts"),
      "@codenuke/calibrate": entry("./packages/calibrate/src/main/calibrate.ts"),
      "@codenuke/fence/runtime": entry("./packages/fence/src/main/runtime.ts"),
      "@codenuke/fence": entry("./packages/fence/src/main/fence.ts"),
      "@codenuke/scorer": entry("./packages/scorer/src/main/scorer.ts"),
      "@codenuke/orchestrator/runtime": entry("./packages/orchestrator/src/main/runtime.ts"),
      "@codenuke/orchestrator": entry("./packages/orchestrator/src/main/orchestrator.ts"),
    },
  },
  test: {
    include: ["**/src/test/**/*.test.ts"],
    exclude: ["**/dist/**", "**/node_modules/**"],
  },
};
