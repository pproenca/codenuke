// loop/fence.mjs — per-region behavior-fence fidelity (the periodic safety calibration).
// Measures, per source region, the mutation score (fraction of injected behavior changes
// the test suite catches) with a Wilson 95% CI. The scorer's G1′ gate admits a region
// only when its CI lower bound ≥ threshold. AST-aware (mutates real operators, not string
// literals). Writes the pinned artifact the scorer reads.
//
//   node loop/fence.mjs [cap=60] [seed=1337] [regions=all]   — audit
//   node loop/fence.mjs replay <region> [worktree]           — monotonic re-audit of survivors
//
// Mutation testing is expensive ⇒ run periodically, not per-score (it stays out of the
// inner loop). A run is deterministic (seeded sampling) so it is reproducible.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, symlinkSync, rmSync, mkdirSync } from "node:fs";
import ts from "typescript";
import { wilson } from "./stats.mjs";
import { loadConfig, isSourceFile } from "./config.mjs";

const C = loadConfig();
const OUT = C.fenceArtifact;
const THRESHOLD = C.thresholds.fenceLB;
const TIMEOUT_MS = 45000; // a hang (sync infinite loop from a flipped guard) = caught
const WT = `${C.worktree}-fence`;

const sh = (c, cwd, timeout) => {
  const r = execSync(c, {
    cwd,
    maxBuffer: 1 << 30,
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
    killSignal: "SIGKILL",
  });
  return r ? r.toString() : "";
};
function runTests(cwd) {
  try {
    sh(C.testCommand, cwd, TIMEOUT_MS);
    return "green";
  } catch (e) {
    if (e && (e.killed || e.signal === "SIGKILL")) {
      try {
        execSync("pkill -9 -f vitest");
      } catch {}
      return "timeout";
    }
    return "fail";
  }
}

const OP = {
  [ts.SyntaxKind.LessThanToken]: ">",
  [ts.SyntaxKind.GreaterThanToken]: "<",
  [ts.SyntaxKind.LessThanEqualsToken]: ">=",
  [ts.SyntaxKind.GreaterThanEqualsToken]: "<=",
  [ts.SyntaxKind.EqualsEqualsEqualsToken]: "!==",
  [ts.SyntaxKind.ExclamationEqualsEqualsToken]: "===",
  [ts.SyntaxKind.AmpersandAmpersandToken]: "||",
  [ts.SyntaxKind.BarBarToken]: "&&",
};
function collectSites(name, text) {
  const sf = ts.createSourceFile(
    name,
    text,
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(name) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const sites = [];
  const push = (start, end, repl) =>
    sites.push({ start, end, repl, op: `${text.slice(start, end)}→${repl}` });
  (function visit(node) {
    if (ts.isBinaryExpression(node) && OP[node.operatorToken.kind] !== undefined)
      push(
        node.operatorToken.getStart(sf),
        node.operatorToken.getEnd(),
        OP[node.operatorToken.kind],
      );
    else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const nm = node.expression.name.text;
      if (nm === "startsWith" || nm === "endsWith")
        push(
          node.expression.name.getStart(sf),
          node.expression.name.getEnd(),
          nm === "startsWith" ? "endsWith" : "startsWith",
        );
    } else if (
      ts.isReturnStatement(node) &&
      node.expression &&
      (node.expression.kind === ts.SyntaxKind.TrueKeyword ||
        node.expression.kind === ts.SyntaxKind.FalseKeyword)
    ) {
      const t = node.expression.kind === ts.SyntaxKind.TrueKeyword;
      push(node.expression.getStart(sf), node.expression.getEnd(), t ? "false" : "true");
    }
    ts.forEachChild(node, visit);
  })(sf);
  return sites;
}
const applyMutant = (text, s) => text.slice(0, s.start) + s.repl + text.slice(s.end);
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
const regionPath = (region) =>
  C.srcDir === "." || region === C.srcDir ? C.srcDir : `${C.srcDir}/${region}`;
const filesIn = (region) =>
  (sh(`git ls-tree -r --name-only ${C.baseline} -- ${regionPath(region)}`, C.repo) || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(isSourceFile);
const writeArtifact = (obj) => {
  try {
    mkdirSync(OUT.split("/").slice(0, -1).join("/"), { recursive: true });
  } catch {}
  writeFileSync(OUT, JSON.stringify(obj, null, 2));
};

// ---------- replay (monotonic re-audit of a region's survivors) ----------
if (process.argv[2] === "replay") {
  const region = process.argv[3],
    wt = process.argv[4] || C.worktree;
  const art = JSON.parse(readFileSync(OUT, "utf8")),
    r = art.regions[region];
  if (!r) {
    console.error(`no region ${region} in artifact`);
    process.exit(1);
  }
  const specs = r.survivorSpecs || [];
  for (const rel of new Set(specs.map((s) => s.rel))) {
    let baselineSource;
    let currentSource;
    try {
      baselineSource = sh(`git show ${art.baseline}:${rel}`, C.repo);
      currentSource = readFileSync(`${wt}/${rel}`, "utf8");
    } catch {
      console.error(`source changed before replay: ${rel}`);
      process.exit(1);
    }
    if (baselineSource !== currentSource) {
      console.error(`source changed before replay: ${rel}`);
      process.exit(1);
    }
  }
  if (runTests(wt) !== "green") {
    console.error("worktree baseline not green — abort replay");
    process.exit(1);
  }
  const still = [];
  for (const s of specs) {
    const path = `${wt}/${s.rel}`;
    let orig;
    try {
      orig = readFileSync(path, "utf8");
    } catch {
      still.push(s);
      continue;
    }
    writeFileSync(path, applyMutant(orig, s));
    const caught = runTests(wt) !== "green";
    writeFileSync(path, orig);
    if (!caught) still.push(s);
  }
  r.survivorSpecs = still;
  r.caught = r.total - still.length;
  const w = wilson(r.caught, r.total);
  Object.assign(r, { p: w.p, lo: w.lo, hi: w.hi, admissible: w.lo >= THRESHOLD });
  writeArtifact(art);
  console.log(
    `${region}: ${r.caught}/${r.total} = ${(w.p * 100).toFixed(0)}%  CI95 [${(w.lo * 100).toFixed(1)}, ${(w.hi * 100).toFixed(1)}]  ${r.admissible ? "ADMISSIBLE ✓" : "BLOCKED ✗"}`,
  );
  process.exit(0);
}

// ---------- audit ----------
const CAP = Number(process.argv[2]) || 60;
const SEED = Number(process.argv[3]) || 1337;
const REGION_FILTER = process.argv[4] ? process.argv[4].split(",") : null;
const regions = REGION_FILTER ?? C.regions;
if (regions.length === 0) {
  console.log(`no source regions detected under ${C.srcDir}/`);
  process.exit(1);
}

try {
  sh(`git worktree remove --force ${WT}`, C.repo);
} catch {}
sh(`git worktree add -f ${WT} ${C.baseline}`, C.repo);
try {
  symlinkSync(`${C.repo}/node_modules`, `${WT}/node_modules`);
} catch {}
console.log(
  `fence audit (AST-aware) @ ${C.baseline}  cap=${CAP}/region  seed=${SEED}  regions=${regions.join(",")}`,
);
if (runTests(WT) !== "green") {
  writeArtifact({ error: "baseline red" });
  console.log("baseline RED — abort");
  process.exit(1);
}

const rng = mulberry32(SEED);
const origCache = new Map(),
  plan = {};
for (const region of regions) {
  const cands = [];
  for (const rel of filesIn(region)) {
    let text;
    try {
      text = readFileSync(`${WT}/${rel}`, "utf8");
    } catch {
      continue;
    }
    origCache.set(rel, text);
    for (const s of collectSites(rel, text)) cands.push({ rel, ...s });
  }
  shuffle(cands, rng);
  plan[region] = cands.slice(0, CAP);
  console.log(`  ${region}: ${cands.length} sites -> sampling ${plan[region].length}`);
}

let out = {
  baseline: C.baseline,
  generatedAt: new Date().toISOString(),
  method: "ast-aware",
  threshold: THRESHOLD,
  capPerRegion: CAP,
  seed: SEED,
  regions: {},
};
if (REGION_FILTER) {
  try {
    out = { ...JSON.parse(readFileSync(OUT, "utf8")), generatedAt: out.generatedAt };
  } catch {}
}
let done = 0,
  total = Object.values(plan).reduce((s, a) => s + a.length, 0),
  t0 = Date.now();
for (const region of regions) {
  const survivorSpecs = [];
  let caught = 0,
    n = 0;
  for (const s of plan[region]) {
    const orig = origCache.get(s.rel),
      path = `${WT}/${s.rel}`;
    writeFileSync(path, applyMutant(orig, s));
    const res = runTests(WT);
    writeFileSync(path, orig);
    n++;
    if (res !== "green") caught++;
    else survivorSpecs.push({ rel: s.rel, start: s.start, end: s.end, repl: s.repl, op: s.op });
    done++;
    if (done % 10 === 0) console.log(`  [${done}/${total} ${((Date.now() - t0) / 1000) | 0}s]`);
  }
  const w = wilson(caught, n);
  out.regions[region] = {
    caught,
    total: n,
    p: w.p,
    lo: w.lo,
    hi: w.hi,
    admissible: w.lo >= THRESHOLD,
    survivorSpecs,
  };
  console.log(
    `== ${region}: ${caught}/${n} = ${(w.p * 100).toFixed(0)}%  CI95 [${(w.lo * 100).toFixed(1)}, ${(w.hi * 100).toFixed(1)}]  ${w.lo >= THRESHOLD ? "ADMISSIBLE ✓" : "BLOCKED ✗"}`,
  );
  writeArtifact(out);
}
try {
  rmSync(`${WT}/node_modules`, { force: true });
} catch {}
try {
  sh(`git worktree remove --force ${WT}`, C.repo);
  sh(`git worktree prune`, C.repo);
} catch {}
console.log(`\n-> ${OUT}`);
for (const [r, v] of Object.entries(out.regions))
  console.log(
    `  ${r.padEnd(12)} ${v.caught}/${v.total}  lo=${(v.lo * 100).toFixed(1)}%  ${v.admissible ? "ADMISSIBLE" : "BLOCKED"}`,
  );
