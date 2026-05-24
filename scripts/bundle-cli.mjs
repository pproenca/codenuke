#!/usr/bin/env node
import { chmodSync, copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const dist = resolve(root, "dist");

const aliases = new Map([
  ["@codenuke/artifacts", "artifacts/src/main/artifacts.ts"],
  ["@codenuke/calibrate", "calibrate/src/main/calibrate.ts"],
  ["@codenuke/changecost", "changecost/src/main/changecost.ts"],
  ["@codenuke/config", "config/src/main/config.ts"],
  ["@codenuke/exec", "exec/src/main/exec.ts"],
  ["@codenuke/fence", "fence/src/main/fence.ts"],
  ["@codenuke/fence/runtime", "fence/src/main/runtime.ts"],
  ["@codenuke/guards", "guards/src/main/guards.ts"],
  ["@codenuke/json", "json-io/src/main/json.ts"],
  ["@codenuke/measure", "measure/src/main/measure.ts"],
  ["@codenuke/orchestrator", "orchestrator/src/main/orchestrator.ts"],
  ["@codenuke/scorer", "scorer/src/main/scorer.ts"],
  ["@codenuke/stats", "stats/src/main/stats.ts"],
  ["@codenuke/substrate", "substrate/src/main/index.ts"],
  ["@codenuke/value-proxy", "value-proxy/src/main/value-proxy.ts"],
]);

const workspaceAliasPlugin = {
  name: "workspace-alias",
  setup(build) {
    build.onResolve({ filter: /^@codenuke(?:\/[a-z-]+)+(?:\/runtime)?$/ }, (args) => {
      const target = aliases.get(args.path);
      if (!target) return undefined;
      return { path: resolve(root, target) };
    });
  },
};

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: [resolve(root, "orchestrator/src/main/cli.ts")],
  outfile: resolve(dist, "cli.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  define: { "import.meta.url": "undefined" },
  plugins: [workspaceAliasPlugin],
  logLevel: "info",
});

copyFileSync(resolve(root, "config/src/main/program.md"), resolve(dist, "program.md"));
chmodSync(resolve(dist, "cli.cjs"), 0o755);
