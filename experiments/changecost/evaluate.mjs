// evaluate_changecost(C) — the refactoring analog of `uv run train.py` + evaluate_bpb.
//
//   node experiments/changecost/evaluate.mjs [ref=HEAD]
//
// Measures 𝒱̂(C) = mean over the held-out change-benchmark Δ of the realized cost of
// implementing each change δ_j on C: cost = edit (token-diff of non-test src) + β·verify
// (1 − fence fidelity of the regions touched). Lower 𝒱̂ = the codebase absorbs its own
// future more cheaply (THEORY.md). To compare a refactor, run on C and on C', same Δ.
//
// The IMPLEMENTER (who realizes each δ_j) is part of this immutable scorer — it may see
// Δ. The refactoring PROPOSER (autoloop) must NOT see Δ; that separation is what keeps
// the metric self-policing (THEORY.md T5). Implementer is pluggable via CN_IMPLEMENTER
// (a shell cmd run in the worktree); default = a blind `claude -p`.
//
// Env: CN_BASE/ref arg (use 2d81f6c — HEAD is red), CN_BUDGET (USD/impl, default 1.50),
//      CN_BETA (token-equiv weight on verify, default 60), CN_IMPLEMENTER (override).

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync, symlinkSync, rmSync, mkdirSync } from "node:fs";
import { editCost, verifyCost, regionOf } from "./lib.mjs";

const MAIN = process.env.CODENUKE_REPO ?? "/Users/pedroproenca/Documents/Projects/codenuke";
const WT = "/tmp/cn-changecost";
const BENCH = process.env.CN_BENCH ?? `${MAIN}/experiments/changecost/benchmark`;
const ART = process.env.CN_FIDELITY ?? `${MAIN}/experiments/mutation/fence-fidelity.json`;
const OUT = `${MAIN}/experiments/changecost/changecost.json`;
const REF = process.argv[2] || process.env.CN_BASE || "HEAD";
const BUDGET = process.env.CN_BUDGET ?? "1.50";
const BETA = Number(process.env.CN_BETA ?? 60); // verify is a fraction in [0,1]; scale to token-equiv effort
const IMPLEMENTER = process.env.CN_IMPLEMENTER;
const IMPL_TIMEOUT = 300000;

const sh = (c, opts = {}) => { const r = execSync(c, { maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"], env: process.env, ...opts }); return r ? r.toString() : ""; };
const shTry = (c, opts = {}) => { try { return { ok: true, out: sh(c, opts) }; } catch (e) { return { ok: false, out: (e.stdout?.toString() || "") + (e.stderr?.toString() || ""), killed: !!e.killed }; } };
const isSrc = (p) => /\.(ts|tsx)$/.test(p) && !/\.d\.ts$/.test(p) && !/\.(test|spec|accept)\./.test(p);
const greenWT = () => shTry(`node_modules/.bin/vitest run --reporter=dot`, { cwd: WT }).ok;
const cleanWT = () => { shTry(`git -C ${WT} reset --hard HEAD`); shTry(`git -C ${WT} clean -fdq src`); };

function srcSnapshot() {
  const files = sh(`git -C ${WT} ls-files src`).split("\n").map((s) => s.trim()).filter(isSrc);
  const map = {};
  for (const f of files) { try { map[f] = readFileSync(`${WT}/${f}`, "utf8"); } catch {} }
  return map;
}

function loadBenchmark() {
  if (!existsSync(BENCH)) return [];
  return readdirSync(BENCH, { withFileTypes: true }).filter((d) => d.isDirectory())
    .map((d) => ({ dir: `${BENCH}/${d.name}`, ...JSON.parse(readFileSync(`${BENCH}/${d.name}/meta.json`, "utf8")) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function runImplementer(delta) {
  const acceptSrc = readFileSync(`${delta.dir}/accept.test.ts`, "utf8");
  const prompt =
    `You are implementing a change-request in this repository (cwd is the repo root).\n\n` +
    `## Change request\n${delta.prompt}\n\n` +
    `## Acceptance test (already added at ${delta.acceptPath} — DO NOT edit it)\nThis test defines "done". Make it pass while keeping the existing suite green:\n\n${acceptSrc}\n\n` +
    `Edit ONLY non-test source under src/. Implement the feature for real (no test-specific hacks). When done, stop.`;
  if (IMPLEMENTER) return shTry(IMPLEMENTER, { cwd: WT, timeout: IMPL_TIMEOUT, env: { ...process.env, CN_DELTA: delta.id } });
  writeFileSync("/tmp/cn-impl-prompt.txt", prompt);
  const cmd = `claude -p --permission-mode bypassPermissions --no-session-persistence --allowedTools ${JSON.stringify("Edit Write Read Grep Glob")} --max-budget-usd ${BUDGET} --output-format json < /tmp/cn-impl-prompt.txt`;
  return shTry(cmd, { cwd: WT, timeout: IMPL_TIMEOUT });
}

// ---- setup worktree @ ref ----
try { sh(`git -C ${MAIN} worktree remove --force ${WT}`); } catch {}
sh(`git -C ${MAIN} worktree add -f ${WT} ${REF}`);
try { symlinkSync(`${MAIN}/node_modules`, `${WT}/node_modules`); } catch {}
const head = sh(`git -C ${WT} rev-parse --short HEAD`).trim();
console.log(`evaluate_changecost @ ${REF} (${head})  β=${BETA}  implementer=${IMPLEMENTER ? "scripted" : "claude -p"}`);
if (!greenWT()) { writeFileSync(OUT, JSON.stringify({ error: "baseline red", ref: REF })); console.log("baseline RED — abort"); process.exit(1); }

const Δ = loadBenchmark();
if (Δ.length === 0) { console.log(`no benchmark in ${BENCH}`); process.exit(1); }
const artifact = (() => { try { return JSON.parse(readFileSync(ART, "utf8")); } catch { return null; } })();
const baseline = srcSnapshot();

const results = [];
for (const delta of Δ) {
  console.log(`\n--- δ ${delta.id}: ${delta.title} ---`);
  // drop the acceptance test into the worktree
  const acceptAbs = `${WT}/${delta.acceptPath}`;
  mkdirSync(acceptAbs.split("/").slice(0, -1).join("/"), { recursive: true });
  writeFileSync(acceptAbs, readFileSync(`${delta.dir}/accept.test.ts`, "utf8"));

  const impl = runImplementer(delta);
  if (!impl.ok) { console.log(`  implementer error/timeout`); results.push({ id: delta.id, status: "impl-fail" }); cleanWT(); continue; }
  if (!greenWT()) { console.log(`  acceptance/suite RED after implement — not done`); results.push({ id: delta.id, status: "not-done" }); cleanWT(); continue; }

  const after = srcSnapshot();
  const e = editCost(baseline, after);
  const touchedRegions = [...new Set(Object.keys(e.perFile).map(regionOf))];
  const verifyFrac = artifact ? verifyCost(touchedRegions, artifact, 1.0) : 1.0;
  const cost = e.tokens + BETA * verifyFrac;
  console.log(`  edit=${e.tokens} tokens (${e.filesTouched} files: ${touchedRegions.join(",") || "-"})  verify=${verifyFrac.toFixed(2)}  cost=${cost.toFixed(1)}`);
  results.push({ id: delta.id, status: "done", editTokens: e.tokens, filesTouched: e.filesTouched, regions: touchedRegions, verifyFrac, cost, perFile: e.perFile });
  cleanWT();
}

const done = results.filter((r) => r.status === "done");
const Vhat = done.length ? done.reduce((s, r) => s + r.cost, 0) / done.length : null;
const out = { ref: REF, head, beta: BETA, generatedAt: new Date().toISOString(), Vhat, done: done.length, total: Δ.length, results };
writeFileSync(OUT, JSON.stringify(out, null, 2));
try { rmSync(`${WT}/node_modules`, { force: true }); } catch {}
try { sh(`git -C ${MAIN} worktree remove --force ${WT}`); sh(`git -C ${MAIN} worktree prune`); } catch {}
console.log(`\n=== 𝒱̂(${head}) = ${Vhat == null ? "n/a" : Vhat.toFixed(1)}  over ${done.length}/${Δ.length} changes ===`);
console.log(`-> ${OUT}`);
