// Larger mutation audit -> tighter CI on fence power. Writes JSON for the stats layer.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs";

const MAIN = process.env.CODENUKE_REPO ?? process.cwd();
const WT = "/tmp/cn-mut2";
const OUT = "/tmp/mut-result.json";
const OPS = [
  [/ < /, " > "], [/ > /, " < "], [/ <= /, " >= "], [/ >= /, " <= "],
  [/ === /, " !== "], [/ !== /, " === "], [/ && /, " || "], [/ \|\| /, " && "],
  [/return true;/, "return false;"], [/return false;/, "return true;"],
  [/\.startsWith\(/, ".endsWith("], [/\.endsWith\(/, ".startsWith("],
];
const TARGETS = [
  "src/workflow/selection.ts", "src/workflow/findings.ts", "src/workflow/reporting.ts",
  "src/workflow/feature-equivalence.ts", "src/workflow/validation.ts", "src/workflow/test-coverage.ts",
  "src/workflow/change-audit.ts", "src/workflow/patch-boundary.ts", "src/platform/toml.ts",
  "src/platform/id.ts", "src/platform/detect.ts", "src/provider/json.ts", "src/provider/schema.ts",
  "src/mapping/heuristic.ts", "src/mappers/path-globs.ts", "src/mappers/shared.ts",
];
const MAX = 45;
const sh = (c, cwd) => execSync(c, { cwd, maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] }).toString();
const pass = (cwd) => { try { sh("node_modules/.bin/vitest run --reporter=dot", cwd); return true; } catch { return false; } };

const GREEN_REF = "2d81f6c"; // last known-green commit (current HEAD baseline is red)
try { sh(`git worktree remove --force ${WT}`, MAIN); } catch {}
sh(`git worktree add -f ${WT} ${GREEN_REF}`, MAIN);
try { symlinkSync(`${MAIN}/node_modules`, `${WT}/node_modules`); } catch {}
if (!pass(WT)) { writeFileSync(OUT, JSON.stringify({ error: "baseline red" })); process.exit(1); }

const res = [];
outer: for (const rel of TARGETS) {
  const path = `${WT}/${rel}`;
  let orig; try { orig = readFileSync(path, "utf8"); } catch { continue; }
  for (const [re, repl] of OPS) {
    if (res.length >= MAX) break outer;
    if (!re.test(orig)) continue;
    const mut = orig.replace(re, repl);
    if (mut === orig) continue;
    writeFileSync(path, mut);
    const caught = !pass(WT);
    writeFileSync(path, orig);
    res.push({ rel: rel.replace("src/", ""), caught });
  }
}
try { rmSync(`${WT}/node_modules`, { force: true }); } catch {}
try { sh(`git worktree remove --force ${WT}`, MAIN); sh("git worktree prune", MAIN); } catch {}
const caught = res.filter((r) => r.caught).length;
writeFileSync(OUT, JSON.stringify({ caught, total: res.length, results: res }, null, 2));
console.log(`mutation audit done: ${caught}/${res.length} caught -> ${OUT}`);
