// Separation check (METRIC.md §5): does the metric rank the controls correctly?
//   positive(s)  : admissible, gain >> 0
//   N1 reformat  : gain ~ 0 (dL == 0)            -> P1 formatting invariance
//   N2 break     : REJECTED by G1 (behavior)     -> P3 safety dominance
//   N3 churn     : gain <= 0, not rewarded        -> P5 granularity defense

import { controls } from "./controls.mjs";
import { scoreControl } from "./lib.mjs";

const rows = [];
for (const c of controls) rows.push(await scoreControl(c));

const f = (n) => (Number.isFinite(n) ? n.toFixed(1).padStart(7) : "    +Inf");
const b = (x) => (x ? "Y" : "·");

console.log("\n=== metric separation check ===\n");
console.log(
  ["kind".padEnd(5), "dL".padStart(6), "dX".padStart(4), "dDup".padStart(6), "G1", "G3", "G4", "adm", "gain".padStart(8), "loss".padStart(8), "control"].join("  "),
);
for (const r of rows) {
  console.log(
    [
      r.kind.padEnd(5),
      String(r.dL).padStart(6),
      String(r.dX).padStart(4),
      String(r.dDup).padStart(6),
      ` ${b(r.G1)}`,
      ` ${b(r.G3)}`,
      ` ${b(r.G4)}`,
      `  ${b(r.admissible)}`,
      f(r.gain),
      f(r.loss),
      ` ${r.name}`,
    ].join("  "),
  );
  if (r.behaviorNote) console.log(`        behavior: ${r.behaviorNote}`);
}

// ---- assertions ----
const get = (kind) => rows.filter((r) => r.kind === kind);
const positives = get("positive");
const n1 = get("N1")[0];
const n2 = get("N2")[0];
const n3 = get("N3")[0];

const checks = [];
const check = (desc, pass) => checks.push({ desc, pass });

for (const p of positives) {
  check(`${p.name}: admissible`, p.admissible === true);
  check(`${p.name}: finite loss`, Number.isFinite(p.loss));
  check(`${p.name}: gain > 0`, p.gain > 0);
}

// N2 is DANGEROUS: rejected by the behavior gate, even though it reduces MORE code.
check("N2 rejected by behavior gate (G1 false)", n2.G1 === false);
check("N2 looks like a reduction (dL > 0) yet inadmissible", n2.dL > 0 && n2.admissible === false);

// N1 is USELESS not dangerous: behavior preserved, but no reduction (rejected by G4).
check("N1 behavior preserved (G1 true)", n1.G1 === true);
check("N1 formatting invariant (dL == 0)", n1.dL === 0);
check("N1 rejected for no reduction (G4 false)", n1.G4 === false);

// N3 churn: behavior preserved, adds nodes, rejected by G4 — never rewarded.
check("N3 behavior preserved (G1 true)", n3.G1 === true);
check("N3 adds nodes (dL < 0)", n3.dL < 0);
check("N3 rejected for no reduction (G4 false)", n3.G4 === false);

// The real selection metric is LOSS (lexicographic: gain only compares within the
// admissible set). Positives must strictly outrank every negative by loss.
const worstPositiveLoss = Math.max(...positives.map((p) => p.loss));
const bestNegativeLoss = Math.min(n1.loss, n2.loss, n3.loss);
check("positives strictly outrank all negatives by LOSS", worstPositiveLoss < bestNegativeLoss);

console.log("\n=== assertions ===\n");
let allPass = true;
for (const c of checks) {
  console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.desc}`);
  if (!c.pass) allPass = false;
}
console.log(`\n${allPass ? "SEPARATION ACHIEVED ✅" : "SEPARATION FAILED ❌ — fix the metric"}\n`);
process.exit(allPass ? 0 : 1);
