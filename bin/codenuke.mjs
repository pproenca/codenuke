#!/usr/bin/env node
// codenuke loop — autonomous behavior-preserving code reduction.
// Thin dispatcher to the engine in ../loop. Run from your repo root (or set CN_REPO).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const engine = (f) => fileURLToPath(new URL(`../loop/${f}`, import.meta.url));
const packageVersion = () =>
  JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"))
    .version;
const run = (file, args = []) => {
  try {
    execFileSync("node", [engine(file), ...args], { stdio: "inherit", env: process.env });
  } catch (e) {
    process.exit(e.status ?? 1);
  }
};

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "--version" || cmd === "-v") {
  console.log(packageVersion());
  process.exit(0);
}
switch (cmd) {
  case "fence":
    run("fence.mjs", rest);
    break; // measure per-region behavior-fence fidelity (periodic)
  case "run":
  case "loop":
    run("autoloop.mjs", rest);
    break; // the autonomous loop
  case "changecost":
    run("changecost.mjs", rest);
    break; // evaluate change-cost on the benchmark (periodic)
  case "calibrate":
    run("calibrate.mjs", rest);
    break; // derive per-repo value scales
  case "doctor":
    run("doctor.mjs", rest);
    break; // preflight readiness check
  case "init":
  case "score":
  case "accept":
  case "revert":
  case "status":
  case "cleanup":
    run("scorer.mjs", [cmd, ...rest]);
    break; // manual scorer ops
  default:
    console.log(`codenuke loop — autonomous behavior-preserving code reduction

  Karpathy's autoresearch loop, applied to refactoring: an agent proposes a
  reduction, an immutable metric judges it, keep-if-genuinely-smaller-and-behavior-
  preserved, else revert. Runs in an isolated git worktree; your tree is untouched.

usage (run from your repo root):
  codenuke fence [cap=60] [seed=1337]   measure each region's behavior-fence fidelity
  codenuke run [iterations=5]           run the loop (propose → score → keep/revert)
  codenuke score [--json]               score the current worktree change
  codenuke changecost [ref]             evaluate change-cost on your benchmark (periodic)
  codenuke calibrate                    derive per-repo value scales
  codenuke doctor                       report readiness or precise gaps
  codenuke init | accept | revert | status | cleanup

config: codenuke.loop.json at the repo root, or CN_* env. Auto-detects src dir,
test runner, typecheck, and source regions. See README. First run 'fence' so the
loop has a measured fence to gate on.`);
    if (cmd) {
      process.stderr.write(`error: unknown command: ${cmd}\n`);
      process.exit(2);
    }
}
