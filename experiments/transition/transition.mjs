// Transition-level validation: do REAL refactor commits (ground-truth positives
// from codenuke's own history) produce positive gain on the value axis?
// Reads historical file versions via `git show` — working tree untouched.
//
// Usage: node experiments/transition/transition.mjs

import { execSync } from "node:child_process";
import { measure } from "../metric-separation/lib.mjs";

const REPO = process.env.CODENUKE_REPO ?? process.cwd();

// Ground-truth positive refactors (dedup / consolidate / share-helper).
const POSITIVES = [
  ["33c798b", "Extract shared TOML and glob helpers for mappers"],
  ["d39e149", "Extract shared TOML scanning and ludicrous briefs"],
  ["434a212", "fix(mapper): reuse shared Node chunking"],
  ["e22bd61", "fix(mapper): hoist associated test directory lists"],
  ["fbdf07b", "Consolidate provider NDJSON parsing"],
  ["4cb3528", "Extract shared CLI bootstrap helper"],
  ["b1546cc", "Reuse repo index and cache mapper lookups"],
  ["4b39a15", "fix(mapper): share workspace pattern helpers"],
];

function sh(cmd) {
  try {
    return execSync(cmd, { cwd: REPO, maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "ignore"] }).toString();
  } catch {
    return null;
  }
}

function changedSource(commit) {
  const out = sh(`git diff --name-only ${commit}^ ${commit} -- src`) || "";
  return out.split("\n").map((s) => s.trim())
    .filter((p) => /\.(ts|tsx)$/.test(p) && !/\.d\.ts$/.test(p) && !/\.(test|spec)\./.test(p));
}

function treeFiles(commit, paths) {
  const files = {};
  for (const p of paths) {
    const content = sh(`git show ${commit}:${p}`);
    if (content !== null) files[p] = content;
  }
  return files;
}

console.log("\n=== transition validation: real refactor commits ===\n");
console.log(
  ["dL", "dDup", "dCx", "files", "region", "verdict", "commit"].map((s, i) =>
    s.padStart([6, 6, 5, 6, 8, 9, 0][i]),
  ).join("  "),
);

let positiveGain = 0;
for (const [c, subj] of POSITIVES) {
  const paths = changedSource(c);
  if (paths.length === 0) { console.log(`  (no source files) ${c} ${subj}`); continue; }
  const before = measure(treeFiles(`${c}^`, paths));
  const after = measure(treeFiles(c, paths));
  const dL = before.L - after.L;
  const dDup = before.dupMass - after.dupMass;
  const dCx = before.complexity - after.complexity;
  // value gain: reduction terms (co-change region weight applied separately below)
  const gain = dL + dCx + 0.5 * dDup;
  const region = paths.some((p) => p.includes("/mappers/")) ? "mapper" : "other";
  const verdict = dL > 0 ? "REDUCES" : dL === 0 ? "neutral" : "GROWS";
  if (gain > 0) positiveGain += 1;
  console.log(
    [
      String(dL).padStart(6),
      String(dDup).padStart(6),
      String(dCx).padStart(5),
      String(paths.length).padStart(6),
      region.padStart(8),
      verdict.padStart(9),
      ` ${c} ${subj.slice(0, 48)}`,
    ].join("  "),
  );
}

console.log(`\n${positiveGain}/${POSITIVES.length} real refactors scored positive gain (dL+dCx+0.5dDup > 0)`);
console.log(
  "\nInterpretation: these are human-authored, tests-passing refactors. The metric\n" +
    "should reward them (positive gain), and the high-value ones sit in the mapper\n" +
    "region that recurring-co-change flagged as the real tax.\n",
);
