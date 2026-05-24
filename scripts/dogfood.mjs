#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(repo, "apps/cli/dist/cli.cjs");
const iterations = process.argv[2] ?? "1";
const fenceCap = process.env.DOGFOOD_FENCE_CAP ?? "60";
const fenceSeed = process.env.DOGFOOD_FENCE_SEED ?? "1337";

function usage() {
  console.log("usage: pnpm dogfood [iterations 1-5]");
}

// Commands are argv-only CommandSpecs now (RULE-048): shell-string CN_TEST /
// CN_TYPECHECK are rejected on sight, so pass file + JSON argv array instead.
const env = {
  ...process.env,
  CN_REPO: process.env.CN_REPO ?? repo,
  CN_SRC: process.env.CN_SRC ?? "packages",
  CN_TARGET: process.env.CN_TARGET ?? "packages",
  CN_TEST_FILE: process.env.CN_TEST_FILE ?? "pnpm",
  CN_TEST_ARGS_JSON: process.env.CN_TEST_ARGS_JSON ?? '["test"]',
  CN_TYPECHECK_FILE: process.env.CN_TYPECHECK_FILE ?? "pnpm",
  CN_TYPECHECK_ARGS_JSON: process.env.CN_TYPECHECK_ARGS_JSON ?? '["typecheck"]',
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

if (iterations === "-h" || iterations === "--help") {
  usage();
  process.exit(0);
}

if (!/^[1-5]$/.test(iterations)) {
  usage();
  process.exit(1);
}

console.log("dogfood codenuke");
console.log(`repo: ${repo}`);
console.log(`src: ${env.CN_SRC}`);
console.log(`target: ${env.CN_TARGET}`);
console.log(`regions: ${env.CN_REGIONS ?? "(auto)"}`);
console.log(`test: ${env.CN_TEST_FILE} ${env.CN_TEST_ARGS_JSON}`);
console.log(`typecheck: ${env.CN_TYPECHECK_FILE} ${env.CN_TYPECHECK_ARGS_JSON}`);

run("build local CLI", "pnpm", ["--filter", "codenuke", "run", "build"]);
run("doctor preflight", "node", [cli, "doctor"], { allowExitCodes: [0, 2] });
run("measure behavior fence", "node", [cli, "fence", fenceCap, fenceSeed]);
run("calibrate value scales", "node", [cli, "calibrate"]);
run("doctor readiness", "node", [cli, "doctor"]);
run("run loop", "node", [cli, "run", iterations]);

console.log("\ncomplete");
