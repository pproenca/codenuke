#!/usr/bin/env node
// Guided setup for a new substrate in the proxy↔𝒱̂ validation loop.
//
//   pnpm benchmark-add <repo-path> [name]
//
// Detects the repo's config, scaffolds codenuke.benchmarks/<name>/ (a GUIDE, an example
// co-varying δ, a scripted-implementer stub, a deterministic test-gate stub), appends a
// substrates.json entry, and prints the checklist of the parts only you can author: the
// co-varying change-requests and the candidate refs. It cannot write those for you — picking
// the change-relevant duplication is the design-sensitive step (see GUIDE.md).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../../loop/config.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const repoArg = process.argv[2];
if (!repoArg) {
  console.error("usage: pnpm benchmark-add <repo-path> [name]");
  process.exit(1);
}
const repo = resolve(repoArg);
const name = process.argv[3] || basename(repo);
if (!existsSync(`${repo}/.git`)) {
  console.error(`error: ${repo} is not a git repository`);
  process.exit(1);
}

let detected = { srcDir: "src", testCommand: "npm test" };
try {
  const C = loadConfig({ ...process.env, CN_REPO: repo }, repo);
  detected = { srcDir: C.srcDir, testCommand: C.testCommand, regions: C.regions };
} catch {}

const benchDir = `${repoRoot}/codenuke.benchmarks/${name}`;
if (existsSync(benchDir)) {
  console.error(`error: ${benchDir} already exists — pick another name or remove it`);
  process.exit(1);
}
mkdirSync(`${benchDir}/example-delta`, { recursive: true });

writeFileSync(
  `${benchDir}/GUIDE.md`,
  `# Benchmark: ${name}

Held-out change-cost benchmark for proxy↔𝒱̂ validation. Lives here in codenuke (not in the
substrate) so the substrate stays pristine and this is held-out from the proposer by construction.

Detected: srcDir=\`${detected.srcDir}\`  testCommand=\`${detected.testCommand}\`

## What you must author (the design-sensitive part)
1. **Co-varying δ's.** Each \`<id>/{meta.json, accept.test.ts}\` is a realistic change-request whose
   cost DEPENDS on the reduced structure — i.e. it MODIFIES code the loop deduplicates, so dedup
   makes it cheaper (or over-dedup makes it costlier). Additive/disjoint changes give a FLAT 𝒱̂ and
   prove nothing — target the *change-relevant* duplication (the kind future changes actually touch),
   not stable-complete or already-DRY structure.
2. **A deterministic test gate** (\`run-tests.mjs\`): runs the suite with NO flaky/network/meta tests,
   and auto-includes installed accept tests. Edit the stub to exclude this repo's flaky files.
3. **Candidate refs**: in substrates.json, a \`baseline\` + \`candidates[]\` (git refs in the substrate)
   spanning a reduction range — e.g. a duplicated baseline and one or more deduplicated variants.

## Run
\`pnpm validate-substrates ${name}\`
`,
);

writeFileSync(
  `${benchDir}/example-delta/meta.json`,
  JSON.stringify(
    {
      id: "example-delta",
      title: "REPLACE: a change that MODIFIES the reduced structure",
      region: detected.srcDir,
      prompt:
        "REPLACE: describe a realistic change whose minimal implementation is cheaper when the duplicated structure has been deduplicated (and costlier when it hasn't). Edit only non-test source under the region.",
      acceptPath: `REPLACE/path/in/the/repo/test/example-delta.accept.test`,
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  `${benchDir}/example-delta/accept.test.ts`,
  `// REPLACE with the substrate's test framework. Must FAIL on the baseline and PASS once the
// change is implemented. changecost installs this file at the meta.json acceptPath.
`,
);

writeFileSync(
  `${benchDir}/implementer.mjs`,
  `// Deterministic scripted implementer (INV-5). Runs in the substrate worktree with CN_DELTA set.
// Apply the reference implementation for each delta to non-test source under the region, then exit.
// (Use implementer=null in substrates.json instead to let the codex LLM implementer adapt per
// candidate — required for 𝒱̂ to co-vary, but billable.)
import { readFileSync, writeFileSync } from "node:fs"
const delta = process.env.CN_DELTA
if (delta === "example-delta") {
  // REPLACE: edit files under ${detected.srcDir}/ (paths relative to the worktree root).
  void readFileSync
  void writeFileSync
} else {
  console.error(\`scripted implementer: unknown CN_DELTA "\${delta}"\`)
  process.exit(1)
}
`,
);

writeFileSync(
  `${benchDir}/run-tests.mjs`,
  `// Deterministic test gate. Runs from the substrate worktree (cwd). Edit to exclude this repo's
// flaky/network/meta tests; keep installed accept tests in scope. Default: the detected command.
import { spawnSync } from "node:child_process"
const r = spawnSync(${JSON.stringify(detected.testCommand)}, { shell: true, stdio: "inherit" })
process.exit(r.status ?? 1)
`,
);

const cfgPath = `${repoRoot}/evals/substrates.json`;
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
if (cfg.substrates.some((s) => s.name === name)) {
  console.error(`error: substrates.json already has "${name}"`);
  process.exit(1);
}
cfg.substrates.push({
  name,
  repo: relative(`${repoRoot}/evals`, repo),
  srcDir: detected.srcDir,
  testCommand: "node {bench}/run-tests.mjs",
  implementer: `node {bench}/implementer.mjs`,
  baseline: "REPLACE_BASELINE_REF",
  candidates: ["REPLACE_C0_REF", "REPLACE_C1_REF"],
});
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");

console.log(`✓ scaffolded codenuke.benchmarks/${name}/ and added a substrates.json entry.

Detected:  srcDir=${detected.srcDir}  testCommand=${detected.testCommand}

Next (see codenuke.benchmarks/${name}/GUIDE.md):
  1. Author co-varying δ's   → codenuke.benchmarks/${name}/<id>/{meta.json,accept.test.ts}
  2. Fix the test gate        → codenuke.benchmarks/${name}/run-tests.mjs (drop flaky/meta tests)
  3. Set candidate refs       → substrates.json: baseline + candidates[] (dup → deduped variants)
  4. Run                      → pnpm validate-substrates ${name}`);
