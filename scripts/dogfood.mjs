#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(repo, "apps/cli/dist/cli.cjs");
const iterations = process.argv[2] ?? "1";
const fenceCap = process.env.DOGFOOD_FENCE_CAP ?? "60";
const fenceSeed = process.env.DOGFOOD_FENCE_SEED ?? "1337";

const env = {
  ...process.env,
  CN_REPO: process.env.CN_REPO ?? repo,
  CN_SRC: process.env.CN_SRC ?? "packages",
  CN_TARGET: process.env.CN_TARGET ?? "packages",
  CN_TEST: process.env.CN_TEST ?? "pnpm test",
  CN_TYPECHECK: process.env.CN_TYPECHECK ?? "pnpm typecheck",
};
if (process.env.CN_REGIONS) {
  env.CN_REGIONS = process.env.CN_REGIONS;
}

function run(label, command, args, options = {}) {
  console.log(`\n==> ${label}`);
  console.log(`$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: repo,
    env,
    stdio: "inherit",
  });
  const status = result.status ?? 1;
  if (options.allowExitCodes?.includes(status)) {
    return status;
  }
  if (status !== 0) {
    console.error(`\nfailed: ${label} exited ${status}`);
    process.exit(status);
  }
  return status;
}

if (!/^[1-5]$/.test(iterations)) {
  console.error("usage: pnpm dogfood [iterations 1-5]");
  process.exit(1);
}

console.log("dogfood codenuke");
console.log(`repo: ${repo}`);
console.log(`src: ${env.CN_SRC}`);
console.log(`target: ${env.CN_TARGET}`);
console.log(`regions: ${env.CN_REGIONS ?? "(auto)"}`);
console.log(`test: ${env.CN_TEST}`);
console.log(`typecheck: ${env.CN_TYPECHECK}`);

run("build local CLI", "pnpm", ["build"]);
run("doctor preflight", "node", [cli, "doctor"], { allowExitCodes: [0, 2] });
run("measure behavior fence", "node", [cli, "fence", fenceCap, fenceSeed]);
run("calibrate value scales", "node", [cli, "calibrate"]);
run("doctor readiness", "node", [cli, "doctor"]);
run("run loop", "node", [cli, "run", iterations]);

console.log("\ncomplete");
