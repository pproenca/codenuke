#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(new URL("../..", import.meta.url).pathname);
const cli = join(repoRoot, "bin", "codenuke.mjs");
const tmp = mkdtempSync(join(tmpdir(), "codenuke-loop-eval-"));
const fixtureRoot = join(tmp, "repo");

function write(path, contents) {
  const full = join(fixtureRoot, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents, "utf8");
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? fixtureRoot,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
  });
}

function runResult(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? fixtureRoot,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.error) throw result.error;
  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  mkdirSync(fixtureRoot, { recursive: true });
  write("package.json", JSON.stringify({ name: "loop-eval", type: "module" }, null, 2));
  write("src/index.ts", "export const isPositive = (value: number): boolean => value > 0;\n");
  run("git", ["init"]);
  run("git", ["config", "user.email", "test@example.com"]);
  run("git", ["config", "user.name", "Test User"]);
  run("git", ["config", "commit.gpgsign", "false"]);
  run("git", ["add", "."]);
  run("git", ["commit", "-m", "initial"]);

  const env = {
    CN_TEST: `${process.execPath} -e "process.exit(0)"`,
    CN_PROPOSER: "true",
  };
  const initialDoctor = runResult(process.execPath, [cli, "doctor"], { env });
  assert(initialDoctor.status === 2, `expected initial doctor exit 2, got ${initialDoctor.status}`);
  assert(initialDoctor.stdout.includes("fence: missing"), "expected initial doctor to need fence");

  run(process.execPath, [cli, "fence", "1", "1337"], { env });
  const fence = JSON.parse(readFileSync(join(fixtureRoot, ".codenuke", "fence-fidelity.json")));
  assert(fence.regions?.src?.total === 1, "expected fence to write one src mutation sample");

  run(process.execPath, [cli, "calibrate"], { env });
  const calibration = JSON.parse(readFileSync(join(fixtureRoot, ".codenuke", "calibration.json")));
  assert(calibration.scales?.sL > 0, "expected positive sL calibration scale");
  assert(calibration.scales?.sCx > 0, "expected positive sCx calibration scale");
  assert(calibration.scales?.sDup > 0, "expected positive sDup calibration scale");

  const readyDoctor = runResult(process.execPath, [cli, "doctor"], { env });
  assert(readyDoctor.status === 0, `expected ready doctor exit 0, got ${readyDoctor.status}`);
  console.log("PASS loop-cli: doctor/fence/calibrate readiness");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
