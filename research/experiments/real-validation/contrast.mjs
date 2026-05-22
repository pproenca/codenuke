// Construct-validity check: does the metric's VALUE axis (the quantities `gain`
// rewards reducing — duplication, complexity) read higher on a known-bad
// codebase than a known-good one? (Biomarker logic: elevated in the disease cohort.)
//
// good = opencode packages/core/src   bad = codenuke/src
// Usage: node experiments/real-validation/contrast.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { measure } from "../metric-separation/lib.mjs";

const CODENUKE_REPO = process.env.CODENUKE_REPO ?? process.cwd();
const OPENCODE_REPO = process.env.OPENCODE_REPO ?? "/tmp/opencode-good";
const TARGETS = [
  { label: "GOOD opencode/core/src", dir: join(OPENCODE_REPO, "packages/core/src") },
  { label: "BAD  codenuke/src", dir: join(CODENUKE_REPO, "src") },
];

const isSource = (n) => /\.(ts|tsx)$/.test(n) && !/\.d\.ts$/.test(n) && !/\.(test|spec)\./.test(n);

function collect(dir) {
  const files = {};
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      if (e === "node_modules" || e === "dist" || e === ".git") continue;
      const p = join(d, e);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (isSource(e)) files[relative(dir, p)] = readFileSync(p, "utf8");
    }
  };
  walk(dir);
  return files;
}

function locOf(files) {
  let loc = 0;
  for (const t of Object.values(files)) loc += t.split("\n").length;
  return loc;
}

// per-file duplication, to surface the top refactor targets in each repo
function perFileDup(files) {
  const rows = [];
  for (const [name, text] of Object.entries(files)) {
    const m = measure({ [name]: text }); // intra-file clones only
    rows.push({ name, dupRate: m.dupRate, complexityPerNode: m.complexity / Math.max(1, m.L), L: m.L });
  }
  return rows;
}

const pct = (x) => (x * 100).toFixed(2) + "%";
const num = (x, d = 2) => x.toFixed(d);

console.log("\n=== construct-validity contrast (real TS) ===\n");
const summary = [];
for (const t of TARGETS) {
  const files = collect(t.dir);
  const fileCount = Object.keys(files).length;
  const loc = locOf(files);
  const m = measure(files); // whole-repo: captures cross-file duplication too
  const dupPerKloc = (m.dupMass / loc) * 1000;
  const complexityPerKnode = (m.complexity / m.L) * 1000;
  summary.push({ label: t.label, fileCount, loc, ...m, dupPerKloc, complexityPerKnode, files });
  console.log(`${t.label}`);
  console.log(`  files=${fileCount}  loc=${loc}  astNodes=${m.L}`);
  console.log(`  duplication rate (redundant windows / total) : ${pct(m.dupRate)}`);
  console.log(`  duplication mass per KLOC                    : ${num(dupPerKloc)}`);
  console.log(`  complexity per 1k AST nodes                  : ${num(complexityPerKnode)}`);
  console.log(`  coupling (kappa)                             : ${m.kappa}`);
  console.log("");
}

const good = summary.find((s) => s.label.startsWith("GOOD"));
const bad = summary.find((s) => s.label.startsWith("BAD"));

console.log("=== prediction: bad > good on the value axis ===\n");
const ratio = (b, g) => (g === 0 ? "inf" : (b / g).toFixed(2) + "x");
const line = (name, b, g) => {
  const pass = b > g;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}: bad=${num(b)} vs good=${num(g)}  (${ratio(b, g)})`);
  return pass;
};
const c1 = line("duplication rate", bad.dupRate, good.dupRate);
const c2 = line("duplication mass / KLOC", bad.dupPerKloc, good.dupPerKloc);
const c3 = line("complexity / 1k nodes", bad.complexityPerKnode, good.complexityPerKnode);

console.log("\n=== top duplication targets the loop would find (bad codebase) ===\n");
const topBad = perFileDup(bad.files)
  .filter((r) => r.L > 50)
  .sort((a, b) => b.dupRate - a.dupRate)
  .slice(0, 8);
for (const r of topBad) console.log(`  ${pct(r.dupRate).padStart(7)}  intra-file dup   ${r.name}`);

const ok = c1 && c2 && c3;
console.log(`\n${ok ? "CONSTRUCT VALIDITY SUPPORTED ✅ (metric elevated on bad code)" : "NOT SUPPORTED ❌ — metric does not track quality"}\n`);
process.exit(ok ? 0 : 1);
