// Change-amplification via git co-change history.
// Hypothesis: harmful duplication = sites that historically CHANGE TOGETHER.
// Killer test: opencode's 34 PluginV2 sites (clone-mass's #1 target) should show
// near-baseline co-change (independent features), while real taxes co-change strongly.
//
// Usage: node experiments/cochange/cochange.mjs

import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const CODENUKE_REPO = process.env.CODENUKE_REPO ?? process.cwd();
const OPENCODE_REPO = process.env.OPENCODE_REPO ?? "/tmp/opencode-good";
const isSource = (p) => /\.(ts|tsx)$/.test(p) && !/\.d\.ts$/.test(p) && !/\.(test|spec)\./.test(p);
const MAX_FILES_PER_COMMIT = 40; // skip bulk/format commits — co-change noise

function commitsOf(repo, srcPrefix, maxCommits = 100000) {
  const raw = execSync(
    `git -C ${repo} log --no-merges --name-only --pretty=format:%x01%H -n ${maxCommits}`,
    { maxBuffer: 1 << 30 },
  ).toString();
  const commits = [];
  for (const block of raw.split("\x01").slice(1)) {
    const lines = block.split("\n");
    const paths = [
      ...new Set(
        lines
          .slice(1)
          .map((s) => s.trim())
          .filter((p) => p.startsWith(srcPrefix))
          .map((p) => p.slice(srcPrefix.length))
          .filter(isSource),
      ),
    ];
    if (paths.length >= 2 && paths.length <= MAX_FILES_PER_COMMIT) commits.push(paths);
  }
  return commits;
}

function stats(commits) {
  const changes = new Map();
  const co = new Map();
  const pk = (a, b) => (a < b ? a + "" + b : b + "" + a);
  for (const files of commits) {
    for (const f of files) changes.set(f, (changes.get(f) ?? 0) + 1);
    for (let i = 0; i < files.length; i += 1)
      for (let j = i + 1; j < files.length; j += 1) {
        const k = pk(files[i], files[j]);
        co.set(k, (co.get(k) ?? 0) + 1);
      }
  }
  return { changes, co, pk };
}

function jaccard(a, b, S) {
  const ca = S.changes.get(a) ?? 0;
  const cb = S.changes.get(b) ?? 0;
  const cab = S.co.get(S.pk(a, b)) ?? 0;
  const union = ca + cb - cab;
  return union > 0 ? cab / union : 0;
}

function clusterMetrics(files, S) {
  const present = files.filter((f) => (S.changes.get(f) ?? 0) > 0);
  let sumCo = 0, sumJac = 0, linked = 0, pairs = 0;
  for (let i = 0; i < present.length; i += 1)
    for (let j = i + 1; j < present.length; j += 1) {
      const cab = S.co.get(S.pk(present[i], present[j])) ?? 0;
      sumCo += cab;
      sumJac += jaccard(present[i], present[j], S);
      if (cab >= 1) linked += 1;
      pairs += 1;
    }
  return {
    filesWithHistory: present.length,
    meanCo: pairs ? sumCo / pairs : 0,
    meanJaccard: pairs ? sumJac / pairs : 0,
    linkedFraction: pairs ? linked / pairs : 0,
  };
}

function baseline(S, samples = 4000) {
  const files = [...S.changes.keys()];
  let sumCo = 0, sumJac = 0, linked = 0;
  for (let n = 0; n < samples; n += 1) {
    const a = files[(Math.random() * files.length) | 0];
    const b = files[(Math.random() * files.length) | 0];
    if (a === b) { n -= 1; continue; }
    sumCo += S.co.get(S.pk(a, b)) ?? 0;
    sumJac += jaccard(a, b, S);
    if ((S.co.get(S.pk(a, b)) ?? 0) >= 1) linked += 1;
  }
  return { meanCo: sumCo / samples, meanJaccard: sumJac / samples, linkedFraction: linked / samples };
}

function topPairs(S, n = 8) {
  return [...S.co.entries()]
    .map(([k, c]) => { const [a, b] = k.split(""); return { a, b, c, j: jaccard(a, b, S) }; })
    .sort((x, y) => y.j - x.j || y.c - x.c)
    .filter((p) => p.c >= 2)
    .slice(0, n);
}

function pluginCluster(srcDir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      if (e === "node_modules" || e === ".git") continue;
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (isSource(p) && readFileSync(p, "utf8").includes("PluginV2.define"))
        out.push(relative(srcDir, p));
    }
  };
  walk(srcDir);
  return out;
}

const fmt = (x, d = 3) => x.toFixed(d);
function report(label, m, base) {
  const r = (x, b) => (b > 0 ? (x / b).toFixed(1) + "x baseline" : "n/a");
  console.log(`  ${label}`);
  console.log(`    files w/ history : ${m.filesWithHistory}`);
  console.log(`    mean co-change   : ${fmt(m.meanCo)}   (${r(m.meanCo, base.meanCo)})`);
  console.log(`    mean Jaccard     : ${fmt(m.meanJaccard)}   (${r(m.meanJaccard, base.meanJaccard)})`);
  console.log(`    linked fraction  : ${fmt(m.linkedFraction)}   (${r(m.linkedFraction, base.linkedFraction)})`);
}

// ---- opencode: PluginV2 cluster (clone-mass #1 target) ----
console.log("\n=== opencode/core/src ===\n");
const ocDir = join(OPENCODE_REPO, "packages/core/src");
const ocS = stats(commitsOf(OPENCODE_REPO, "packages/core/src/", 1500));
const ocBase = baseline(ocS);
console.log(`  commits with 2..${MAX_FILES_PER_COMMIT} source files: counted`);
console.log(`  BASELINE (random pairs): meanCo=${fmt(ocBase.meanCo)} meanJaccard=${fmt(ocBase.meanJaccard)} linked=${fmt(ocBase.linkedFraction)}\n`);
const cluster = pluginCluster(ocDir);
report(`PluginV2 cluster (${cluster.length} files) — clone-mass said BIG refactor`, clusterMetrics(cluster, ocS), ocBase);
console.log("\n  top co-changing pairs in opencode (the REAL coupling):");
for (const p of topPairs(ocS)) console.log(`    J=${fmt(p.j)} co=${p.c}  ${p.a}  +  ${p.b}`);

// ---- codenuke: do its clone-top files co-change? what are the real taxes? ----
console.log("\n\n=== codenuke/src ===\n");
const cnRepo = CODENUKE_REPO;
const cnS = stats(commitsOf(cnRepo, "src/"));
const cnBase = baseline(cnS);
console.log(`  BASELINE (random pairs): meanCo=${fmt(cnBase.meanCo)} meanJaccard=${fmt(cnBase.meanJaccard)} linked=${fmt(cnBase.linkedFraction)}\n`);
const cloneTop = [
  "mappers/react.ts", "platform/types.ts", "mappers/go.ts", "mappers/node.ts",
  "mappers/ruby.ts", "mappers/gradle.ts", "provider/index.ts", "mappers/apple.ts",
];
report("clone-mass top-8 files — would clone-mass refactor them?", clusterMetrics(cloneTop, cnS), cnBase);
console.log("\n  top co-changing pairs in codenuke (the REAL taxes):");
for (const p of topPairs(cnS)) console.log(`    J=${fmt(p.j)} co=${p.c}  ${p.a}  +  ${p.b}`);
console.log("");
