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

function sourceWithMutationSites(count) {
  return (
    Array.from(
      { length: count },
      (_, index) => `export const isAbove${index} = (value: number): boolean => value > ${index};`,
    ).join("\n") + "\n"
  );
}

try {
  mkdirSync(fixtureRoot, { recursive: true });
  write("package.json", JSON.stringify({ name: "loop-eval", type: "module" }, null, 2));
  write("src/index.ts", sourceWithMutationSites(35));
  write(
    "proposer.mjs",
    [
      'import { writeFileSync } from "node:fs";',
      'writeFileSync("src/index.ts", "export const isAbove0 = (value: number): boolean => value > 0;\\n");',
      "",
    ].join("\n"),
  );
  run("git", ["init"]);
  run("git", ["config", "user.email", "test@example.com"]);
  run("git", ["config", "user.name", "Test User"]);
  run("git", ["config", "commit.gpgsign", "false"]);
  run("git", ["add", "."]);
  run("git", ["commit", "-m", "initial"]);

  const env = {
    CN_TEST: `${process.execPath} -e "const fs=require('fs');process.exit(fs.readFileSync('src/index.ts','utf8').includes(' < ')?1:0)"`,
    CN_PROPOSER: `${process.execPath} proposer.mjs`,
    CN_TAG: `eval-${Date.now()}`,
    CN_WORKTREE: join(tmp, "worktree"),
    CN_STATE: join(tmp, "state.json"),
  };
  const initialDoctor = runResult(process.execPath, [cli, "doctor"], { env });
  assert(initialDoctor.status === 2, `expected initial doctor exit 2, got ${initialDoctor.status}`);
  assert(initialDoctor.stdout.includes("fence: missing"), "expected initial doctor to need fence");

  const sourceBeforeRun = readFileSync(join(fixtureRoot, "src/index.ts"), "utf8");
  run(process.execPath, [cli, "fence", "35", "1337"], { env });
  const fence = JSON.parse(readFileSync(join(fixtureRoot, ".codenuke", "fence-fidelity.json")));
  assert(fence.regions?.src?.total === 35, "expected fence to write 35 src mutation samples");
  assert(fence.regions?.src?.admissible === true, "expected all-caught fence to admit src");

  run(process.execPath, [cli, "calibrate"], { env });
  const calibration = JSON.parse(readFileSync(join(fixtureRoot, ".codenuke", "calibration.json")));
  assert(calibration.scales?.sL > 0, "expected positive sL calibration scale");
  assert(calibration.scales?.sCx > 0, "expected positive sCx calibration scale");
  assert(calibration.scales?.sDup > 0, "expected positive sDup calibration scale");

  const readyDoctor = runResult(process.execPath, [cli, "doctor"], { env });
  assert(readyDoctor.status === 0, `expected ready doctor exit 0, got ${readyDoctor.status}`);

  const loop = runResult(process.execPath, [cli, "run", "1"], { env });
  assert(
    loop.status === 0,
    `expected run to keep a reduction, got ${loop.status}\nstdout:\n${loop.stdout}\nstderr:\n${loop.stderr}`,
  );
  const results = readFileSync(join(fixtureRoot, ".codenuke", "results.tsv"), "utf8");
  assert(results.includes("\tkeep\t"), "expected run results to include a kept reduction");
  assert(!results.includes("\traise-skip\t"), "expected run not to hit raise-skip");
  assert(
    readFileSync(join(fixtureRoot, "src/index.ts"), "utf8") === sourceBeforeRun,
    "expected user worktree source to remain untouched",
  );

  console.log("PASS loop-cli: doctor/fence/calibrate/run kept reduction");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
