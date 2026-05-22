// loop/scorer.mjs — the immutable judge (the val_bpb analog). The proposer never imports
// or runs this; the harness shells to it (`node scorer.mjs score --json`). Immutability is
// the integrity guarantee: a change cannot win by rewriting the judge.
//
//   node loop/scorer.mjs init | score [--json] | accept | revert | status | cleanup
//
// Lexicographic: gates (hard) ≻ value. A change is admissible iff
//   G1  behavior   — the test suite stays green (was green on baseline)
//   G1′ fence      — every touched region's mutation-fence CI lower bound ≥ threshold
//   G3  types      — no new type errors (skipped if the repo has no typecheck)
//   G4  size       — net source AST nodes strictly decrease
// then value = z-scored (ΔAST + Δcomplexity + ΔdupΔ), keep iff loss = risk − value < 0.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, symlinkSync, rmSync, mkdirSync } from "node:fs";
import { measure } from "./measure.mjs";
import { loadConfig, regionOf, isSourceFile } from "./config.mjs";

const C = loadConfig();
const WT = C.worktree;
const sh = (cmd, opts = {}) =>
  execSync(cmd, {
    cwd: WT,
    maxBuffer: 1 << 30,
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  }).toString();
const shRepo = (cmd) =>
  execSync(cmd, { cwd: C.repo, maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] }).toString();
const readState = () => JSON.parse(readFileSync(C.state, "utf8"));
const writeState = (s) => writeFileSync(C.state, JSON.stringify(s, null, 2));
const showAt = (ref, p) => {
  try {
    return sh(`git show ${ref}:${p}`);
  } catch {
    return null;
  }
};
const ensureDir = (f) => {
  try {
    mkdirSync(f.split("/").slice(0, -1).join("/"), { recursive: true });
  } catch {}
};

function testsPass() {
  try {
    sh(C.testCommand);
    return true;
  } catch {
    return false;
  }
}
function typeErrors() {
  if (!C.typeCheckCommand) return 0;
  try {
    sh(C.typeCheckCommand);
    return 0;
  } catch (e) {
    return (e.stdout?.toString() || "").split("\n").filter((l) => /error TS/.test(l)).length || 1;
  }
}
function targetL(ref) {
  const files = (sh(`git ls-tree -r --name-only ${ref} -- ${C.target}`) || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(isSourceFile);
  const map = {};
  for (const f of files) {
    const c = showAt(ref, f);
    if (c !== null) map[f] = c;
  }
  return measure(map).L;
}
const changedSource = () =>
  (sh(`git diff --name-only HEAD -- ${C.srcDir}`) || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(isSourceFile);
const loadFence = () => {
  try {
    return JSON.parse(readFileSync(C.fenceArtifact, "utf8"));
  } catch {
    return null;
  }
};
const loadCalibration = () => {
  try {
    return JSON.parse(readFileSync(`${C.repo}/.codenuke/calibration.json`, "utf8")).scales;
  } catch {
    return null;
  }
};

function requireState() {
  if (existsSync(C.state)) return readState();
  console.log("run `codenuke init` first");
  process.exit(1);
}

const cmd = process.argv[2];

if (cmd === "init") {
  try {
    shRepo(`git worktree remove --force ${WT}`);
  } catch {}
  shRepo(`git worktree add -f ${WT} ${C.baseline}`);
  try {
    symlinkSync(`${C.repo}/node_modules`, `${WT}/node_modules`);
  } catch {}
  console.log(`verifying baseline (test${C.typeCheckCommand ? " + typecheck" : ""})…`);
  const green = testsPass(),
    t0 = typeErrors();
  if (!green) {
    console.log(`baseline tests RED (cmd: ${C.testCommand}) — abort`);
    process.exit(1);
  }
  writeState({ baselineTsc: t0, startL: targetL("HEAD"), accepted: [], iter: 0 });
  console.log(`baseline GREEN ✓  typeErrors=${t0}  ${C.target} astNodes=${targetL("HEAD")}`);
  console.log(`proposer edits ${WT}/${C.target} to reduce code (preserve behavior), then 'score'.`);
} else if (cmd === "score") {
  const st = requireState();
  const changed = changedSource();
  if (changed.length === 0) {
    console.log("no candidate (working tree clean) — proposer must edit first.");
    process.exit(0);
  }
  const before = measure(
    Object.fromEntries(
      changed.map((p) => [p, showAt("HEAD", p) ?? ""]).filter(([, c]) => c !== null),
    ),
  );
  const after = measure(
    Object.fromEntries(
      changed.map((p) => [p, existsSync(`${WT}/${p}`) ? readFileSync(`${WT}/${p}`, "utf8") : ""]),
    ),
  );
  const dL = before.L - after.L,
    dDup = before.dupMass - after.dupMass,
    dCx = before.complexity - after.complexity;

  const fence = loadFence();
  const touched = [...new Set(changed.map((p) => regionOf(p, C.srcDir)))];
  const fenceOf = (r) => fence?.regions?.[r] ?? null;
  const blocked = touched.filter((r) => !(fenceOf(r)?.admissible === true));
  const G1prime = fence != null && blocked.length === 0;

  const G1 = testsPass();
  const tscNow = typeErrors(),
    G3 = tscNow <= st.baselineTsc;
  const G4 = dL > 0;
  const admissible = G1 && G1prime && G3 && G4;

  const W = C.weights;
  const scales = loadCalibration();
  const scaleL = scales?.sL ?? W.scaleL;
  const scaleCx = scales?.sCx ?? W.scaleCx;
  const scaleDup = scales?.sDup ?? W.scaleDup;
  const gain = W.dL * (dL / scaleL) + W.dCx * (dCx / scaleCx) + W.dDup * (dDup / scaleDup);
  const ss = sh(`git diff --shortstat HEAD -- ${C.srcDir}`) || "";
  const diffsize =
    Number(ss.match(/(\d+) insert/)?.[1] ?? 0) + Number(ss.match(/(\d+) delet/)?.[1] ?? 0);
  const mfence = touched.length ? Math.min(...touched.map((r) => fenceOf(r)?.p ?? 0)) : 1;
  const risk = 0.002 * diffsize + W.r3 * (1 - mfence);
  const loss = admissible ? risk - gain : Infinity;
  const keep = admissible && loss < 0;

  const Y = (b) => (b ? "✓" : "✗");
  const fenceTxt = G1prime
    ? `clear (mfence=${(mfence * 100).toFixed(0)}%)`
    : fence == null
      ? "NO AUDIT (fail-closed)"
      : `blocked: ${blocked.map((r) => `${r}[lo=${((fenceOf(r)?.lo ?? 0) * 100).toFixed(0)}%]`).join(", ")}`;
  console.log(`\n  candidate: ${changed.map((p) => p.replace(C.srcDir + "/", "")).join(", ")}`);
  console.log(
    `  gates: G1 ${Y(G1)}  G1′ ${Y(G1prime)} (${fenceTxt})  G3 ${Y(G3)} (types ${tscNow}/${st.baselineTsc})  G4↓ ${Y(G4)}`,
  );
  console.log(
    `  ΔAST=${dL} ΔCx=${dCx} ΔDup=${dDup}  gain=${gain.toFixed(3)} risk=${risk.toFixed(3)} loss=${Number.isFinite(loss) ? loss.toFixed(3) : "+Inf"}`,
  );
  console.log(
    `  VERDICT: ${!G1prime ? "REJECT (G1′ fence)" : keep ? "KEEP" : admissible ? "REJECT (no gain)" : "REJECT (gate)"}`,
  );
  if (process.argv.includes("--json")) {
    process.stdout.write(
      "@@JSON@@" +
        JSON.stringify({
          admissible,
          keep,
          loss: Number.isFinite(loss) ? loss : null,
          gain,
          risk,
          dL,
          dCx,
          dDup,
          mfence,
          touched,
          blocked,
          gates: { G1, G1prime, G3, G4 },
          files: changed.map((p) => p.replace(C.srcDir + "/", "")),
        }) +
        "\n",
    );
  }
} else if (cmd === "accept") {
  const st = requireState();
  if (changedSource().length === 0) {
    console.log("nothing to accept.");
    process.exit(0);
  }
  sh(`git add -A -- ${C.srcDir}`);
  sh(
    `git -c user.email=loop@codenuke -c user.name=codenuke -c commit.gpgsign=false commit -m "reduce: accepted refactor"`,
  );
  st.iter += 1;
  st.accepted.push(sh("git rev-parse --short HEAD").trim());
  writeState(st);
  console.log(`accepted (iteration ${st.iter}).`);
} else if (cmd === "revert") {
  sh(`git reset --hard HEAD`);
  try {
    sh(`git clean -fdq ${C.srcDir}`);
  } catch {}
  console.log("candidate reverted.");
} else if (cmd === "status") {
  const st = requireState();
  const now = targetL("HEAD"),
    cut = st.startL - now;
  console.log(`iterations=${st.iter} accepted=[${st.accepted.join(", ")}]`);
  console.log(
    `${C.target} astNodes: ${st.startL} -> ${now}  (cumulative reduction ${cut}, ${st.startL ? ((cut / st.startL) * 100).toFixed(1) : "0"}%)`,
  );
} else if (cmd === "cleanup") {
  try {
    rmSync(`${WT}/node_modules`, { force: true });
  } catch {}
  try {
    rmSync(C.state);
  } catch {}
  try {
    shRepo(`git worktree remove --force ${WT}`);
    shRepo("git worktree prune");
  } catch {}
  console.log("worktree removed.");
} else console.log("usage: scorer.mjs init|score [--json]|accept|revert|status|cleanup");

void ensureDir; // (kept for callers that pre-create .codenuke/)
