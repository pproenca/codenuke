// Temporal PREDICTIVE (transfer) validity — the Karpathy "it transfers" analog.
//
// Predictor: each file's co-change entanglement measured on the PAST half of history
//            (maintenance commits only; excludes dedup + codegen).
// Outcome  : whether the file is touched by a DEDUP/refactor commit in the FUTURE half.
// No leakage: predictor (structural co-change) and outcome (message-labeled dedup) are
//            independent signals, separated in time.
//
// Control: also score by PAST change-FREQUENCY alone. If co-change beats churn, the
//          signal is real (not just "busy files get refactored").
//
// Stats: AUC + bootstrap 95% CI + permutation p (H1: AUC>0.5), and AUC difference CI
//        (co-change vs churn). Usage: node experiments/stats/predictive.mjs

import { execSync } from "node:child_process";
import { aucFromScores, bootstrapAUC, permutationAUC, bootstrapAUCDiff } from "./lib.mjs";
import { measure } from "../metric-separation/lib.mjs";

const CODENUKE_REPO = process.env.CODENUKE_REPO ?? process.cwd();
const OPENCODE_REPO = process.env.OPENCODE_REPO ?? "/tmp/opencode-good";
const REPOS = [
  ["opencode", OPENCODE_REPO, 1500, false], // blob:none clone — no local blobs for complexity
  ["codenuke", CODENUKE_REPO, 100000, true],
];
const DEDUP = /\b(extract|share|shared|dedup|de-dup|consolidat|reuse|unify|hoist|centralize|merge)\b/i;
const CODEGEN = /\b(generate|generated|snapshot|lockfile|bump|format|prettier|lint|version)\b/i;
const isSrc = (p) => /\.(ts|tsx)$/.test(p) && !/\.d\.ts$/.test(p) && !/\.(test|spec)\./.test(p);
const MAXF = 40;

function commits(dir, n) {
  let raw;
  try { raw = execSync(`git -C ${dir} log --reverse --no-merges --name-only --pretty=format:%x01%H%x02%s -n ${n}`, { maxBuffer: 1 << 30 }).toString(); }
  catch { return []; }
  const out = [];
  for (const block of raw.split("\x01").slice(1)) {
    const nl = block.indexOf("\n");
    const head = block.slice(0, nl).split("\x02");
    const hash = head[0], subject = head[1] ?? "";
    const files = [...new Set(block.slice(nl + 1).split("\n").map((s) => s.trim()).filter(isSrc))];
    out.push({ hash, subject, files });
  }
  return out;
}

const pk = (a, b) => (a < b ? a + "\t" + b : b + "\t" + a);

function analyze(name, dir, n, hasBlobs) {
  const cs = commits(dir, n);
  if (cs.length < 40) { console.log(`\n${name}: too little history (${cs.length} commits)`); return; }
  const mid = Math.floor(cs.length / 2);
  const past = cs.slice(0, mid), future = cs.slice(mid);

  // PAST predictors (maintenance only)
  const pastMaint = past.filter((c) => !DEDUP.test(c.subject) && !CODEGEN.test(c.subject) && c.files.length <= MAXF);
  const changes = new Map(), co = new Map();
  for (const { files } of pastMaint) {
    for (const f of files) changes.set(f, (changes.get(f) ?? 0) + 1);
    for (let i = 0; i < files.length; i++) for (let j = i + 1; j < files.length; j++) { const k = pk(files[i], files[j]); co.set(k, (co.get(k) ?? 0) + 1); }
  }
  const coTax = new Map();
  for (const [k, c] of co) { const [a, b] = k.split("\t"); coTax.set(a, (coTax.get(a) ?? 0) + c); coTax.set(b, (coTax.get(b) ?? 0) + c); }

  // FUTURE outcome: dedup targets
  const futureTargets = new Set();
  for (const c of future) if (DEDUP.test(c.subject) && !CODEGEN.test(c.subject) && c.files.length <= MAXF) for (const f of c.files) futureTargets.add(f);

  // candidates = files seen in PAST maintenance (have a predictor)
  const candidates = [...changes.keys()];
  const labels = candidates.map((f) => (futureTargets.has(f) ? 1 : 0));
  const coScores = candidates.map((f) => coTax.get(f) ?? 0);            // raw co-change (∝ churn)
  const coNormScores = candidates.map((f) => (coTax.get(f) ?? 0) / (changes.get(f) ?? 1)); // entanglement per change
  const churnScores = candidates.map((f) => changes.get(f) ?? 0);
  // complexity density at the PAST/FUTURE boundary commit (the surviving state signal — does it transfer?)
  // Needs local blobs; skip on blob:none clones (opencode).
  const boundary = cs[mid].hash;
  const cxScores = hasBlobs
    ? candidates.map((f) => {
        try { const src = execSync(`git -C ${dir} show ${boundary}:${f}`, { maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }).toString(); const m = measure({ [f]: src }); return m.L > 0 ? (m.complexity / m.L) * 1000 : 0; }
        catch { return 0; }
      })
    : null;
  const nPos = labels.filter((x) => x === 1).length, nNeg = labels.length - nPos;

  console.log(`\n=== ${name} ===`);
  console.log(`  commits=${cs.length}  past=${past.length} future=${future.length}  candidates=${candidates.length}  future-refactored=${nPos} (neg=${nNeg})`);
  if (nPos < 5 || nNeg < 5) { console.log(`  too few positives/negatives for a stable AUC — skipping test`); return; }

  const report = (lbl, scores, ctrl) => {
    const auc = aucFromScores(scores, labels);
    const ci = bootstrapAUC(scores, labels);
    const perm = permutationAUC(scores, labels);
    let extra = "";
    if (ctrl) { const d = bootstrapAUCDiff(scores, ctrl, labels); extra = `  Δvs-churn=${d.diff.toFixed(3)} CI [${d.lo.toFixed(3)}, ${d.hi.toFixed(3)}]`; }
    const sig = ci.lo > 0.5 && perm.p < 0.05;
    console.log(`  ${lbl.padEnd(22)} AUC=${auc.toFixed(3)}  95% CI [${ci.lo.toFixed(3)}, ${ci.hi.toFixed(3)}]  perm p=${perm.p.toFixed(4)}  ${sig ? "SIG" : "ns"}${extra}`);
    return { auc, ci, perm };
  };
  report("churn (control)", churnScores, null);
  report("co-change raw", coScores, churnScores);
  report("co-change/churn (norm)", coNormScores, churnScores);
  if (cxScores) report("complexity density", cxScores, churnScores);
  else console.log(`  complexity density      n/a (blob:none clone — blobs not local)`);
}

console.log("Temporal predictive validity: PAST co-change -> FUTURE refactor locations");
for (const [name, dir, n, hasBlobs] of REPOS) analyze(name, dir, n, hasBlobs);
console.log("");
