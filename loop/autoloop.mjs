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

import { execSync, spawn } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  appendFileSync,
  mkdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { relative } from "node:path";
import {
  calibrationArtifactStatus,
  fenceArtifactStatus,
  valueProxyValidationStatus,
} from "./artifacts.mjs";
import { isSourceFile, loadConfig } from "./config.mjs";

const C = loadConfig();
const WT = C.worktree;
const SCORER = new URL("./scorer.mjs", import.meta.url).pathname;
const FENCE = new URL("./fence.mjs", import.meta.url).pathname;
const N = Number(process.argv[2]) || 5;
const PROPOSER = process.env.CN_PROPOSER;
const LONG_RUN_ITERATIONS = 5;
const benchmarkRel = relative(C.repo, C.benchmarkDir);
const benchmarkInsideRepo =
  benchmarkRel && !benchmarkRel.startsWith("..") && !benchmarkRel.startsWith("/");

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
      timedOut: e.signal === "SIGTERM" || e.code === "ETIMEDOUT",
    };
  }
};
const shGroupTry = (cmd, opts = {}) =>
  new Promise((resolve) => {
    const child = spawn(cmd, {
      cwd: opts.cwd,
      detached: true,
      env: opts.env ?? process.env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out = [];
    const timeout = opts.timeout ?? 300000;
    let done = false;
    let timedOut = false;
    const killGroup = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch {}
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      setTimeout(() => {
        if (!done) killGroup("SIGKILL");
      }, 1000).unref();
    }, timeout);
    timer.unref();
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => out.push(chunk));
    child.on("error", (error) => {
      done = true;
      clearTimeout(timer);
      resolve({ ok: false, out: String(error), timedOut: false });
    });
    child.on("close", (code) => {
      done = true;
      clearTimeout(timer);
      if (code !== 0 && !timedOut) killGroup("SIGTERM");
      resolve({ ok: code === 0 && !timedOut, out: Buffer.concat(out).toString(), timedOut });
    });
  });
const cleanWT = () => {
  shTry(`git -C ${WT} reset --hard HEAD`);
  shTry(`git -C ${WT} clean -fdq ${C.srcDir}`);
};
const discardTipCommit = () => {
  shTry(`git -C ${WT} reset --hard HEAD~1`);
  shTry(`git -C ${WT} clean -fdq ${C.srcDir}`);
};
const quote = (value) => JSON.stringify(value);
const isHiddenBenchmarkDeletion = (line) => {
  const status = line.slice(0, 2);
  const path = line
    .slice(3)
    .trim()
    .replace(/^.* -> /u, "");
  return (
    benchmarkInsideRepo &&
    path.startsWith(`${benchmarkRel}/`) &&
    status.includes("D") &&
    !status.includes("?")
  );
};
const hideBenchmarkFromProposer = () => {
  if (benchmarkInsideRepo) rmSync(`${WT}/${benchmarkRel}`, { recursive: true, force: true });
};
const restoreHiddenBenchmark = () => {
  if (benchmarkInsideRepo) shTry(`git -C ${WT} checkout -- ${quote(benchmarkRel)}`);
};
const hideRuntimeDepsFromProposer = () => {
  rmSync(`${WT}/node_modules`, { recursive: true, force: true });
};
const restoreRuntimeDeps = () => {
  rmSync(`${WT}/node_modules`, { recursive: true, force: true });
  try {
    symlinkSync(`${C.repo}/node_modules`, `${WT}/node_modules`);
  } catch {}
};
const prepareProposerWorktree = () => {
  hideBenchmarkFromProposer();
  hideRuntimeDepsFromProposer();
};
const restoreAfterProposer = () => {
  restoreHiddenBenchmark();
  restoreRuntimeDeps();
};
const cleanDirtyPaths = (paths) => {
  shTry(`git -C ${WT} reset --hard HEAD`);
  for (const path of paths) shTry(`git -C ${WT} clean -fdq -- ${quote(path)}`);
  shTry(`git -C ${WT} clean -fdq ${C.srcDir}`);
};
const perr = (p) => (p.out || "").replace(/\s+/g, " ").slice(-200);
const proposerFailure = (p) => {
  if (p.timedOut)
    return {
      status: "crash-timeout",
      description: `proposer timeout after ${C.proposerTimeoutMs}ms`,
    };
  if (/Reached maximum budget|maximum budget/iu.test(p.out || ""))
    return {
      status: "crash-budget",
      description: `proposer budget exhausted: ${perr(p)}`,
    };
  return { status: "crash", description: `proposer error: ${perr(p)}` };
};
const loadFence = () => {
  try {
    return JSON.parse(readFileSync(C.fenceArtifact, "utf8"));
  } catch {
    return null;
  }
};
const dirtyPaths = () =>
  shTry(`git -C ${WT} status --porcelain`)
    .out.split("\n")
    .filter((line) => !isHiddenBenchmarkDeletion(line))
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .map((path) => path.replace(/^.* -> /u, ""))
    .filter((path) => path !== "node_modules" && !path.startsWith("node_modules/"));
const dirtyPathsAfterProposer = () => {
  const paths = dirtyPaths();
  if (existsSync(`${WT}/node_modules`)) paths.push("node_modules");
  return [...new Set(paths)];
};
const wtDirty = () => dirtyPathsAfterProposer().length > 0;
const underSrcDir = (path) =>
  C.srcDir === "." || path === C.srcDir || path.startsWith(`${C.srcDir}/`);
const allowedReducePath = (path) => underSrcDir(path) && isSourceFile(path);
const allowedRaisePath = (path) => underSrcDir(path) && /\.(test|spec)\.[jt]sx?$/u.test(path);
const regionTarget = (regionKey) => {
  if (C.srcDir === ".") return regionKey === "." ? "." : `${regionKey}/`;
  if (regionKey === C.srcDir) return `${C.srcDir}/`;
  return `${C.srcDir}/${regionKey}/`;
};
function inScopeRegions(fence) {
  const fenced = fence?.regions ?? {};
  const filter = targetRegionFilter();
  const detected = C.regions.filter((regionKey) => fenced[regionKey]);
  if (filter) return detected.filter((regionKey) => regionKey === filter);
  if (detected.length > 0) return detected;
  return Object.keys(fenced);
}
function targetRegionFilter() {
  const target = C.target.replace(/\/+$/, "");
  const src = C.srcDir.replace(/\/+$/, "");
  if (target === src || target === `${src}` || target === ".") return null;
  const rel = C.srcDir === "." ? target : target.replace(new RegExp(`^${C.srcDir}/?`), "");
  return rel ? rel.split("/")[0] : null;
}
function chooseRegion(fence) {
  const candidates = inScopeRegions(fence);
  const blocked = candidates
    .filter((regionKey) => fence.regions[regionKey]?.admissible !== true)
    .sort((left, right) => (fence.regions[right]?.lo ?? 0) - (fence.regions[left]?.lo ?? 0));
  return (
    blocked[0] ??
    candidates.find((regionKey) => fence.regions[regionKey]?.admissible === true) ??
    C.region
  );
}
function requireRunFence() {
  const status = fenceArtifactStatus(C);
  const fence = status.artifact;
  if (!fence) {
    console.log(
      `fence artifact missing or invalid at ${C.fenceArtifact}; run \`codenuke fence\` first, then \`codenuke doctor\`.`,
    );
    process.exit(1);
  }
  if (!status.usable) {
    const label = status.stale ? "stale" : "invalid";
    console.log(
      `fence artifact is ${label} for baseline ${C.baseline}; run \`codenuke fence\` first, then \`codenuke doctor\`.`,
    );
    process.exit(1);
  }
  const candidates = inScopeRegions(fence);
  if (candidates.length === 0) {
    console.log(
      `fence artifact has no measured in-scope regions for target ${C.target}; run \`codenuke fence\` for the detected regions, then \`codenuke doctor\`.`,
    );
    process.exit(1);
  }
  return fence;
}
function requireRunCalibration() {
  const status = calibrationArtifactStatus(C);
  if (!status.artifact) {
    console.log(
      `calibration artifact missing at ${C.repo}/.codenuke/calibration.json; run \`codenuke calibrate\` first, then \`codenuke doctor\`.`,
    );
    process.exit(1);
  }
  if (!status.usable) {
    const label = status.stale ? "stale" : "invalid";
    console.log(
      `calibration artifact is ${label} for baseline ${C.baseline}; run \`codenuke calibrate\` first, then \`codenuke doctor\`.`,
    );
    process.exit(1);
  }
}
function requireValueProxyValidationForLongRun() {
  if (N <= LONG_RUN_ITERATIONS) return;
  const status = valueProxyValidationStatus(C);
  if (!status.artifact) {
    console.log(
      `value proxy validation missing at ${C.repo}/.codenuke/value-proxy-validation.json; run \`codenuke changecost\` and \`codenuke validate-proxy\` before long unattended runs.`,
    );
    process.exit(1);
  }
  if (!status.usable) {
    console.log(
      `value proxy validation is not passing; run \`codenuke changecost\` and \`codenuke validate-proxy\` before long unattended runs.`,
    );
    process.exit(1);
  }
}
function logRow(...cols) {
  appendFileSync(C.results, cols.join("\t") + "\n");
  console.log(`  → ${cols[7]?.toUpperCase?.() ?? cols[7]}  ${cols[8] ?? ""}`);
}

function proposer(prompt, regionKey) {
  const env = { ...process.env, CN_REGION: regionKey, CN_TARGET: regionTarget(regionKey) };
  if (PROPOSER) return shGroupTry(PROPOSER, { cwd: WT, timeout: C.proposerTimeoutMs, env });
  writeFileSync(C.promptFile, prompt);
  const cmd = `claude -p --permission-mode bypassPermissions --no-session-persistence --allowedTools ${JSON.stringify("Edit Write Read Grep Glob")} --max-budget-usd ${C.proposerBudgetUsd} --output-format json < ${C.promptFile}`;
  return shGroupTry(cmd, { cwd: WT, timeout: C.proposerTimeoutMs, env });
}
const reducePrompt = (regionKey) =>
  `${readFileSync(C.program, "utf8")}\n\n---\nYou are running now. Target region: ${regionTarget(regionKey)}. Make exactly ONE behavior-preserving reduction in a single file under ${regionTarget(regionKey)}, then stop. Do not run commands; just edit.`;
function raisePrompt(regionKey, specs) {
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
  return `You are the fence-raising proposer. The region ${regionTarget(regionKey)} is fence-BLOCKED: its tests miss some behavior changes (mutation survivors). ADD characterization tests (colocated test files under ${regionTarget(regionKey)}) that pin the CURRENT behavior so these mutations would be caught. Do NOT change any source — only add/extend tests.\n\nSurviving mutations:\n${shown}\n\nRead the source, understand what each operator decides, and assert the real current outputs for inputs exercising both sides. Make the tests pass against current code. Then stop. Do not run commands; just write tests.`;
}

// ---- ensure measured fence, worktree + branch + results ----
requireRunFence();
requireRunCalibration();
requireValueProxyValidationForLongRun();
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
  `\n=== autoloop: ${N} iters, proposer=${PROPOSER ? "scripted" : "claude -p"}, regions=${C.regions.join(",") || C.region}, branch=${C.branch} ===`,
);
let kept = 0,
  raised = 0;
for (let i = 1; i <= N; i++) {
  const fence = loadFence();
  const activeRegion = fence ? chooseRegion(fence) : C.region;
  const region = fence?.regions?.[activeRegion];
  const mode = region?.admissible === true ? "reduce" : "raise";
  console.log(
    `\n--- iter ${i}/${N} [${mode}] ${activeRegion} fence ${region ? (region.p * 100).toFixed(0) + "% lo=" + (region.lo * 100).toFixed(0) + "%" : "unmeasured"} ---`,
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
        `${activeRegion}: no survivor specs — run 'fence' (AST-aware audit) first`,
      );
      break;
    }
    const loBefore = region.lo;
    prepareProposerWorktree();
    const p = await proposer(raisePrompt(activeRegion, specs), activeRegion);
    if (!p.ok) {
      const failure = proposerFailure(p);
      logRow(i, "-", 0, 0, "-", region.p.toFixed(2), "-", failure.status, failure.description);
      restoreAfterProposer();
      cleanWT();
      continue;
    }
    if (!wtDirty()) {
      logRow(i, "-", 0, 0, "-", region.p.toFixed(2), "-", "raise-noop", "no tests added");
      restoreAfterProposer();
      cleanWT();
      continue;
    }
    const disallowed = dirtyPathsAfterProposer().filter((path) => !allowedRaisePath(path));
    if (disallowed.length) {
      logRow(
        i,
        "-",
        0,
        0,
        "-",
        region.p.toFixed(2),
        "-",
        "raise-badtest",
        `touched outside raise test surface: ${disallowed.join(",")}`,
      );
      restoreAfterProposer();
      cleanDirtyPaths(disallowed);
      continue;
    }
    restoreAfterProposer();
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
      `git -C ${WT} -c user.email=loop@codenuke -c user.name=codenuke -c commit.gpgsign=false commit -m "raise(iter ${i}): characterization tests for ${activeRegion}"`,
    );
    const commit = sh(`git -C ${WT} rev-parse --short HEAD`).trim();
    const rep = shTry(`node ${FENCE} replay ${activeRegion} ${WT}`, { cwd: C.repo });
    if (!rep.ok) {
      discardTipCommit();
      logRow(
        i,
        "-",
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
    const after = loadFence().regions[activeRegion];
    raised++;
    const status = after.lo > loBefore + 1e-9 ? "raise" : "raise-nogain";
    const keptCommit = status === "raise";
    if (!keptCommit) discardTipCommit();
    logRow(
      i,
      keptCommit ? commit : "-",
      0,
      0,
      "true",
      after.p.toFixed(2),
      "-",
      status,
      `${activeRegion} fence ${(loBefore * 100).toFixed(0)}%→${(after.p * 100).toFixed(0)}% lo=${(after.lo * 100).toFixed(0)}%${after.admissible ? " ADMISSIBLE✓" : ""}`,
    );
    continue;
  }

  prepareProposerWorktree();
  const p = await proposer(reducePrompt(activeRegion), activeRegion);
  if (!p.ok) {
    const failure = proposerFailure(p);
    logRow(i, "-", 0, 0, "-", region.p.toFixed(2), "+Inf", failure.status, failure.description);
    restoreAfterProposer();
    cleanWT();
    continue;
  }
  const disallowed = dirtyPathsAfterProposer().filter((path) => !allowedReducePath(path));
  if (disallowed.length) {
    logRow(
      i,
      "-",
      0,
      0,
      "-",
      region.p.toFixed(2),
      "+Inf",
      "revert",
      `proposer touched outside reduce source surface: ${disallowed.join(",")}`,
    );
    restoreAfterProposer();
    cleanDirtyPaths(disallowed);
    continue;
  }
  restoreAfterProposer();
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
