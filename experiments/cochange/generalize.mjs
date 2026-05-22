// Hardening task #2: does recurring-maintenance co-change generalize across repos?
//
// Repo-agnostic, self-labeling test:
//  - "tax files" = files touched by the developer's own DEDUP/refactor commits
//    (extract|share|dedup|consolidate|reuse|unify|hoist) that touch >=2 source files.
//  - Build co-change ONLY from NON-dedup, NON-codegen maintenance commits (exclude
//    the labeling commits -> no circularity).
//  - Prediction: tax files show elevated recurring co-change vs baseline, in EVERY
//    repo (the tax keeps recurring outside the dedup attempts).
//
// Usage: node experiments/cochange/generalize.mjs

import { execSync } from "node:child_process";

const optionalRepo = (label, envName) => (process.env[envName] ? [[label, process.env[envName]]] : []);
const REPOS = [
  ["codenuke", process.env.CODENUKE_REPO ?? process.cwd()],
  ["opencode", process.env.OPENCODE_REPO ?? "/tmp/opencode-good"],
  ...optionalRepo("extra-1", "EXTRA_REPO_1"),
  ...optionalRepo("extra-2", "EXTRA_REPO_2"),
];
const DEDUP = /\b(extract|share|shared|dedup|de-dup|consolidat|reuse|unify|hoist|centralize|merge)\b/i;
const CODEGEN = /\b(generate|generated|snapshot|lockfile|bump|format|prettier|lint|version)\b/i;
const isSrc = (p) => /\.(ts|tsx)$/.test(p) && !/\.d\.ts$/.test(p) && !/\.(test|spec)\./.test(p);
const MAXF = 40;

function commits(dir) {
  let raw;
  try { raw = execSync(`git -C ${dir} log --no-merges --name-only --pretty=format:%x01%H%x02%s -n 4000`, { maxBuffer: 1 << 30 }).toString(); }
  catch { return []; }
  const out = [];
  for (const block of raw.split("\x01").slice(1)) {
    const nl = block.indexOf("\n");
    const subject = block.slice(0, nl).split("\x02")[1] ?? "";
    const files = [...new Set(block.slice(nl + 1).split("\n").map((s) => s.trim()).filter(isSrc))];
    if (files.length >= 1) out.push({ subject, files });
  }
  return out;
}

const pk = (a, b) => (a < b ? a + "" + b : b + "" + a);
function stats(cs) {
  const changes = new Map(), co = new Map();
  for (const { files } of cs) {
    if (files.length > MAXF) continue;
    for (const f of files) changes.set(f, (changes.get(f) ?? 0) + 1);
    for (let i = 0; i < files.length; i++) for (let j = i + 1; j < files.length; j++) {
      const k = pk(files[i], files[j]); co.set(k, (co.get(k) ?? 0) + 1);
    }
  }
  return { changes, co };
}
function jac(a, b, S) {
  const cab = S.co.get(pk(a, b)) ?? 0; const u = (S.changes.get(a) ?? 0) + (S.changes.get(b) ?? 0) - cab;
  return u > 0 ? cab / u : 0;
}
function meanJacOf(files, S) {
  const present = [...new Set(files)].filter((f) => (S.changes.get(f) ?? 0) > 0);
  let s = 0, n = 0;
  for (let i = 0; i < present.length; i++) for (let j = i + 1; j < present.length; j++) { s += jac(present[i], present[j], S); n++; }
  return { mean: n ? s / n : 0, present: present.length, pairs: n };
}
function baseline(S, samples = 5000) {
  const files = [...S.changes.keys()]; if (files.length < 2) return 0;
  let s = 0;
  for (let n = 0; n < samples; n++) {
    const a = files[(Math.random() * files.length) | 0], b = files[(Math.random() * files.length) | 0];
    if (a === b) { n--; continue; }
    s += jac(a, b, S);
  }
  return s / samples;
}

console.log("\n=== generalization: recurring-maintenance co-change of developer-labeled tax files ===\n");
console.log(["repo".padEnd(18), "taxFiles", "clusterJac", "baseline", "ratio", "verdict"].join("  "));
let pass = 0, total = 0;
for (const [name, dir] of REPOS) {
  const cs = commits(dir);
  if (cs.length === 0) { console.log(`  ${name}: no history`); continue; }
  const taxFiles = new Set();
  for (const c of cs) if (DEDUP.test(c.subject) && !CODEGEN.test(c.subject) && c.files.length >= 2 && c.files.length <= MAXF)
    for (const f of c.files) taxFiles.add(f);
  const maintenance = cs.filter((c) => !DEDUP.test(c.subject) && !CODEGEN.test(c.subject));
  const S = stats(maintenance); // co-change EXCLUDING the dedup commits (no circularity)
  const cl = meanJacOf([...taxFiles], S);
  const base = baseline(S);
  const ratio = base > 0 ? cl.mean / base : 0;
  const verdict = ratio >= 1.5 ? "ELEVATED ✓" : "flat";
  total++; if (verdict.startsWith("ELEVATED")) pass++;
  console.log(
    [name.padEnd(18), String(taxFiles.size).padStart(8), cl.mean.toFixed(3).padStart(10),
     base.toFixed(3).padStart(8), (ratio.toFixed(1) + "x").padStart(5), "  " + verdict].join("  "),
  );
}
console.log(`\n${pass}/${total} repos show tax files with elevated recurring (non-dedup) co-change.`);
console.log(pass === total
  ? "GENERALIZES ✓ — the developer's own dedup targets keep co-changing outside the dedup commits."
  : "MIXED — signal does not hold uniformly; needs threshold/repo investigation.\n");
