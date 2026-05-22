// Significance of the good-vs-bad contrast signals (replaces point estimates with
// Mann-Whitney p, rank-biserial effect size, and bootstrap CI on the ratio of medians).
// Per-file distributions: opencode core/src (good) vs codenuke src (bad).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { measure } from "../metric-separation/lib.mjs";
import { mannWhitney, bootstrapRatioMedian, wilson } from "./lib.mjs";

const CODENUKE_REPO = process.env.CODENUKE_REPO ?? process.cwd();
const OPENCODE_REPO = process.env.OPENCODE_REPO ?? "/tmp/opencode-good";
const isSrc = (n) => /\.(ts|tsx)$/.test(n) && !/\.d\.ts$/.test(n) && !/\.(test|spec)\./.test(n);
function perFile(dir) {
  const out = [];
  const walk = (d) => { for (const e of readdirSync(d)) { if (e === "node_modules" || e === "dist" || e === ".git") continue; const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (isSrc(e)) { const m = measure({ [relative(dir, p)]: readFileSync(p, "utf8") }); if (m.L > 30) out.push({ cxDensity: (m.complexity / m.L) * 1000, dupRate: m.dupRate }); } } };
  walk(dir);
  return out;
}

const good = perFile(join(OPENCODE_REPO, "packages/core/src"));
const bad = perFile(join(CODENUKE_REPO, "src"));
console.log(`\nper-file samples: good(opencode)=${good.length}  bad(codenuke)=${bad.length}\n`);

for (const [name, key] of [["complexity / 1k nodes", "cxDensity"], ["duplication rate", "dupRate"]]) {
  const b = bad.map((x) => x[key]), g = good.map((x) => x[key]);
  const mw = mannWhitney(b, g); // auc = P(bad > good)
  const ratio = bootstrapRatioMedian(b, g);
  console.log(`${name}:`);
  console.log(`  median bad=${(ratio.ratio * (g.reduce((s, x) => s + x, 0) / g.length || 1)).toFixed(2)}  ratio bad/good = ${ratio.ratio.toFixed(2)}  95% CI [${ratio.lo.toFixed(2)}, ${ratio.hi.toFixed(2)}]`);
  console.log(`  Mann-Whitney p=${mw.p.toExponential(2)}  effect size (rank-biserial)=${mw.rankBiserial.toFixed(3)}  AUC P(bad>good)=${mw.auc.toFixed(3)}`);
  console.log(`  -> ${mw.p < 0.05 && ratio.lo > 1 ? "SIGNIFICANT: bad > good" : mw.p < 0.05 && ratio.hi < 1 ? "SIGNIFICANT: good > bad" : "NOT significant"}\n`);
}

// mutation fence power CI (from the larger audit if available, else the n=15 run)
let mut;
try { mut = JSON.parse(readFileSync("/tmp/mut-result.json", "utf8")); } catch { mut = null; }
if (mut && mut.total) {
  const w = wilson(mut.caught, mut.total);
  console.log(`fence power (mutation score): ${mut.caught}/${mut.total} = ${(w.p * 100).toFixed(0)}%  Wilson 95% CI [${(w.lo * 100).toFixed(0)}%, ${(w.hi * 100).toFixed(0)}%]`);
} else {
  const w = wilson(12, 15);
  console.log(`fence power (mutation score, n=15 run): 12/15 = 80%  Wilson 95% CI [${(w.lo * 100).toFixed(0)}%, ${(w.hi * 100).toFixed(0)}%]  (larger audit pending)`);
}
console.log("");
