// Hardening task #1: fit gain weights on a labeled cross-repo corpus, and fix the
// unit-incomparability flaw (gain = dL + dCx + 0.5dDup is dominated by dL).
//
// Method:
//  1. Mine commits from codenuke + opencode; weak-label by message (refactor vs feature).
//  2. Extract per-commit gain components (dL, dDup, dCx) via git show + measure().
//  3. Show raw gain is ~collinear with dL (the flaw).
//  4. Robust-scale components; fit logistic regression (refactor=1 vs feature=0) on a
//     train split; report held-out AUC vs baselines (dL-only, raw composite).
//
// Usage: node experiments/weights/fit.mjs

import { execSync } from "node:child_process";
import { measure } from "../metric-separation/lib.mjs";

const CODENUKE_REPO = process.env.CODENUKE_REPO ?? process.cwd();
const OPENCODE_REPO = process.env.OPENCODE_REPO ?? "/tmp/opencode-good";
const REPOS = [
  { name: "codenuke", dir: CODENUKE_REPO, src: "src" },
  { name: "opencode", dir: OPENCODE_REPO, src: "packages/core/src" },
];
const CAP_PER_CLASS = 70;
const MAX_FILES = 25;

const REFACTOR = /\b(refactor|extract|consolidat|dedup|de-dup|reuse|simplif|inline|collapse|\bshare(d)?\b|hoist|unify|remove|delete|drop|prune|slim|centralize)\b/i;
const FEATURE = /(^|\W)(feat|add|adds|added|implement|introduce|support)\b/i;

function sh(cmd, dir) {
  try { return execSync(cmd, { cwd: dir, maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "ignore"] }).toString(); }
  catch { return null; }
}
function label(subject) {
  if (REFACTOR.test(subject)) return "refactor";
  if (FEATURE.test(subject)) return "feature";
  return null;
}
function changedSource(dir, c, src) {
  const out = sh(`git diff --name-only ${c}^ ${c} -- ${src}`, dir) || "";
  return out.split("\n").map((s) => s.trim())
    .filter((p) => /\.(ts|tsx)$/.test(p) && !/\.d\.ts$/.test(p) && !/\.(test|spec)\./.test(p));
}
function tree(dir, c, paths) {
  const files = {};
  for (const p of paths) { const x = sh(`git show ${c}:${p}`, dir); if (x !== null) files[p] = x; }
  return files;
}
function components(dir, c, src) {
  const paths = changedSource(dir, c, src);
  if (paths.length === 0 || paths.length > MAX_FILES) return null;
  const b = measure(tree(dir, `${c}^`, paths));
  const a = measure(tree(dir, c, paths));
  return { dL: b.L - a.L, dDup: b.dupMass - a.dupMass, dCx: b.complexity - a.complexity, nFiles: paths.length };
}

function mine() {
  const rows = [];
  for (const repo of REPOS) {
    const log = sh(`git log --no-merges --pretty=format:%H%x09%s -n 1500`, repo.dir) || "";
    const counts = { refactor: 0, feature: 0 };
    for (const line of log.split("\n")) {
      const tab = line.indexOf("\t");
      if (tab < 0) continue;
      const hash = line.slice(0, tab), subject = line.slice(tab + 1);
      const lab = label(subject);
      if (!lab || counts[lab] >= CAP_PER_CLASS) continue;
      const c = components(repo.dir, hash, repo.src);
      if (!c) continue;
      rows.push({ repo: repo.name, hash, label: lab, ...c });
      counts[lab] += 1;
    }
    console.log(`  mined ${repo.name}: refactor=${counts.refactor} feature=${counts.feature}`);
  }
  return rows;
}

// ---- stats helpers ----
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mad = (xs, med) => 1.4826 * median(xs.map((x) => Math.abs(x - med))) + 1e-9;
function pearson(xs, ys) {
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; num += a * b; dx += a * a; dy += b * b; }
  return num / (Math.sqrt(dx * dy) + 1e-9);
}
function auc(scores, labels) { // labels: 1 positive, 0 negative
  const pos = [], neg = [];
  scores.forEach((s, i) => (labels[i] ? pos : neg).push(s));
  if (!pos.length || !neg.length) return NaN;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}
const stdev = (xs, m) => Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
function logistic(X, y, iters = 5000, lr = 0.1, lambda = 1.0) {
  const d = X[0].length; let w = new Array(d).fill(0); let b = 0;
  for (let it = 0; it < iters; it++) {
    const gw = new Array(d).fill(0); let gb = 0;
    for (let i = 0; i < X.length; i++) {
      const z = X[i].reduce((s, xj, j) => s + xj * w[j], b);
      const p = 1 / (1 + Math.exp(-z)); const e = p - y[i];
      for (let j = 0; j < d; j++) gw[j] += e * X[i][j];
      gb += e;
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / X.length + lambda * w[j]); // L2
    b -= (lr * gb) / X.length;
  }
  return { w, b };
}

console.log("\n=== mining cross-repo corpus ===");
const rows = mine();
const refac = rows.filter((r) => r.label === "refactor");
const feat = rows.filter((r) => r.label === "feature");
console.log(`\n  total: ${rows.length}  (refactor=${refac.length}, feature=${feat.length})`);
const mean = (xs, k) => (xs.reduce((s, r) => s + r[k], 0) / (xs.length || 1)).toFixed(1);
console.log(`  refactor means: dL=${mean(refac, "dL")} dDup=${mean(refac, "dDup")} dCx=${mean(refac, "dCx")}`);
console.log(`  feature means : dL=${mean(feat, "dL")} dDup=${mean(feat, "dDup")} dCx=${mean(feat, "dCx")}`);

// ---- the flaw: raw gain ~ collinear with dL ----
const rawGain = rows.map((r) => r.dL + r.dCx + 0.5 * r.dDup);
console.log(`\n=== unit-domination flaw ===`);
console.log(`  corr(raw gain, dL)  = ${pearson(rawGain, rows.map((r) => r.dL)).toFixed(3)}`);
console.log(`  corr(raw gain, dCx) = ${pearson(rawGain, rows.map((r) => r.dCx)).toFixed(3)}`);
console.log(`  corr(raw gain, dDup)= ${pearson(rawGain, rows.map((r) => r.dDup)).toFixed(3)}`);
console.log(`  -> raw gain is essentially dL; dCx and dDup are ignored.`);

// ---- robust scale + logistic fit (train/test split) ----
const keys = ["dL", "dDup", "dCx"];
const mu = {}, sc = {};
for (const k of keys) {
  const xs = rows.map((r) => r[k]);
  const m = xs.reduce((a, c) => a + c, 0) / xs.length;
  mu[k] = m;
  sc[k] = Math.max(stdev(xs, m), 1e-6); // standardize by stdev with a floor (dDup ~constant)
}
const z = (r) => keys.map((k) => (r[k] - mu[k]) / sc[k]);

// deterministic split by hash parity
const train = rows.filter((_, i) => i % 3 !== 0);
const test = rows.filter((_, i) => i % 3 === 0);
const Xtr = train.map(z), ytr = train.map((r) => (r.label === "refactor" ? 1 : 0));
const { w, b } = logistic(Xtr, ytr);
console.log(`\n=== fitted weights (robust-scaled features) ===`);
keys.forEach((k, j) => console.log(`  w[${k}] = ${w[j].toFixed(3)}`));
console.log(`  bias   = ${b.toFixed(3)}`);

const scoreScaled = (r) => z(r).reduce((s, xj, j) => s + xj * w[j], b);
const yTest = test.map((r) => (r.label === "refactor" ? 1 : 0));
console.log(`\n=== held-out AUC (refactor vs feature) ===`);
console.log(`  dL only        : ${auc(test.map((r) => r.dL), yTest).toFixed(3)}`);
console.log(`  raw composite  : ${auc(test.map((r) => r.dL + r.dCx + 0.5 * r.dDup), yTest).toFixed(3)}`);
console.log(`  scaled + fitted: ${auc(test.map(scoreScaled), yTest).toFixed(3)}`);
console.log("");
