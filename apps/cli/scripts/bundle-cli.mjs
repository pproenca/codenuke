#!/usr/bin/env node
import { chmodSync, copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const appRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const repoRoot = resolve(appRoot, "../..");
const dist = resolve(appRoot, "dist");

const aliases = new Map([
  ["@codenuke/artifacts", "packages/artifacts/src/main/artifacts.ts"],
  ["@codenuke/calibrate", "packages/calibrate/src/main/calibrate.ts"],
  ["@codenuke/changecost", "packages/changecost/src/main/changecost.ts"],
  ["@codenuke/config", "packages/config/src/main/config.ts"],
  ["@codenuke/exec", "packages/exec/src/main/exec.ts"],
  ["@codenuke/fence", "packages/fence/src/main/fence.ts"],
  ["@codenuke/fence/runtime", "packages/fence/src/main/runtime.ts"],
  ["@codenuke/guards", "packages/guards/src/main/guards.ts"],
  ["@codenuke/json", "packages/json-io/src/main/json.ts"],
  ["@codenuke/measure", "packages/measure/src/main/measure.ts"],
  ["@codenuke/orchestrator", "packages/orchestrator/src/main/orchestrator.ts"],
  ["@codenuke/orchestrator/runtime", "packages/orchestrator/src/main/runtime.ts"],
  ["@codenuke/scorer", "packages/scorer/src/main/scorer.ts"],
  ["@codenuke/stats", "packages/stats/src/main/stats.ts"],
  ["@codenuke/substrate", "packages/substrate/src/main/index.ts"],
  ["@codenuke/value-proxy", "packages/value-proxy/src/main/value-proxy.ts"],
]);

const workspaceAliasPlugin = {
  name: "workspace-alias",
  setup(build) {
    build.onResolve({ filter: /^@codenuke(?:\/[a-z-]+)+(?:\/runtime)?$/ }, (args) => {
      const target = aliases.get(args.path);
      if (!target) return undefined;
      return { path: resolve(repoRoot, target) };
    });
  },
};

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: [resolve(appRoot, "src/main/cli.ts")],
  outfile: resolve(dist, "cli.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  define: { "import.meta.url": "undefined" },
  plugins: [workspaceAliasPlugin],
  logLevel: "info",
});

copyFileSync(resolve(repoRoot, "packages/config/src/main/program.md"), resolve(dist, "program.md"));
chmodSync(resolve(dist, "cli.cjs"), 0o755);
