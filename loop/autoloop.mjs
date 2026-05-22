// loop/autoloop.mjs — the autonomous loop. Propose → score → keep/revert → log, no human.
//
//   node loop/autoloop.mjs [iterations=5]
//
// Two moves, chosen from the region's measured fence:
//   reduce — region admissible (fence CI lower bound ≥ threshold): propose a behavior-
//            preserving reduction; keep iff loss < 0.
//   raise  — region fence-blocked: propose CHARACTERIZATION TESTS that kill the surviving
//            mutants, re-measure via monotonic replay, keep the tests iff the fence rose.
//            The loop earns the right to refactor.
//
// Proposer = headless `claude -p` editing ONLY the worktree (no Bash/git ⇒ cannot touch
// the scorer = immutability). Override with CN_PROPOSER (a shell cmd run in the worktree).

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { loadConfig } from "./config.mjs";

const C = loadConfig();
const WT = C.worktree;
const SCORER = new URL("./scorer.mjs", import.meta.url).pathname;
const FENCE = new URL("./fence.mjs", import.meta.url).pathname;
const N = Number(process.argv[2]) || 5;
const PROPOSER = process.env.CN_PROPOSER;
const TIMEOUT = 300000;

const sh = (cmd, opts = {}) => {
  const r = execSync(cmd, {
    maxBuffer: 1 << 30,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    ...opts,
  });
  return r ? r.toString() : "";
};
const shTry = (cmd, opts = {}) => {
  try {
    return { ok: true, out: sh(cmd, opts) };
  } catch (e) {
    return {
      ok: false,
      out: (e.stdout?.toString() || "") + (e.stderr?.toString() || ""),
      killed: !!e.killed,
    };
  }
};
const cleanWT = () => {
  shTry(`git -C ${WT} reset --hard HEAD`);
  shTry(`git -C ${WT} clean -fdq ${C.srcDir}`);
};
const perr = (p) => (p.out || "").replace(/\s+/g, " ").slice(-200);
const loadFence = () => {
  try {
    return JSON.parse(readFileSync(C.fenceArtifact, "utf8"));
  } catch {
    return null;
  }
};
const wtDirty = () => shTry(`git -C ${WT} status --porcelain ${C.srcDir}`).out.trim().length > 0;
function logRow(...cols) {
  appendFileSync(C.results, cols.join("\t") + "\n");
  console.log(`  → ${cols[6]?.toUpperCase?.() ?? cols[6]}  ${cols[7] ?? ""}`);
}

function proposer(prompt) {
  if (PROPOSER) return shTry(PROPOSER, { cwd: WT, timeout: TIMEOUT, env: process.env });
  writeFileSync(C.promptFile, prompt);
  const cmd = `claude -p --permission-mode bypassPermissions --no-session-persistence --allowedTools ${JSON.stringify("Edit Write Read Grep Glob")} --max-budget-usd ${C.proposerBudgetUsd} --output-format json < ${C.promptFile}`;
  return shTry(cmd, { cwd: WT, timeout: TIMEOUT });
}
const reducePrompt = () =>
  `${readFileSync(C.program, "utf8")}\n\n---\nYou are running now. Target region: ${C.target}. Make exactly ONE behavior-preserving reduction in a single file under ${C.target}, then stop. Do not run commands; just edit.`;
function raisePrompt(specs) {
  const shown = specs
    .slice(0, 12)
    .map((s) => {
      let ln = "?";
      try {
        ln = String(readFileSync(`${WT}/${s.rel}`, "utf8").slice(0, s.start).split("\n").length);
      } catch {}
      return `  - ${s.rel} line ${ln}: operator \`${s.op}\` is undetected by any test`;
    })
    .join("\n");
  return `You are the fence-raising proposer. The region ${C.target} is fence-BLOCKED: its tests miss some behavior changes (mutation survivors). ADD characterization tests (colocated test files under ${C.target}) that pin the CURRENT behavior so these mutations would be caught. Do NOT change any source — only add/extend tests.\n\nSurviving mutations:\n${shown}\n\nRead the source, understand what each operator decides, and assert the real current outputs for inputs exercising both sides. Make the tests pass against current code. Then stop. Do not run commands; just write tests.`;
}

// ---- ensure worktree + branch + results ----
try {
  mkdirSync(C.results.split("/").slice(0, -1).join("/"), { recursive: true });
} catch {}
if (!existsSync(C.state)) {
  console.log(`initializing worktree @ ${C.baseline}…`);
  sh(`node ${SCORER} init`, { cwd: C.repo, stdio: ["ignore", "inherit", "inherit"] });
  shTry(`git -C ${WT} checkout -B ${C.branch}`);
  console.log(`trajectory branch: ${C.branch}`);
}
if (!existsSync(C.results))
  writeFileSync(
    C.results,
    "iter\tcommit\tdAST\tdCx\tbehavior\tmfence\tloss\tstatus\tdescription\n",
  );

console.log(
  `\n=== autoloop: ${N} iters, proposer=${PROPOSER ? "scripted" : "claude -p"}, region=${C.region}, branch=${C.branch} ===`,
);
let kept = 0,
  raised = 0;
for (let i = 1; i <= N; i++) {
  const region = loadFence()?.regions?.[C.region];
  const mode = region?.admissible === true ? "reduce" : "raise";
  console.log(
    `\n--- iter ${i}/${N} [${mode}] ${C.region} fence ${region ? (region.p * 100).toFixed(0) + "% lo=" + (region.lo * 100).toFixed(0) + "%" : "unmeasured"} ---`,
  );

  if (mode === "raise") {
    const specs = region?.survivorSpecs ?? [];
    if (specs.length === 0) {
      logRow(
        i,
        "-",
        0,
        0,
        "-",
        region ? region.p.toFixed(2) : "-",
        "-",
        "raise-skip",
        `${C.region}: no survivor specs — run 'fence' (AST-aware audit) first`,
      );
      continue;
    }
    const loBefore = region.lo;
    const p = proposer(raisePrompt(specs));
    if (!p.ok) {
      logRow(
        i,
        "-",
        0,
        0,
        "-",
        region.p.toFixed(2),
        "-",
        "crash",
        `proposer ${p.killed ? "timeout" : "error"}: ${perr(p)}`,
      );
      cleanWT();
      continue;
    }
    if (!wtDirty()) {
      logRow(i, "-", 0, 0, "-", region.p.toFixed(2), "-", "raise-noop", "no tests added");
      cleanWT();
      continue;
    }
    const nonTest = shTry(`git -C ${WT} status --porcelain -- ${C.srcDir}`)
      .out.split("\n")
      .map((l) => l.slice(3).trim())
      .filter(Boolean)
      .filter((f) => !/\.(test|spec)\.[jt]sx?$/.test(f));
    if (nonTest.length) {
      logRow(
        i,
        "-",
        0,
        0,
        "-",
        region.p.toFixed(2),
        "-",
        "raise-badtest",
        `touched non-test source: ${nonTest.join(",")}`,
      );
      cleanWT();
      continue;
    }
    if (!shTry(C.testCommand, { cwd: WT }).ok) {
      logRow(
        i,
        "-",
        0,
        0,
        "-",
        region.p.toFixed(2),
        "-",
        "raise-badtest",
        "added tests fail on current code",
      );
      cleanWT();
      continue;
    }
    sh(`git -C ${WT} add -A -- ${C.srcDir}`);
    shTry(
      `git -C ${WT} -c user.email=loop@codenuke -c user.name=codenuke commit -m "raise(iter ${i}): characterization tests for ${C.region}"`,
    );
    const commit = sh(`git -C ${WT} rev-parse --short HEAD`).trim();
    const rep = shTry(`node ${FENCE} replay ${C.region} ${WT}`, { cwd: C.repo });
    if (!rep.ok) {
      logRow(
        i,
        commit,
        0,
        0,
        "true",
        region.p.toFixed(2),
        "-",
        "raise-error",
        `replay failed: ${perr(rep)}`,
      );
      continue;
    }
    const after = loadFence().regions[C.region];
    raised++;
    logRow(
      i,
      commit,
      0,
      0,
      "true",
      after.p.toFixed(2),
      "-",
      after.lo > loBefore + 1e-9 ? "raise" : "raise-nogain",
      `${C.region} fence ${(loBefore * 100).toFixed(0)}%→${(after.p * 100).toFixed(0)}% lo=${(after.lo * 100).toFixed(0)}%${after.admissible ? " ADMISSIBLE✓" : ""}`,
    );
    continue;
  }

  const p = proposer(reducePrompt());
  if (!p.ok) {
    logRow(
      i,
      "-",
      0,
      0,
      "-",
      region.p.toFixed(2),
      "+Inf",
      "crash",
      `proposer ${p.killed ? "timeout" : "error"}: ${perr(p)}`,
    );
    cleanWT();
    continue;
  }
  const s = shTry(`node ${SCORER} score --json`, { cwd: C.repo });
  const jline = (s.out.split("\n").find((l) => l.startsWith("@@JSON@@")) || "").slice(
    "@@JSON@@".length,
  );
  if (!jline) {
    logRow(i, "-", 0, 0, "-", region.p.toFixed(2), "-", "noop", "no scorable src change");
    cleanWT();
    continue;
  }
  const v = JSON.parse(jline);
  const desc = `ΔAST=${v.dL} ${v.files.join(",")}`;
  if (v.keep) {
    sh(`node ${SCORER} accept`, { cwd: C.repo });
    kept++;
    logRow(
      i,
      sh(`git -C ${WT} rev-parse --short HEAD`).trim(),
      v.dL,
      v.dCx,
      v.gates.G1,
      v.mfence?.toFixed(2) ?? "-",
      v.loss?.toFixed(3) ?? "+Inf",
      "keep",
      desc,
    );
  } else {
    cleanWT();
    logRow(
      i,
      "-",
      v.dL,
      v.dCx,
      v.gates.G1,
      v.mfence?.toFixed(2) ?? "-",
      v.loss?.toFixed(3) ?? "+Inf",
      "revert",
      `${desc} | ${v.gates.G1prime ? "" : "G1′ "}${v.gates.G1 ? "" : "G1 "}${v.gates.G3 ? "" : "G3 "}${v.gates.G4 ? "" : "G4↓"}`.trim(),
    );
  }
}
console.log(`\n=== done: ${kept} kept, ${raised} fence-raises ===`);
sh(`node ${SCORER} status`, { cwd: C.repo, stdio: ["ignore", "inherit", "inherit"] });
console.log(`branch ${C.branch} | results: ${C.results}`);
