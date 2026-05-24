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
      "@codenuke/stats": entry("./stats/src/main/stats.ts"),
      "@codenuke/value-proxy": entry("./value-proxy/src/main/value-proxy.ts"),
      "@codenuke/json": entry("./json-io/src/main/json.ts"),
      "@codenuke/guards": entry("./guards/src/main/guards.ts"),
      "@codenuke/measure": entry("./measure/src/main/measure.ts"),
      "@codenuke/exec": entry("./exec/src/main/exec.ts"),
      "@codenuke/config": entry("./config/src/main/config.ts"),
      "@codenuke/artifacts": entry("./artifacts/src/main/artifacts.ts"),
      "@codenuke/substrate": entry("./substrate/src/main/index.ts"),
      "@codenuke/changecost": entry("./changecost/src/main/changecost.ts"),
      "@codenuke/calibrate": entry("./calibrate/src/main/calibrate.ts"),
      "@codenuke/fence/runtime": entry("./fence/src/main/runtime.ts"),
      "@codenuke/fence": entry("./fence/src/main/fence.ts"),
      "@codenuke/scorer": entry("./scorer/src/main/scorer.ts"),
      "@codenuke/orchestrator": entry("./orchestrator/src/main/orchestrator.ts"),
    },
  },
  test: {
    include: ["**/src/test/**/*.test.ts"],
    exclude: ["**/dist/**", "**/node_modules/**"],
  },
};
