// Hardening task #3: systematic fence audit (replaces stubbed mfence=1).
// Inject behavior mutations across covered files, run the pinned test suite per
// mutant, measure the fraction CAUGHT = fence power (mutation score).
//
// Runs in an isolated worktree (user tree untouched). Usage: node experiments/mutation/audit.mjs

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs";

const MAIN = process.env.CODENUKE_REPO ?? process.cwd();
const WT = "/tmp/cn-mut";

// Behavior-changing mutation operators (applied to the first match per op per file).
const OPS = [
  [/ < /, " > ", "< → >"],
  [/ <= /, " >= ", "<= → >="],
  [/ === /, " !== ", "=== → !=="],
  [/ && /, " || ", "&& → ||"],
  [/return true;/, "return false;", "return true → false"],
  [/\.startsWith\(/, ".endsWith(", "startsWith → endsWith"],
];

// Files with real test coverage (colocated or exercised by the suite).
const TARGETS = [
  "src/workflow/selection.ts",
  "src/workflow/findings.ts",
  "src/platform/toml.ts",
  "src/mapping/heuristic.ts",
  "src/workflow/reporting.ts",
  "src/provider/json.ts",
  "src/workflow/feature-equivalence.ts",
  "src/platform/id.ts",
];
const MAX_MUTANTS = 16;

function sh(cmd, cwd) {
  return execSync(cmd, { cwd, maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] }).toString();
}
function testsPass(cwd) {
  try { sh("node_modules/.bin/vitest run --reporter=dot", cwd); return true; }
  catch { return false; } // non-zero exit = a test failed = mutation CAUGHT
}

// ---- setup isolated worktree ----
try { sh(`git worktree remove --force ${WT}`, MAIN); } catch {}
sh(`git worktree add -f ${WT} HEAD`, MAIN);
try { symlinkSync(`${MAIN}/node_modules`, `${WT}/node_modules`); } catch {}

console.log("\n=== fence audit: baseline (clean) must be green ===");
if (!testsPass(WT)) { console.log("  baseline RED — abort"); process.exit(1); }
console.log("  baseline GREEN ✓\n");

// ---- generate + run mutants ----
const results = [];
outer: for (const rel of TARGETS) {
  const path = `${WT}/${rel}`;
  let original;
  try { original = readFileSync(path, "utf8"); } catch { continue; }
  for (const [re, repl, name] of OPS) {
    if (results.length >= MAX_MUTANTS) break outer;
    if (!re.test(original)) continue;
    const mutated = original.replace(re, repl);
    if (mutated === original) continue;
    writeFileSync(path, mutated);
    const caught = !testsPass(WT);
    writeFileSync(path, original); // restore
    results.push({ rel: rel.replace("src/", ""), name, caught });
    console.log(`  ${caught ? "CAUGHT  " : "SURVIVED"}  ${rel.replace("src/", "")}  [${name}]`);
  }
}

// ---- cleanup ----
try { rmSync(`${WT}/node_modules`, { force: true }); } catch {}
try { sh(`git worktree remove --force ${WT}`, MAIN); sh("git worktree prune", MAIN); } catch {}

const caught = results.filter((r) => r.caught).length;
const score = results.length ? caught / results.length : 0;
console.log(`\n=== mutation score (fence power) = ${caught}/${results.length} = ${(score * 100).toFixed(0)}% ===`);
console.log(
  score >= 0.7
    ? "Fence has teeth: most behavior changes are caught."
    : "Fence is weak: many behavior changes survive — coverage gaps.",
);
const survivors = results.filter((r) => !r.caught);
if (survivors.length) {
  console.log("\nSurvivors (fence blind spots — where a refactor could change behavior undetected):");
  for (const s of survivors) console.log(`  ${s.rel}  [${s.name}]`);
}
console.log("");
