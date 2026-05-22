// M3 — the autonomous proposer loop (SPEC §3.4), with the TWO moves that make it work
// on a real (sub-1.0) fence:
//
//   reduce — when the target region's fence is admissible (G1′: Wilson lo ≥ 0.90),
//            propose a behavior-preserving reduction; keep iff loss < 0.
//   raise  — when the region is fence-BLOCKED, propose CHARACTERIZATION TESTS that kill
//            the surviving mutants (GOAL.md M1: "blocked OR given characterization tests
//            until they clear it"); re-measure via monotonic replay; keep the tests iff
//            they raised the fence. The loop earns the right to refactor.
//
// No human in the loop. Proposer = headless `claude -p` editing only the worktree
// (no Bash/git ⇒ cannot touch the scorer = immutability). Scorer = loop.mjs (immutable).
//
//   node experiments/loop/autoloop.mjs [iterations=3]
//
// Env: CN_BASE (init baseline; use 2d81f6c), CN_TARGET (region dir, default src/mappers/),
//      CN_TAG (autoresearch branch suffix, default run), CN_BUDGET (USD/iter, default 0.40),
//      CN_PROPOSER (shell-cmd override for tests), CN_FIDELITY (fence artifact for scorer).

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { loopConfig, raiseReadiness } from "./lib.mjs";

const CONFIG = loopConfig();
const MAIN = CONFIG.main;
const WT = CONFIG.worktree;
const LOOP = `${MAIN}/experiments/loop/loop.mjs`;
const FIDELITY = CONFIG.fidelityScript;
const PROGRAM = CONFIG.program;
const RESULTS = CONFIG.results;
const ART = CONFIG.fidelity;
const STATE = CONFIG.state;
const PROMPT_FILE = CONFIG.promptFile;

const N = Number(process.argv[2]) || 3;
const TARGET = CONFIG.target;
const REGION = CONFIG.region;
const BRANCH = CONFIG.branch;
const BUDGET = process.env.CN_BUDGET ?? "1.50"; // raise (read source + write tests) needs > $0.40
const PROPOSER = process.env.CN_PROPOSER;
const PROPOSER_TIMEOUT = 300000;

const sh = (cmd, opts = {}) => { const r = execSync(cmd, { maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"], env: process.env, ...opts }); return r ? r.toString() : ""; };
const shTry = (cmd, opts = {}) => { try { return { ok: true, out: sh(cmd, opts) }; } catch (e) { return { ok: false, out: (e.stdout?.toString() || "") + (e.stderr?.toString() || ""), killed: !!e.killed }; } };
const cleanWT = () => { shTry(`git -C ${WT} reset --hard HEAD`); shTry(`git -C ${WT} clean -fdq src`); };
const perr = (p) => (p.out || "").replace(/\s+/g, " ").slice(-200); // surface the proposer's real error
const loadArt = () => { try { return JSON.parse(readFileSync(ART, "utf8")); } catch { return null; } };
const wtDirty = () => shTry(`git -C ${WT} status --porcelain src`).out.trim().length > 0;

function logRow(iter, commit, dAST, dCx, behavior, mfence, loss, status, desc) {
  appendFileSync(RESULTS, `${iter}\t${commit}\t${dAST}\t${dCx}\t${behavior}\t${mfence}\t${loss}\t${status}\t${desc}\n`);
  console.log(`  → [${status.toUpperCase()}] iter ${iter}  ${desc}`);
}

function proposer(prompt) {
  if (PROPOSER) return shTry(PROPOSER, { cwd: WT, timeout: PROPOSER_TIMEOUT });
  writeFileSync(PROMPT_FILE, prompt);
  // --no-session-persistence: isolate each proposer so concurrent `claude -p` instances
  // (this session + the loop + parallel runs) don't collide on session storage (the
  // intermittent empty-output non-zero exits seen in the cli runs).
  const cmd = `claude -p --permission-mode bypassPermissions --no-session-persistence --allowedTools ${JSON.stringify("Edit Write Read Grep Glob")} --max-budget-usd ${BUDGET} --output-format json < ${PROMPT_FILE}`;
  return shTry(cmd, { cwd: WT, timeout: PROPOSER_TIMEOUT });
}

const reducePrompt = () =>
  `${readFileSync(PROGRAM, "utf8")}\n\n---\nYou are running now. Target region: ${TARGET} (other regions are fence-blocked). ` +
  `Make exactly ONE behavior-preserving reduction in a single file under ${TARGET}, then stop. Do not run commands; just edit.`;

function raisePrompt(survivorSpecs) {
  const shown = survivorSpecs.slice(0, 12).map((s) => {
    let line = "?"; try { const t = readFileSync(`${WT}/${s.rel}`, "utf8"); line = String(t.slice(0, s.start).split("\n").length); } catch {}
    return `  - ${s.rel} line ${line}: operator \`${s.op}\` is not detected by any test`;
  }).join("\n");
  return `You are the fence-raising proposer in codenuke's autoresearch loop. The region ${TARGET} ` +
    `is currently fence-BLOCKED: its test suite fails to detect some behavior changes (mutation-test survivors). ` +
    `Your job: ADD characterization tests (colocated \`*.test.ts\` files under ${TARGET}, vitest) that pin the CURRENT ` +
    `behavior so these mutations would be caught. Do NOT change any source — only add/extend tests.\n\n` +
    `Surviving mutations to cover:\n${shown}\n\n` +
    `Read the relevant source, understand what each operator decides, and write focused tests asserting the real ` +
    `current outputs for inputs that exercise both sides of each operator. Make the tests pass against the current ` +
    `code. Add as many as you can in one focused test file, then stop. Do not run commands; just write tests.`;
}

// ---- ensure worktree + branch + results header ----
if (!existsSync(STATE)) {
  console.log(`no loop state — initializing worktree (CN_BASE=${process.env.CN_BASE ?? "HEAD"})…`);
  sh(`node ${LOOP} init`, { cwd: MAIN, stdio: ["ignore", "inherit", "inherit"] });
  shTry(`git -C ${WT} checkout -B ${BRANCH}`); // trajectory on autoresearch/<tag>
  console.log(`trajectory branch: ${BRANCH}`);
}
if (!existsSync(RESULTS)) writeFileSync(RESULTS, "iter\tcommit\tdAST\tdCx\tbehavior\tmfence_region\tloss\tstatus\tdescription\n");

console.log(`\n=== autoloop: ${N} iters, proposer=${PROPOSER ? "scripted" : "claude -p"}, region=${REGION}, branch=${BRANCH} ===`);
let kept = 0, raised = 0;
for (let i = 1; i <= N; i++) {
  const art = loadArt();
  const region = art?.regions?.[REGION];
  const admissible = region?.admissible === true;
  const mode = admissible ? "reduce" : "raise";
  console.log(`\n----- iteration ${i}/${N}  [${mode}]  ${REGION} fence ${region ? (region.p * 100).toFixed(0) + "% lo=" + (region.lo * 100).toFixed(0) + "%" : "unmeasured"} -----`);

  if (mode === "raise") {
    const readiness = raiseReadiness(region);
    if (readiness.kind === "legacy-survivors") {
      logRow(i, "-", 0, 0, "-", region ? region.p.toFixed(2) : "-", "-", "raise-blocked", `${REGION}: ${readiness.survivorCount} legacy survivors lack replay positions; run AST-aware audit for this region`);
      continue;
    }
    if (readiness.kind === "no-survivors") { logRow(i, "-", 0, 0, "-", region ? region.p.toFixed(2) : "-", "-", "raise-skip", `${REGION}: no survivor specs (need an AST-aware audit)`); continue; }
    const specs = readiness.specs;
    const loBefore = region.lo;
    const p = proposer(raisePrompt(specs));
    if (!p.ok) { logRow(i, "-", 0, 0, "-", region.p.toFixed(2), "-", "crash", `proposer ${p.killed ? "timeout" : "error"}: ${perr(p)}`); cleanWT(); continue; }
    if (!wtDirty()) { logRow(i, "-", 0, 0, "-", region.p.toFixed(2), "-", "raise-noop", "proposer added no tests"); cleanWT(); continue; }
    // guard: raise must touch ONLY test files — survivor specs are positions in the green
    // source, so any source edit would invalidate replay (and could fake a fence rise).
    const changedFiles = shTry(`git -C ${WT} status --porcelain -- src`).out.split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
    const nonTest = changedFiles.filter((f) => !/\.test\.tsx?$/.test(f));
    if (nonTest.length) { logRow(i, "-", 0, 0, "-", region.p.toFixed(2), "-", "raise-badtest", `proposer touched non-test source: ${nonTest.join(",")} — reverted`); cleanWT(); continue; }
    // new tests must themselves be green on the current code
    if (shTry(`node_modules/.bin/vitest run --reporter=dot`, { cwd: WT }).ok === false) {
      logRow(i, "-", 0, 0, "-", region.p.toFixed(2), "-", "raise-badtest", "added tests fail on current code — reverted"); cleanWT(); continue;
    }
    // COMMIT the tests BEFORE re-measuring (your lesson): a fresh audit ignores untracked
    // tests, so uncommitted ones don't count and the proposer is re-asked forever. Also
    // crash-safe — the tests survive a replay failure.
    sh(`git -C ${WT} add -A -- src`);
    shTry(`git -C ${WT} -c user.email=loop@codenuke -c user.name=autoloop commit -m "raise(iter ${i}): characterization tests for ${REGION}"`);
    const commit = sh(`git -C ${WT} rev-parse --short HEAD`).trim();
    // monotonic replay: re-run only this region's survivors against the committed worktree.
    // NON-FATAL (shTry) — a replay error must not crash the whole unattended loop.
    const rep = shTry(`node ${FIDELITY} replay ${REGION} ${WT}`, { cwd: MAIN });
    if (!rep.ok) { logRow(i, commit, 0, 0, "true", region.p.toFixed(2), "-", "raise-error", `replay failed: ${perr(rep)}`); continue; }
    const after = loadArt().regions[REGION];
    raised++;
    logRow(i, commit, 0, 0, "true", after.p.toFixed(2), "-", after.lo > loBefore + 1e-9 ? "raise" : "raise-nogain",
      `${REGION} fence ${(loBefore * 100).toFixed(0)}%→${(after.p * 100).toFixed(0)}% lo=${(after.lo * 100).toFixed(0)}%${after.admissible ? " ADMISSIBLE✓" : ""}`);
    continue;
  }

  // reduce mode
  const p = proposer(reducePrompt());
  if (!p.ok) { logRow(i, "-", 0, 0, "-", region.p.toFixed(2), "+Inf", "crash", `proposer ${p.killed ? "timeout" : "error"}: ${perr(p)}`); cleanWT(); continue; }
  const s = shTry(`node ${LOOP} score --json`, { cwd: MAIN });
  const jline = (s.out.split("\n").find((l) => l.startsWith("@@JSON@@")) || "").slice("@@JSON@@".length);
  if (!jline) { logRow(i, "-", 0, 0, "-", region.p.toFixed(2), "-", "noop", "proposer made no scorable src change"); cleanWT(); continue; }
  const v = JSON.parse(jline);
  const mfence = v.mfence != null ? v.mfence.toFixed(2) : "-";
  const lossStr = v.loss != null ? v.loss.toFixed(3) : "+Inf";
  const desc = `${v.files.join(",")}${v.blockedRegions.length ? " blocked:" + v.blockedRegions.join("/") : ""}`;
  if (v.keep) {
    sh(`node ${LOOP} accept`, { cwd: MAIN });
    const commit = sh(`git -C ${WT} rev-parse --short HEAD`).trim();
    kept++;
    logRow(i, commit, v.dL, v.dCx, v.gates.G1, mfence, lossStr, "keep", `ΔAST=${v.dL} ${desc}`);
  } else {
    cleanWT();
    logRow(i, "-", v.dL, v.dCx, v.gates.G1, mfence, lossStr, "revert", `ΔAST=${v.dL} ${desc} | ${v.gates.G1prime ? "" : "G1′ "}${v.gates.G1 ? "" : "G1 "}${v.gates.G3 ? "" : "G3 "}${v.gates.G4 ? "" : "G4↓ "}`.trim());
  }
}

console.log(`\n=== autoloop done: ${kept} kept, ${raised} fence-raises ===`);
sh(`node ${LOOP} status`, { cwd: MAIN, stdio: ["ignore", "inherit", "inherit"] });
console.log(`branch ${BRANCH} | results: ${RESULTS}`);
