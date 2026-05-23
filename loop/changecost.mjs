// loop/changecost.mjs — evaluate_changecost: the value ground truth (the val_bpb analog).
// Measures 𝒱̂(C) = mean over a held-out change-benchmark Δ of the realized cost of
// implementing each change δ on C: cost = edit (formatting-invariant token-diff of the
// non-test source) + β·verify (1 − fence fidelity of the regions touched). Lower = the
// codebase absorbs its own future more cheaply. See docs/spec.md. This is the
// expensive PERIODIC audit; the inner loop uses the cheap proxy in scorer.mjs.
//
//   import { editCost, verifyCost } from "./changecost.mjs"   (library)
//   node loop/changecost.mjs [ref]                            (run the benchmark → 𝒱̂)

import { execSync } from "node:child_process";
import {
  appendFileSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  symlinkSync,
  rmSync,
  mkdirSync,
} from "node:fs";
import { relative } from "node:path";
import ts from "typescript";
import { fenceArtifactStatus } from "./artifacts.mjs";
import { loadConfig, regionOf, isSourceFile } from "./config.mjs";
import { runCodexAgent } from "./agent-adapter.mjs";

// ---------- library: formatting-invariant edit size + verify cost ----------
export function tokenize(name, text) {
  const sf = ts.createSourceFile(
    name,
    text,
    ts.ScriptTarget.Latest,
    true,
    /\.tsx$/.test(name) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const toks = [];
  (function walk(node) {
    const kids = node.getChildren(sf);
    if (kids.length === 0) {
      const t = node.getText(sf);
      if (t !== "") toks.push(t);
    } else for (const k of kids) walk(k);
  })(sf);
  return toks;
}
export function lcsEditSize(a, b) {
  const n = a.length,
    m = b.length;
  if (n === 0) return m;
  if (m === 0) return n;
  let prev = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    const cur = new Array(m + 1).fill(0);
    const ai = a[i - 1];
    for (let j = 1; j <= m; j++)
      cur[j] = ai === b[j - 1] ? prev[j - 1] + 1 : prev[j] >= cur[j - 1] ? prev[j] : cur[j - 1];
    prev = cur;
  }
  return n - prev[m] + (m - prev[m]);
}
export function editCost(beforeMap, afterMap, srcDir = "src") {
  const counted = (p) => (srcDir === "." || p.startsWith(`${srcDir}/`)) && isSourceFile(p);
  const files = new Set([...Object.keys(beforeMap), ...Object.keys(afterMap)].filter(counted));
  let tokens = 0,
    touched = 0;
  const perFile = {};
  for (const f of files) {
    if (beforeMap[f] === afterMap[f]) continue;
    const d = lcsEditSize(
      beforeMap[f] != null ? tokenize(f, beforeMap[f]) : [],
      afterMap[f] != null ? tokenize(f, afterMap[f]) : [],
    );
    if (d > 0) {
      perFile[f] = d;
      touched++;
      tokens += d;
    }
  }
  return { tokens, filesTouched: touched, perFile };
}
export function verifyCost(touchedRegions, fenceArtifact) {
  if (touchedRegions.length === 0) return 0;
  const fid = (r) => fenceArtifact?.regions?.[r]?.p ?? 0;
  return touchedRegions.reduce((s, r) => s + (1 - fid(r)), 0) / touchedRegions.length;
}

export function buildImplementerPrompt(delta, srcDir) {
  return `Implement this change-request (cwd is the repo root).

## Request
${delta.prompt}

The hidden acceptance test will be installed at ${delta.acceptPath} after implementation and run with the full suite. Edit ONLY non-test source under ${srcDir}/. Implement for real (no test-specific hacks). When done, stop.`;
}

// ---------- CLI: run the benchmark ----------
if (import.meta.url === `file://${process.argv[1]}`) {
  const C = loadConfig();
  const WT = `${C.worktree}-changecost`;
  const OUT = `${C.repo}/.codenuke/changecost.json`;
  const REF = process.argv[2] || C.baseline;
  const BETA = Number(process.env.CN_BETA ?? 60);
  const IMPLEMENTER = process.env.CN_IMPLEMENTER;
  const quote = (value) => JSON.stringify(value);
  const benchmarkRel = relative(C.repo, C.benchmarkDir);
  const benchmarkInsideRepo =
    benchmarkRel && !benchmarkRel.startsWith("..") && !benchmarkRel.startsWith("/");
  const sh = (c, opts = {}) => {
    const r = execSync(c, {
      maxBuffer: 1 << 30,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      ...opts,
    });
    return r ? r.toString() : "";
  };
  const shTry = (c, opts = {}) => {
    try {
      return { ok: true, out: sh(c, opts) };
    } catch (e) {
      return { ok: false, out: (e.stdout?.toString() || "") + (e.stderr?.toString() || "") };
    }
  };
  const green = () => shTry(C.testCommand, { cwd: WT }).ok;
  function excludeWorktreeHelper(path) {
    const exclude = sh(`git -C ${WT} rev-parse --git-path info/exclude`).trim();
    let current = "";
    try {
      current = readFileSync(exclude, "utf8");
    } catch {}
    if (!current.split(/\r?\n/u).includes(path)) appendFileSync(exclude, `${path}\n`);
  }
  const cleanWT = () => {
    shTry(`git -C ${WT} reset --hard HEAD`);
    shTry(`git -C ${WT} clean -fdq`);
  };
  const cleanDirtyPaths = (paths) => {
    shTry(`git -C ${WT} reset --hard HEAD`);
    for (const path of paths) shTry(`git -C ${WT} clean -fdq -- ${quote(path)}`);
    shTry(`git -C ${WT} clean -fdq`);
  };
  const hideBenchmarkFromWorktree = () => {
    if (benchmarkInsideRepo) rmSync(`${WT}/${benchmarkRel}`, { recursive: true, force: true });
  };
  const cleanupWorktree = () => {
    try {
      rmSync(`${WT}/node_modules`, { force: true });
    } catch {}
    try {
      sh(`git -C ${C.repo} worktree remove --force ${WT}`);
      sh(`git -C ${C.repo} worktree prune`);
    } catch {}
  };
  const dirtyPaths = () =>
    shTry(`git -C ${WT} status --porcelain`)
      .out.split("\n")
      .filter((line) => {
        const status = line.slice(0, 2);
        const path = line
          .slice(3)
          .trim()
          .replace(/^.* -> /u, "");
        return !(
          benchmarkInsideRepo &&
          path.startsWith(`${benchmarkRel}/`) &&
          status.includes("D") &&
          !status.includes("?")
        );
      })
      .map((line) => line.slice(3).trim())
      .filter(Boolean)
      .map((path) => path.replace(/^.* -> /u, ""))
      .filter((path) => path !== "node_modules" && !path.startsWith("node_modules/"));
  const underSrcDir = (path) =>
    C.srcDir === "." || path === C.srcDir || path.startsWith(`${C.srcDir}/`);
  const allowedImplementerPath = (path) => underSrcDir(path) && isSourceFile(path);
  const snapshot = () => {
    const m = {};
    for (const f of sh(`git -C ${WT} ls-files ${C.srcDir}`)
      .split("\n")
      .map((s) => s.trim())
      .filter(isSourceFile)) {
      try {
        m[f] = readFileSync(`${WT}/${f}`, "utf8");
      } catch {}
    }
    return m;
  };
  const fenceStatus = fenceArtifactStatus(C);
  const fence = fenceStatus.usable ? fenceStatus.artifact : null;
  const Δ = existsSync(C.benchmarkDir)
    ? readdirSync(C.benchmarkDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => ({
          dir: `${C.benchmarkDir}/${d.name}`,
          ...JSON.parse(readFileSync(`${C.benchmarkDir}/${d.name}/meta.json`, "utf8")),
        }))
        .sort((a, b) => a.id.localeCompare(b.id))
    : [];
  if (Δ.length === 0) {
    console.log(
      `no benchmark in ${C.benchmarkDir} (add change-requests: <id>/meta.json + accept.test.ts)`,
    );
    process.exit(1);
  }

  try {
    sh(`git -C ${C.repo} worktree remove --force ${WT}`);
  } catch {}
  sh(`git -C ${C.repo} worktree add -f ${WT} ${REF}`);
  try {
    symlinkSync(`${C.repo}/node_modules`, `${WT}/node_modules`);
    excludeWorktreeHelper("node_modules");
  } catch {}
  if (!green()) {
    console.log("baseline RED — abort");
    cleanupWorktree();
    process.exit(1);
  }
  const baseline = snapshot();
  console.log(
    `evaluate_changecost @ ${REF}  β=${BETA}  implementer=${IMPLEMENTER ? "scripted" : "codex exec"}`,
  );

  const results = [];
  for (const delta of Δ) {
    console.log(`\n--- δ ${delta.id}: ${delta.title} ---`);
    const acceptAbs = `${WT}/${delta.acceptPath}`;
    const acceptTest = readFileSync(`${delta.dir}/accept.test.ts`, "utf8");
    const prompt = buildImplementerPrompt(delta, C.srcDir);
    hideBenchmarkFromWorktree();
    let impl;
    if (IMPLEMENTER)
      impl = shTry(IMPLEMENTER, {
        cwd: WT,
        timeout: 300000,
        env: { ...process.env, CN_DELTA: delta.id },
      });
    else {
      writeFileSync(C.promptFile, prompt);
      impl = await runCodexAgent(prompt, {
        cwd: WT,
        timeout: 300000,
        env: { ...process.env, CN_DELTA: delta.id },
        outputPath: `${C.promptFile}.last.txt`,
      });
    }
    if (!impl.ok) {
      console.log("  implementer error");
      results.push({ id: delta.id, status: "impl-fail" });
      cleanWT();
      continue;
    }
    const disallowed = dirtyPaths().filter((path) => !allowedImplementerPath(path));
    if (disallowed.length) {
      console.log(`  implementer touched outside source surface: ${disallowed.join(",")}`);
      results.push({ id: delta.id, status: "impl-bad-surface", disallowed });
      cleanDirtyPaths(disallowed);
      continue;
    }
    mkdirSync(acceptAbs.split("/").slice(0, -1).join("/"), { recursive: true });
    writeFileSync(acceptAbs, acceptTest);
    if (!green()) {
      console.log("  acceptance/suite RED — not done");
      results.push({ id: delta.id, status: "not-done" });
      cleanWT();
      continue;
    }
    const e = editCost(baseline, snapshot(), C.srcDir);
    const regions = [...new Set(Object.keys(e.perFile).map((p) => regionOf(p, C.srcDir)))];
    const vf = fence ? verifyCost(regions, fence) : 1;
    const cost = e.tokens + BETA * vf;
    console.log(
      `  edit=${e.tokens} tokens (${e.filesTouched} files: ${regions.join(",") || "-"})  verify=${vf.toFixed(2)}  cost=${cost.toFixed(1)}`,
    );
    results.push({
      id: delta.id,
      status: "done",
      editTokens: e.tokens,
      regions,
      verifyFrac: vf,
      cost,
    });
    cleanWT();
  }
  const done = results.filter((r) => r.status === "done");
  const Vhat = done.length ? done.reduce((s, r) => s + r.cost, 0) / done.length : null;
  mkdirSync(OUT.split("/").slice(0, -1).join("/"), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify(
      { ref: REF, beta: BETA, Vhat, done: done.length, total: Δ.length, results },
      null,
      2,
    ),
  );
  cleanupWorktree();
  console.log(
    `\n=== 𝒱̂(${REF}) = ${Vhat == null ? "n/a" : Vhat.toFixed(1)} over ${done.length}/${Δ.length} changes ===  -> ${OUT}`,
  );
}
