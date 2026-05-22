// M1 — per-region fence-fidelity audit (SPEC §4 G1′; GOAL.md M1), AST-AWARE.
//
// Two modes:
//   audit  (default): node fidelity.mjs [cap=60] [seed=1337] [regions=all]
//     Deterministic seeded mutant sampling per region, from green 2d81f6c, in an
//     isolated worktree. Emits the pinned artifact fence-fidelity.json the scorer reads.
//   replay: node fidelity.mjs replay <region> [worktree=/tmp/cn-loop]
//     Re-runs ONLY a region's prior survivors against a worktree (which may have new
//     characterization tests). Adding tests can only KILL survivors, never resurrect a
//     caught mutant, so this monotonic re-audit is cheap — it's how the loop's
//     fence-raising move measures progress without a full re-audit.
//
// AST-aware: mutates only real TypeScript operators (BinaryExpression operators,
// .startsWith/.endsWith calls, boolean `return` literals) — NOT characters that merely
// look like operators inside string/data literals. That removes "equivalent mutants"
// (unkillable, no behavior change) that depressed the literal-string audit's scores and
// could put the 0.90 bar permanently out of reach.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import ts from "typescript";
import { wilson } from "../stats/lib.mjs";

const MAIN = process.env.CODENUKE_REPO ?? process.cwd();
const OUT = `${MAIN}/experiments/mutation/fence-fidelity.json`;
const GREEN_REF = "2d81f6c";
const THRESHOLD = 0.9;
const TIMEOUT_MS = 45000; // a hang (sync infinite loop from a flipped loop guard) = caught

const isSrc = (p) => /\.(ts|tsx)$/.test(p) && !/\.d\.ts$/.test(p) && !/\.(test|spec)\./.test(p);
const sh = (c, cwd, timeout) => { const r = execSync(c, { cwd, maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"], timeout, killSignal: "SIGKILL" }); return r ? r.toString() : ""; };
function runTests(cwd) {
  try { sh("node_modules/.bin/vitest run --reporter=dot", cwd, TIMEOUT_MS); return "green"; }
  catch (e) { if (e && (e.killed || e.signal === "SIGKILL")) { try { execSync("pkill -9 -f vitest"); } catch {} return "timeout"; } return "fail"; }
}

// ---- AST-aware mutation sites ----
const OP = {
  [ts.SyntaxKind.LessThanToken]: ">", [ts.SyntaxKind.GreaterThanToken]: "<",
  [ts.SyntaxKind.LessThanEqualsToken]: ">=", [ts.SyntaxKind.GreaterThanEqualsToken]: "<=",
  [ts.SyntaxKind.EqualsEqualsEqualsToken]: "!==", [ts.SyntaxKind.ExclamationEqualsEqualsToken]: "===",
  [ts.SyntaxKind.AmpersandAmpersandToken]: "||", [ts.SyntaxKind.BarBarToken]: "&&",
};
function collectSites(name, text) {
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, /\.tsx$/.test(name) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const sites = [];
  const push = (start, end, repl) => sites.push({ start, end, repl, op: `${text.slice(start, end)}→${repl}` });
  (function visit(node) {
    if (ts.isBinaryExpression(node) && OP[node.operatorToken.kind] !== undefined) {
      push(node.operatorToken.getStart(sf), node.operatorToken.getEnd(), OP[node.operatorToken.kind]);
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const nm = node.expression.name.text;
      if (nm === "startsWith" || nm === "endsWith") push(node.expression.name.getStart(sf), node.expression.name.getEnd(), nm === "startsWith" ? "endsWith" : "startsWith");
    } else if (ts.isReturnStatement(node) && node.expression && (node.expression.kind === ts.SyntaxKind.TrueKeyword || node.expression.kind === ts.SyntaxKind.FalseKeyword)) {
      const t = node.expression.kind === ts.SyntaxKind.TrueKeyword;
      push(node.expression.getStart(sf), node.expression.getEnd(), t ? "false" : "true");
    }
    ts.forEachChild(node, visit);
  })(sf);
  return sites;
}
const applyMutant = (text, s) => text.slice(0, s.start) + s.repl + text.slice(s.end);

// ---- deterministic PRNG (mulberry32) + seeded shuffle ----
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffle(arr, rng) { for (let i = arr.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

const REGIONS = ["mappers", "workflow", "platform", "mapping", "provider", "cli"];
const filesIn = (region, ref) => (sh(`git ls-tree -r --name-only ${ref} -- src/${region}`, MAIN) || "").split("\n").map((s) => s.trim()).filter(isSrc);

// =================== REPLAY MODE (monotonic re-audit of survivors) ===================
if (process.argv[2] === "replay") {
  const region = process.argv[3];
  const WT = process.argv[4] || "/tmp/cn-loop";
  const art = JSON.parse(readFileSync(OUT, "utf8"));
  const r = art.regions[region];
  if (!r) { console.error(`no region ${region} in artifact`); process.exit(1); }
  const specs = r.survivorSpecs || [];
  console.log(`replay: re-running ${specs.length} survivor(s) of '${region}' against ${WT} (current ${r.caught}/${r.total} = ${(r.p * 100).toFixed(0)}%)`);
  if (runTests(WT) !== "green") { console.error("worktree baseline not green — abort replay"); process.exit(1); }
  const stillSurviving = [];
  for (const s of specs) {
    const path = `${WT}/${s.rel}`;
    let orig; try { orig = readFileSync(path, "utf8"); } catch { stillSurviving.push(s); continue; }
    writeFileSync(path, applyMutant(orig, s));
    const caught = runTests(WT) !== "green";
    writeFileSync(path, orig);
    if (!caught) stillSurviving.push(s);
    console.log(`  ${caught ? "now CAUGHT " : "still SURV "} ${s.rel.replace("src/", "")} [${s.op}]`);
  }
  r.survivorSpecs = stillSurviving;
  r.caught = r.total - stillSurviving.length;
  const w = wilson(r.caught, r.total);
  Object.assign(r, { p: w.p, lo: w.lo, hi: w.hi, admissible: w.lo >= THRESHOLD });
  writeFileSync(OUT, JSON.stringify(art, null, 2));
  console.log(`\n${region}: ${r.caught}/${r.total} = ${(w.p * 100).toFixed(0)}%  Wilson95 [${(w.lo * 100).toFixed(1)}, ${(w.hi * 100).toFixed(1)}]  ${r.admissible ? "ADMISSIBLE ✓" : "BLOCKED ✗"}`);
  process.exit(0);
}

// =================== AUDIT MODE ===================
const CAP = Number(process.argv[2]) || 60;
const SEED = Number(process.argv[3]) || 1337;
const REGION_FILTER = process.argv[4] ? process.argv[4].split(",") : null;
const capFor = (region) => (region === "mappers" ? Math.round(CAP * 1.5) : CAP);
const WT = "/tmp/cn-fidelity";
const PROGRESS = "/tmp/cn-fidelity-progress.txt";
const logp = (line) => { console.log(line); try { writeFileSync(PROGRESS, line + "\n", { flag: "a" }); } catch {} };

try { sh(`git worktree remove --force ${WT}`, MAIN); } catch {}
sh(`git worktree add -f ${WT} ${GREEN_REF}`, MAIN);
try { symlinkSync(`${MAIN}/node_modules`, `${WT}/node_modules`); } catch {}
try { writeFileSync(PROGRESS, ""); } catch {}
logp(`fence-fidelity audit (AST-aware) @ ${GREEN_REF}  cap=${CAP}/region  seed=${SEED}`);
if (runTests(WT) !== "green") { writeFileSync(OUT, JSON.stringify({ error: "baseline red" })); logp("baseline RED — abort"); process.exit(1); }
logp("baseline GREEN ✓");

const rng = mulberry32(SEED);
const regions = (REGION_FILTER ?? REGIONS).filter((r) => REGIONS.includes(r));
const origCache = new Map();
const plan = {};
let grandTotal = 0;
for (const region of regions) {
  const cands = [];
  for (const rel of filesIn(region, GREEN_REF)) {
    let text; try { text = readFileSync(`${WT}/${rel}`, "utf8"); } catch { continue; }
    origCache.set(rel, text);
    for (const s of collectSites(rel, text)) cands.push({ rel, ...s });
  }
  shuffle(cands, rng);
  plan[region] = cands.slice(0, capFor(region));
  grandTotal += plan[region].length;
  logp(`  region ${region}: ${cands.length} AST sites -> sampling ${plan[region].length}`);
}
logp(`total mutants to run: ${grandTotal}`);

// When auditing a subset of regions, MERGE into the existing artifact so the other
// regions' results (and the scorer's view of them) are preserved.
let out = { baseline: GREEN_REF, generatedAt: new Date().toISOString(), method: "ast-aware", z: 1.96, threshold: THRESHOLD, capPerRegion: CAP, seed: SEED, regions: {} };
if (REGION_FILTER) { try { out = { ...JSON.parse(readFileSync(OUT, "utf8")), generatedAt: out.generatedAt, method: "ast-aware (merged)" }; } catch {} }
const flush = () => {
  const c = Object.values(out.regions).reduce((s, r) => s + r.caught, 0);
  const t = Object.values(out.regions).reduce((s, r) => s + r.total, 0);
  const gw = wilson(c, t);
  out.global = { caught: c, total: t, p: gw.p, lo: gw.lo, hi: gw.hi };
  writeFileSync(OUT, JSON.stringify(out, null, 2));
};
let done = 0, t0 = Date.now();
for (const region of regions) {
  const fileTotals = {};
  const survivorSpecs = [];
  let rCaught = 0, rTotal = 0;
  for (const s of plan[region]) {
    const orig = origCache.get(s.rel);
    const path = `${WT}/${s.rel}`;
    writeFileSync(path, applyMutant(orig, s));
    const res = runTests(WT);
    writeFileSync(path, orig);
    const caught = res !== "green";
    rTotal++; fileTotals[s.rel] = (fileTotals[s.rel] || 0) + 1;
    if (caught) rCaught++; else survivorSpecs.push({ rel: s.rel, start: s.start, end: s.end, repl: s.repl, op: s.op });
    done++;
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    logp(`  [${done}/${grandTotal} ${secs}s] ${res === "green" ? "SURVIVED" : res === "timeout" ? "HUNG→caught" : "CAUGHT  "} ${s.rel.replace("src/", "")} [${s.op}]`);
  }
  const w = wilson(rCaught, rTotal);
  out.regions[region] = { caught: rCaught, total: rTotal, p: w.p, lo: w.lo, hi: w.hi, admissible: w.lo >= THRESHOLD, fileTotals, survivorSpecs };
  logp(`== region ${region}: ${rCaught}/${rTotal} = ${(w.p * 100).toFixed(0)}%  Wilson95 [${(w.lo * 100).toFixed(1)}, ${(w.hi * 100).toFixed(1)}]  ${w.lo >= THRESHOLD ? "ADMISSIBLE ✓" : "BLOCKED ✗"}`);
  flush();
}
const { caught: gC, total: gT } = out.global;
const gw = wilson(gC, gT);
try { rmSync(`${WT}/node_modules`, { force: true }); } catch {}
try { sh(`git worktree remove --force ${WT}`, MAIN); sh("git worktree prune", MAIN); } catch {}
logp(`\nDONE -> ${OUT}`);
logp(`global ${gC}/${gT} = ${(gw.p * 100).toFixed(0)}%  Wilson95 [${(gw.lo * 100).toFixed(1)}, ${(gw.hi * 100).toFixed(1)}]`);
for (const [r, v] of Object.entries(out.regions)) logp(`  ${r.padEnd(10)} ${v.caught}/${v.total}  lo=${(v.lo * 100).toFixed(1)}%  ${v.admissible ? "ADMISSIBLE" : "BLOCKED"}`);
