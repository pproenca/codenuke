// Round-1 single-agent refactoring loop ("one model before the swarm").
// The harness owns scoring + keep/revert/stack; the PROPOSER (an agent editing the
// worktree) is pluggable. Runs in an isolated worktree — user tree untouched.
//
// Flow:  init  ->  [proposer edits worktree]  ->  score  ->  accept | revert  ->  repeat
//
//   node experiments/loop/loop.mjs init     # worktree @ HEAD, verify GREEN baseline
//   node experiments/loop/loop.mjs score    # score working-tree change vs HEAD -> KEEP/REJECT
//   node experiments/loop/loop.mjs accept    # commit candidate (advance baseline, stack)
//   node experiments/loop/loop.mjs revert    # discard candidate
//   node experiments/loop/loop.mjs status    # cumulative reduction since round start

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, symlinkSync, rmSync } from "node:fs";
import { measure } from "../metric-separation/lib.mjs";
import { loopConfig } from "./lib.mjs";

const CONFIG = loopConfig();
const MAIN = CONFIG.main;
const WT = CONFIG.worktree;
const STATE = CONFIG.state; // OUTSIDE the worktree — never committed/reset by git ops on WT
const TARGET = CONFIG.target;

// Relative importances (experiments/weights: ẑCx:ẑL:ẑDup ≈ 1.8:1:0.35) applied to
// z-scored components (d/SCALE). NOT the logistic log-odds coefficients — those are
// for classification, not a value scale; using them double-shrinks gain vs risk.
const W = { dL: 1.0, dCx: 1.8, dDup: 0.35 };
const SCALE = { dL: 150, dCx: 15, dDup: 5 };
const REGION_MULT = 2.4; // mappers: recurring-co-change tax (experiments/cochange)
const R3 = 1.0; // weight on residual fence-risk r3·(1 − mfence_region) (METRIC.md §1.4)

// G1′ — per-region fence-fidelity gate (M1). The scorer reads a PINNED audit
// artifact (mutation testing is a periodic calibration, not per-run — SPEC §3): a
// region is admissible only if its measured fence has Wilson 95% CI lower bound ≥
// 0.90 (GOAL.md M1). Unmeasured regions FAIL CLOSED (unknown fence = unsafe).
const FIDELITY = CONFIG.fidelity;
const loadFidelity = () => { try { return JSON.parse(readFileSync(FIDELITY, "utf8")); } catch { return null; } };
const regionOf = (p) => p.replace(/^src\//, "").split("/")[0]; // src/mappers/x.ts -> mappers

const sh = (cmd, opts = {}) => execSync(cmd, { cwd: WT, maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"], ...opts }).toString();
const shMain = (cmd) => execSync(cmd, { cwd: MAIN, maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] }).toString();
const tryExit = (cmd) => { try { sh(cmd); return 0; } catch (e) { return e.status ?? 1; } };
const readState = () => JSON.parse(readFileSync(STATE, "utf8"));
const isSrc = (p) => /\.(ts|tsx)$/.test(p) && !/\.d\.ts$/.test(p) && !/\.(test|spec)\./.test(p);

function changedSource() {
  return (sh(`git diff --name-only HEAD -- src`) || "").split("\n").map((s) => s.trim()).filter(isSrc);
}
function showAt(ref, path) { try { return sh(`git show ${ref}:${path}`); } catch { return null; } }

function vitest() { return tryExit("node_modules/.bin/vitest run --reporter=dot") === 0; }
function tscErrors() {
  try { sh("node_modules/.bin/tsc -p tsconfig.json --noEmit"); return 0; }
  catch (e) { return (e.stdout?.toString() || "").split("\n").filter((l) => /error TS/.test(l)).length || 1; }
}
function targetL(ref) {
  const files = (sh(`git ls-tree -r --name-only ${ref} -- ${TARGET}`) || "").split("\n").map((s) => s.trim()).filter(isSrc);
  const map = {};
  for (const f of files) { const c = showAt(ref, f); if (c !== null) map[f] = c; }
  return measure(map).L;
}

const cmd = process.argv[2];

if (cmd === "init") {
  // Baseline ref: defaults to HEAD, override with CN_BASE (HEAD is currently red —
  // use the known-green commit 2d81f6c). After checkout the worktree's HEAD = BASE,
  // so every later `HEAD` reference correctly tracks the advancing baseline.
  const BASE = process.env.CN_BASE ?? "HEAD";
  try { shMain(`git worktree remove --force ${WT}`); } catch {}
  shMain(`git worktree add -f ${WT} ${BASE}`);
  try { symlinkSync(`${MAIN}/node_modules`, `${WT}/node_modules`); } catch {}
  console.log("verifying GREEN baseline (vitest + tsc)…");
  const green = vitest();
  const tsc0 = tscErrors();
  if (!green) { console.log("baseline tests RED — abort"); process.exit(1); }
  const startL = targetL("HEAD");
  writeState({ baselineTsc: tsc0, startTargetL: startL, accepted: [], iter: 0 });
  console.log(`baseline GREEN ✓  tscErrors=${tsc0}  ${TARGET} astNodes=${startL}`);
  console.log(`\nproposer: edit files under ${WT}/${TARGET} to reduce code (preserve behavior), then 'score'.`);
}

else if (cmd === "score") {
  const st = readState();
  const changed = changedSource();
  if (changed.length === 0) { console.log("no candidate (working tree clean) — proposer must edit first."); process.exit(0); }
  const before = measure(Object.fromEntries(changed.map((p) => [p, showAt("HEAD", p) ?? ""]).filter(([, c]) => c !== null)));
  const after = measure(Object.fromEntries(changed.map((p) => [p, existsSync(`${WT}/${p}`) ? readFileSync(`${WT}/${p}`, "utf8") : ""])));
  const dL = before.L - after.L, dDup = before.dupMass - after.dupMass, dCx = before.complexity - after.complexity;

  console.log(`\ncandidate touches ${changed.length} file(s): ${changed.map((p) => p.replace("src/", "")).join(", ")}`);

  // G1′ — per-region fence-fidelity gate (read the pinned audit; fail closed).
  const fidelity = loadFidelity();
  const touchedRegions = [...new Set(changed.map(regionOf))];
  const fenceOf = (r) => fidelity?.regions?.[r] ?? null;
  const blockedRegions = touchedRegions.filter((r) => !(fenceOf(r)?.admissible === true));
  const G1prime = fidelity != null && blockedRegions.length === 0;

  console.log("running gates…");
  const G1 = vitest();                                   // behavior fence (pinned suite)
  const tscNow = tscErrors(); const G3 = tscNow <= st.baselineTsc; // type soundness
  const G4 = dL > 0;                                     // size reduction
  const admissible = G1 && G1prime && G3 && G4;

  const inRegion = changed.some((p) => p.startsWith(TARGET));
  const valBase = W.dL * (dL / SCALE.dL) + W.dCx * (dCx / SCALE.dCx) + W.dDup * (dDup / SCALE.dDup);
  const gain = valBase * (inRegion ? REGION_MULT : 1);
  const diffsize = Number(((sh(`git diff --shortstat HEAD -- src`) || "").match(/(\d+) insert/)?.[1]) ?? 0) +
                   Number(((sh(`git diff --shortstat HEAD -- src`) || "").match(/(\d+) delet/)?.[1]) ?? 0);
  // residual fence-risk: worst (lowest) measured fence among touched admissible regions.
  const mfence = touchedRegions.length ? Math.min(...touchedRegions.map((r) => fenceOf(r)?.p ?? 0)) : 1;
  const risk = 0.002 * diffsize + R3 * (1 - mfence);
  const loss = admissible ? risk - gain : Infinity;
  const keep = admissible && loss < 0; // magnitude floor: value must exceed risk

  const Y = (b) => (b ? "✓" : "✗");
  const fenceTxt = G1prime
    ? `all clear (mfence=${(mfence * 100).toFixed(0)}%)`
    : fidelity == null ? "NO AUDIT (fail-closed)" : `blocked: ${blockedRegions.map((r) => `${r}[lo=${((fenceOf(r)?.lo ?? 0) * 100).toFixed(0)}%]`).join(", ")}`;
  console.log(`\n  gates:  G1 behavior ${Y(G1)}   G1′ fence-fidelity ${Y(G1prime)} (${fenceTxt})`);
  console.log(`          G3 types ${Y(G3)} (tsc ${tscNow}/${st.baselineTsc})   G4 size↓ ${Y(G4)}`);
  console.log(`  value:  ΔL=${dL}  ΔCx=${dCx}  ΔDup=${dDup}  region=${inRegion ? "mapper×" + REGION_MULT : "other"}`);
  console.log(`  gain=${gain.toFixed(4)}  risk=${risk.toFixed(4)}  loss=${Number.isFinite(loss) ? loss.toFixed(4) : "+Inf"}`);
  const why = !G1prime ? "REJECT ❌ (G1′ fence-fidelity: region not trusted to ≥0.90)" : !admissible ? "REJECT ❌ (gate failed)" : keep ? "KEEP ✅ (admissible, loss improves)" : "REJECT (no positive gain)";
  console.log(`\n  VERDICT: ${why}\n`);

  // Machine-readable verdict for the autonomous driver (autoloop.mjs). Sentinel-
  // prefixed so it's trivially greppable amid the human output.
  if (process.argv.includes("--json")) {
    process.stdout.write("@@JSON@@" + JSON.stringify({
      admissible, keep, loss: Number.isFinite(loss) ? loss : null, gain, risk,
      dL, dCx, dDup, mfence, touchedRegions, blockedRegions,
      gates: { G1, G1prime, G3, G4 }, files: changed.map((p) => p.replace("src/", "")),
    }) + "\n");
  }
}

else if (cmd === "accept") {
  const st = readState();
  if (changedSource().length === 0) { console.log("nothing to accept."); process.exit(0); }
  sh(`git add -A -- src`); // only source reductions enter the trajectory (never state/test junk)
  sh(`git -c user.email=loop@codenuke -c user.name=round1 commit -m "round1: accepted refactor"`);
  st.iter += 1; st.accepted.push(sh("git rev-parse --short HEAD").trim());
  writeState(st);
  console.log(`accepted (iteration ${st.iter}). baseline advanced; propose next.`);
}

else if (cmd === "revert") { sh(`git checkout -- .`); try { sh(`git clean -fd src`); } catch {} console.log("candidate reverted."); }

else if (cmd === "status") {
  const st = readState();
  const nowL = targetL("HEAD");
  const startL = st.startTargetL ?? st.startMappersL;
  const cut = startL - nowL;
  console.log(`round-1 status: iterations=${st.iter}  accepted=[${st.accepted.join(", ")}]`);
  console.log(`${TARGET} astNodes: ${startL} -> ${nowL}  (cumulative reduction ${cut}, ${((cut / startL) * 100).toFixed(1)}%)`);
}

else if (cmd === "cleanup") { try { rmSync(`${WT}/node_modules`, { force: true }); } catch {} try { rmSync(STATE); } catch {} try { shMain(`git worktree remove --force ${WT}`); shMain("git worktree prune"); } catch {} console.log("worktree removed."); }

else console.log("usage: loop.mjs init|score|accept|revert|status|cleanup");

function writeState(s) { writeFileSync(STATE, JSON.stringify(s, null, 2)); }
