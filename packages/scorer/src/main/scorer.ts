/**
 * The immutable judge's decision (P0). Migrated from the scoring core of
 * `legacy/codenuke/loop/scorer.mjs`. Pure: given the measured inputs it computes
 * the gates, gain, risk, and the keep/revert verdict. The surrounding worktree
 * orchestration (running the test suite, git diff/commit/reset) is engine-level.
 *
 * @see analysis/codenuke/BUSINESS_RULES.md — RULE-035 (keep decision), RULE-001
 *      (gain), RULE-002 (risk), RULE-018..021 (gates)
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";

import { calibrationArtifactStatus, fenceArtifactStatus } from "@codenuke/artifacts";
import { isSourceFile, loadConfig, regionOf, type Config } from "@codenuke/config";
import { run, tryRun } from "@codenuke/exec";
import type { Measurement } from "@codenuke/measure";
import { measure, type Files } from "@codenuke/measure";
import { linkWorktreeNodeModules, removeWorktree, runShellGroup } from "@codenuke/substrate";

type Env = Record<string, string | undefined>;

export interface RuntimeResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface Weights {
  readonly dL: number;
  readonly dCx: number;
  readonly dDup: number;
  readonly scaleL: number;
  readonly scaleCx: number;
  readonly scaleDup: number;
  readonly r3: number;
}

export interface CalibrationScales {
  readonly sL: number;
  readonly sCx: number;
  readonly sDup: number;
}

/** Everything the pure decision needs, resolved by the (side-effectful) caller. */
export interface ScoreInputs {
  readonly before: Measurement;
  readonly after: Measurement;
  /** G1: the target test suite is green. */
  readonly testsPass: boolean;
  /** Whether the fence artifact is usable (not missing/stale/invalid). */
  readonly fenceUsable: boolean;
  /** Touched regions whose fence is not admissible (G1′ blocks if non-empty). */
  readonly blockedRegions: readonly string[];
  /** Fence fidelity `p` per touched region (missing → caller passes 0); `[]` ⇒ mfence 1. */
  readonly touchedFidelities: readonly number[];
  /** Inserted + deleted source lines (git --shortstat). */
  readonly diffsize: number;
  readonly typeErrors: number;
  readonly baselineTypeErrors: number;
  readonly weights: Weights;
  /** Calibration scales; overrides the weight-default scales per axis when present. */
  readonly scales?: CalibrationScales | null;
}

export interface Gates {
  readonly G1: boolean;
  readonly G1prime: boolean;
  readonly G3: boolean;
  readonly G4: boolean;
}

export interface Verdict {
  readonly gain: number;
  readonly risk: number;
  readonly loss: number | null;
  readonly keep: boolean;
  readonly admissible: boolean;
  readonly gates: Gates;
  readonly dL: number;
  readonly dCx: number;
  readonly dDup: number;
  readonly mfence: number;
}

export interface ScorerState {
  readonly baselineSha: string;
  readonly baselineTsc: number;
  readonly startL: number;
  readonly accepted: string[];
  readonly iter: number;
}

export interface ScorerGitCommandPlan {
  readonly resolveBaseline: readonly string[];
  readonly addWorktree: (ref: string) => readonly string[];
  readonly targetTree: (ref: string) => readonly string[];
  readonly changedSource: readonly string[];
  readonly addChangedSource: (paths: readonly string[]) => readonly string[];
  readonly cleanSource: readonly string[];
}

/**
 * The keep/revert decision (RULE-035): lexicographic gates G1·G1′·G3·G4, then
 * keep iff admissible AND `loss = risk − gain < 0`.
 */
export function decide(input: ScoreInputs): Verdict {
  const dL = input.before.L - input.after.L;
  const dCx = input.before.complexity - input.after.complexity;
  const dDup = input.before.dupMass - input.after.dupMass;

  const G1 = input.testsPass;
  const G1prime = input.fenceUsable && input.blockedRegions.length === 0;
  const G3 = input.typeErrors <= input.baselineTypeErrors;
  const G4 = dL > 0;
  const admissible = G1 && G1prime && G3 && G4;

  const W = input.weights;
  const scaleL = input.scales?.sL ?? W.scaleL;
  const scaleCx = input.scales?.sCx ?? W.scaleCx;
  const scaleDup = input.scales?.sDup ?? W.scaleDup;
  const gain = W.dL * (dL / scaleL) + W.dCx * (dCx / scaleCx) + W.dDup * (dDup / scaleDup);

  const mfence = input.touchedFidelities.length ? Math.min(...input.touchedFidelities) : 1;
  const risk = 0.002 * input.diffsize + W.r3 * (1 - mfence);

  const loss = admissible ? risk - gain : Infinity;
  const keep = admissible && loss < 0;

  return {
    gain,
    risk,
    loss: Number.isFinite(loss) ? loss : null,
    keep,
    admissible,
    gates: { G1, G1prime, G3, G4 },
    dL,
    dCx,
    dDup,
    mfence,
  };
}

/** The human-readable verdict, prioritising the fence-gate message (matches legacy). */
export function verdictLabel(v: Verdict): "KEEP" | "REJECT (G1′ fence)" | "REJECT (no gain)" | "REJECT (gate)" {
  if (!v.gates.G1prime) return "REJECT (G1′ fence)";
  if (v.keep) return "KEEP";
  if (v.admissible) return "REJECT (no gain)";
  return "REJECT (gate)";
}

function assertSafeRef(ref: string): void {
  if (!ref || ref.startsWith("-") || ref.includes("\0")) throw new Error("unsafe git ref for scorer");
}

function assertResolvedSha(ref: string): void {
  if (!/^[0-9a-f]{40}$/u.test(ref)) throw new Error("resolved git SHA for scorer required");
}

function assertSafePathspec(value: string, label: "target" | "source"): void {
  if (
    !value ||
    isAbsolute(value) ||
    value.includes("\0") ||
    value.startsWith(":") ||
    value.split("/").includes("..")
  ) {
    throw new Error(`unsafe ${label} path for scorer`);
  }
}

export function scorerGitCommandPlan(input: {
  readonly worktree: string;
  readonly ref: string;
  readonly target: string;
  readonly srcDir: string;
}): ScorerGitCommandPlan {
  assertSafeRef(input.ref);
  assertSafePathspec(input.target, "target");
  assertSafePathspec(input.srcDir, "source");
  return {
    resolveBaseline: ["rev-parse", "--verify", "--end-of-options", input.ref],
    addWorktree: (ref) => {
      assertResolvedSha(ref);
      return ["worktree", "add", "-f", input.worktree, ref];
    },
    targetTree: (ref) => {
      assertResolvedSha(ref);
      return ["ls-tree", "-r", "-z", "--name-only", ref, "--", input.target];
    },
    changedSource: ["diff", "-z", "--name-only", "HEAD", "--", input.srcDir],
    addChangedSource: (paths) => ["add", "-A", "--", ...paths],
    cleanSource: ["clean", "-fdq", "--", input.srcDir],
  };
}

const lines = (values: readonly string[]): string => `${values.join("\n")}\n`;

function mkdirParent(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function readState(path: string): ScorerState {
  return JSON.parse(readFileSync(path, "utf8")) as ScorerState;
}

function writeState(path: string, state: ScorerState): void {
  mkdirParent(path);
  writeFileSync(path, JSON.stringify(state, null, 2));
}

async function testsPass(config: Config, env: NodeJS.ProcessEnv): Promise<boolean> {
  return (await runShellGroup(config.testCommand, { cwd: config.worktree, env, timeout: 300000 })).ok;
}

async function typeErrors(config: Config, env: NodeJS.ProcessEnv): Promise<number> {
  if (!config.typeCheckCommand) return 0;
  const result = await runShellGroup(config.typeCheckCommand, { cwd: config.worktree, env, timeout: 300000 });
  if (result.ok) return 0;
  return result.out.split("\n").filter((line) => /error TS/u.test(line)).length || 1;
}

function showAt(config: Config, ref: string, path: string): string | null {
  const result = tryRun("git", ["show", `${ref}:${path}`], { cwd: config.worktree });
  return result.ok ? result.out : null;
}

function sourceInDir(path: string, srcDir: string): boolean {
  return (srcDir === "." || path === srcDir || path.startsWith(`${srcDir}/`)) && isSourceFile(path);
}

const gitPathList = (output: string, srcDir: string): string[] =>
  output.split("\0").filter((value) => value.length > 0 && sourceInDir(value, srcDir));

function targetL(config: Config, ref: string, plan: ScorerGitCommandPlan): number {
  const files = gitPathList(run("git", plan.targetTree(ref), { cwd: config.worktree }), config.srcDir);
  const map: Files = Object.fromEntries(
    files.flatMap((file) => {
      const text = showAt(config, ref, file);
      return text == null ? [] : [[file, text]];
    }),
  );
  return measure(map).L;
}

function changedSource(config: Config, plan: ScorerGitCommandPlan): string[] {
  return gitPathList(run("git", plan.changedSource, { cwd: config.worktree }), config.srcDir);
}

function changedMeasurement(config: Config, changed: readonly string[], ref: "HEAD" | "worktree"): Measurement {
  const map: Files = Object.fromEntries(
    changed.map((file) => {
      if (ref === "HEAD") return [file, showAt(config, "HEAD", file) ?? ""];
      return [file, existsSync(`${config.worktree}/${file}`) ? readFileSync(`${config.worktree}/${file}`, "utf8") : ""];
    }),
  );
  return measure(map);
}

function diffSize(config: Config): number {
  const out = run("git", ["diff", "--shortstat", "HEAD", "--", config.srcDir], { cwd: config.worktree });
  return Number(out.match(/(\d+) insert/u)?.[1] ?? 0) + Number(out.match(/(\d+) delet/u)?.[1] ?? 0);
}

function formatFenceText(input: {
  readonly gates: Gates;
  readonly mfence: number;
  readonly touched: readonly string[];
  readonly blocked: readonly string[];
  readonly fenceStatus: ReturnType<typeof fenceArtifactStatus>;
  readonly fenceRegions: Record<string, { lo?: number } | undefined>;
}): string {
  if (input.gates.G1prime) return `clear (mfence=${(input.mfence * 100).toFixed(0)}%)`;
  if (input.fenceStatus.stale) return "STALE AUDIT (fail-closed)";
  if (input.fenceStatus.artifact && !input.fenceStatus.usable) return "INVALID AUDIT (fail-closed)";
  if (!input.fenceStatus.artifact) return "NO AUDIT (fail-closed)";
  return `blocked: ${input.blocked
    .map((region) => `${region}[lo=${((input.fenceRegions[region]?.lo ?? 0) * 100).toFixed(0)}%]`)
    .join(", ")}`;
}

async function scoreCandidate(
  config: Config,
  env: NodeJS.ProcessEnv,
  state: ScorerState,
  changed: readonly string[],
): Promise<{
  readonly verdict: Verdict;
  readonly touched: readonly string[];
  readonly blocked: readonly string[];
  readonly files: readonly string[];
  readonly fenceStatus: ReturnType<typeof fenceArtifactStatus>;
  readonly fenceRegions: Record<string, { admissible?: boolean; p?: number; lo?: number } | undefined>;
}> {
  const artifactConfig = { ...config, baseline: state.baselineSha };
  const fenceStatus = fenceArtifactStatus(artifactConfig);
  const fence = fenceStatus.usable ? fenceStatus.artifact : null;
  const fenceRegions = (fence?.regions ?? {}) as Record<string, { admissible?: boolean; p?: number; lo?: number } | undefined>;
  const touched = [...new Set(changed.map((path) => regionOf(path, config.srcDir)))];
  const blocked = touched.filter((region) => fenceRegions[region]?.admissible !== true);
  const calibration = calibrationArtifactStatus(artifactConfig);
  const scales = calibration.usable
    ? ((calibration.artifact?.scales ?? null) as CalibrationScales | null)
    : null;
  const verdict = decide({
    before: changedMeasurement(config, changed, "HEAD"),
    after: changedMeasurement(config, changed, "worktree"),
    testsPass: await testsPass(config, env),
    fenceUsable: fenceStatus.usable,
    blockedRegions: blocked,
    touchedFidelities: touched.map((region) => fenceRegions[region]?.p ?? 0),
    diffsize: diffSize(config),
    typeErrors: await typeErrors(config, env),
    baselineTypeErrors: state.baselineTsc,
    weights: config.weights,
    scales,
  });
  return {
    verdict,
    touched,
    blocked,
    files: changed.map((path) => path.replace(`${config.srcDir}/`, "")),
    fenceStatus,
    fenceRegions,
  };
}

function requireState(config: Config): ScorerState | RuntimeResult {
  if (existsSync(config.state)) return readState(config.state);
  return { exitCode: 1, stdout: "run `codenuke init` first\n", stderr: "" };
}

/** Run the manual immutable-scorer command lifecycle (RULE-044). */
export async function runScorerCommand(args: readonly string[], env: Env, cwd: string): Promise<RuntimeResult> {
  const cmd = args[0];
  const config = loadConfig(env, cwd);
  const runEnv = env as NodeJS.ProcessEnv;
  const plan = scorerGitCommandPlan({
    worktree: config.worktree,
    ref: config.baseline,
    target: config.target,
    srcDir: config.srcDir,
  });

  if (cmd === "init") {
    const baselineSha = run("git", plan.resolveBaseline, { cwd: config.repo }).trim();
    const out: string[] = [];
    removeWorktree(config.repo, config.worktree);
    run("git", plan.addWorktree(baselineSha), { cwd: config.repo, env });
    linkWorktreeNodeModules(config.repo, config.worktree);
    out.push(`verifying baseline (test${config.typeCheckCommand ? " + typecheck" : ""})...`);
    const green = await testsPass(config, runEnv);
    const baselineTsc = await typeErrors(config, runEnv);
    if (!green) {
      out.push(`baseline tests RED (cmd: ${config.testCommand}) — abort`);
      removeWorktree(config.repo, config.worktree);
      return { exitCode: 1, stdout: lines(out), stderr: "" };
    }
    const startL = targetL(config, baselineSha, plan);
    writeState(config.state, { baselineSha, baselineTsc, startL, accepted: [], iter: 0 });
    out.push(`baseline GREEN ✓  typeErrors=${baselineTsc}  ${config.target} astNodes=${startL}`);
    out.push(`proposer edits ${config.worktree}/${config.target} to reduce code (preserve behavior), then 'score'.`);
    return { exitCode: 0, stdout: lines(out), stderr: "" };
  }

  if (cmd === "score") {
    const state = requireState(config);
    if ("exitCode" in state) return state;
    const changed = changedSource(config, plan);
    if (changed.length === 0) {
      return { exitCode: 0, stdout: "no candidate (working tree clean) — proposer must edit first.\n", stderr: "" };
    }
    const scored = await scoreCandidate(config, runEnv, state, changed);
    const v = scored.verdict;
    const y = (value: boolean): string => (value ? "✓" : "✗");
    const fenceTxt = formatFenceText({
      gates: v.gates,
      mfence: v.mfence,
      touched: scored.touched,
      blocked: scored.blocked,
      fenceStatus: scored.fenceStatus,
      fenceRegions: scored.fenceRegions,
    });
    const out = [
      "",
      `  candidate: ${scored.files.join(", ")}`,
      `  gates: G1 ${y(v.gates.G1)}  G1′ ${y(v.gates.G1prime)} (${fenceTxt})  G3 ${y(v.gates.G3)} (types ${await typeErrors(config, runEnv)}/${state.baselineTsc})  G4↓ ${y(v.gates.G4)}`,
      `  ΔAST=${v.dL} ΔCx=${v.dCx} ΔDup=${v.dDup}  gain=${v.gain.toFixed(3)} risk=${v.risk.toFixed(3)} loss=${v.loss == null ? "+Inf" : v.loss.toFixed(3)}`,
      `  VERDICT: ${verdictLabel(v)}`,
    ];
    if (args.includes("--json")) {
      out.push(
        `@@JSON@@${JSON.stringify({
          admissible: v.admissible,
          keep: v.keep,
          loss: v.loss,
          gain: v.gain,
          risk: v.risk,
          dL: v.dL,
          dCx: v.dCx,
          dDup: v.dDup,
          mfence: v.mfence,
          touched: scored.touched,
          blocked: scored.blocked,
          gates: v.gates,
          files: scored.files,
        })}`,
      );
    }
    return { exitCode: 0, stdout: lines(out), stderr: "" };
  }

  if (cmd === "accept") {
    const state = requireState(config);
    if ("exitCode" in state) return state;
    const changed = changedSource(config, plan);
    if (changed.length === 0) return { exitCode: 0, stdout: "nothing to accept.\n", stderr: "" };
    const scored = await scoreCandidate(config, runEnv, state, changed);
    if (!scored.verdict.keep) {
      return { exitCode: 1, stdout: `candidate not accepted: ${verdictLabel(scored.verdict)}\n`, stderr: "" };
    }
    run("git", plan.addChangedSource(changed), { cwd: config.worktree, env });
    run(
      "git",
      [
        "-c",
        "user.email=loop@codenuke",
        "-c",
        "user.name=codenuke",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-m",
        "reduce: accepted refactor",
      ],
      { cwd: config.worktree, env },
    );
    const commit = run("git", ["rev-parse", "--short", "HEAD"], { cwd: config.worktree, env }).trim();
    writeState(config.state, { ...state, iter: state.iter + 1, accepted: [...state.accepted, commit] });
    return { exitCode: 0, stdout: `accepted (iteration ${state.iter + 1}).\n`, stderr: "" };
  }

  if (cmd === "revert") {
    const state = requireState(config);
    if ("exitCode" in state) return state;
    tryRun("git", ["checkout", "--", config.srcDir], { cwd: config.worktree, env });
    tryRun("git", plan.cleanSource, { cwd: config.worktree, env });
    return { exitCode: 0, stdout: "candidate reverted.\n", stderr: "" };
  }

  if (cmd === "status") {
    const state = requireState(config);
    if ("exitCode" in state) return state;
    const headSha = run("git", ["rev-parse", "--verify", "HEAD"], { cwd: config.worktree }).trim();
    const now = targetL(config, headSha, plan);
    const cut = state.startL - now;
    return {
      exitCode: 0,
      stdout: lines([
        `iterations=${state.iter} accepted=[${state.accepted.join(", ")}]`,
        `${config.target} astNodes: ${state.startL} -> ${now}  (cumulative reduction ${cut}, ${state.startL ? ((cut / state.startL) * 100).toFixed(1) : "0"}%)`,
      ]),
      stderr: "",
    };
  }

  if (cmd === "cleanup") {
    try {
      rmSync(config.state);
    } catch {
      /* already absent */
    }
    removeWorktree(config.repo, config.worktree);
    return { exitCode: 0, stdout: "worktree removed.\n", stderr: "" };
  }

  return { exitCode: 0, stdout: "usage: scorer.mjs init|score [--json]|accept|revert|status|cleanup\n", stderr: "" };
}
