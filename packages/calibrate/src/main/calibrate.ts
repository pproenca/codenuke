/**
 * Per-repo value-scale calibration math. Migrated from the pure core of
 * `legacy/codenuke/loop/calibrate.mjs` (which is a CLI script with no exports —
 * its git-history walk is engine-level orchestration). These functions derive the
 * z-score denominators (sL/sCx/sDup) from the magnitudes of past commit deltas.
 *
 * @see analysis/codenuke/BUSINESS_RULES.md — RULE-010
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { DEFAULT_CALIBRATION_SCALES, MIN_CALIBRATION_COMMITS } from "@codenuke/artifacts";
import { loadConfig } from "@codenuke/config";
import { run, tryRun } from "@codenuke/exec";
import type { Measurement } from "@codenuke/measure";
import { measure } from "@codenuke/measure";

/** Median of a numeric list (0 for empty; mean of the two middle values for even length). */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Median of the strictly-positive values, falling back when there are none. */
export function positiveScale(values: readonly number[], fallback: number): number {
  const scale = median(values.filter((value) => value > 0));
  return scale > 0 ? scale : fallback;
}

/** Absolute per-axis metric change between two measurements. */
export interface CommitDelta {
  readonly dL: number;
  readonly dCx: number;
  readonly dDup: number;
}

export function deltaOf(before: Measurement, after: Measurement): CommitDelta {
  return {
    dL: Math.abs(after.L - before.L),
    dCx: Math.abs(after.complexity - before.complexity),
    dDup: Math.abs(after.dupMass - before.dupMass),
  };
}

export interface CalibrationScales {
  readonly sL: number;
  readonly sCx: number;
  readonly sDup: number;
}

export interface DerivedCalibration {
  readonly scales: CalibrationScales;
  readonly enoughHistory: boolean;
  readonly commitsSampled: number;
}

/**
 * Derive value scales from commit deltas (RULE-010): keep only commits with any
 * positive delta; if at least MIN_CALIBRATION_COMMITS qualify, each scale is the
 * median of that axis's positive deltas, else the defaults are used.
 */
export function deriveScales(deltas: readonly CommitDelta[]): DerivedCalibration {
  const sampled = deltas.filter((d) => d.dL > 0 || d.dCx > 0 || d.dDup > 0);
  const enoughHistory = sampled.length >= MIN_CALIBRATION_COMMITS;
  const scales: CalibrationScales = enoughHistory
    ? {
        sL: positiveScale(sampled.map((d) => d.dL), DEFAULT_CALIBRATION_SCALES.sL),
        sCx: positiveScale(sampled.map((d) => d.dCx), DEFAULT_CALIBRATION_SCALES.sCx),
        sDup: positiveScale(sampled.map((d) => d.dDup), DEFAULT_CALIBRATION_SCALES.sDup),
      }
    : { ...DEFAULT_CALIBRATION_SCALES };
  return { scales, enoughHistory, commitsSampled: sampled.length };
}

type Env = Record<string, string | undefined>;

export interface CalibrationArtifact {
  readonly schemaVersion: 1;
  readonly baseline: string;
  readonly baselineSha: string;
  readonly generatedAt: string;
  readonly commitsSampled: number;
  readonly scales: CalibrationScales;
}

export interface CalibrateCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const isSourceFile = (path: string): boolean =>
  /\.(ts|tsx|js|jsx|mjs|cjs)$/u.test(path) && !/\.d\.ts$/u.test(path) && !/\.(test|spec|accept)\./u.test(path);

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/~^-]*$/u;
const SAFE_PATH = /^[A-Za-z0-9._/-]+$/u;

function assertSafeBaseline(ref: string): string {
  if (!SAFE_REF.test(ref) || ref.includes("..") || ref.endsWith(".lock")) {
    throw new Error(`unsafe git ref for calibration: ${ref}`);
  }
  return ref;
}

function assertSafeSourcePath(path: string): string {
  if (
    path === "" ||
    path.startsWith("/") ||
    path.startsWith("-") ||
    path.split("/").includes("..") ||
    !SAFE_PATH.test(path)
  ) {
    throw new Error(`unsafe source path for calibration: ${path}`);
  }
  return path;
}

/** Legacy source-dir to git pathspec mapping for calibration history scans. */
export const sourcePath = (srcDir: string): string => (srcDir === "." ? "." : srcDir);

/** Parse `git ls-tree -z --name-only` output and keep only non-test source files. */
export const filesFromGitLsTree = (output: string): string[] =>
  output.split("\0").filter((path) => path.length > 0 && isSourceFile(path));

export function snapshotFromGitOutput(input: {
  readonly ref: string;
  readonly treeOutput: string;
  readonly readFileAtRef: (ref: string, path: string) => string | null;
}): Record<string, string> {
  const files: Record<string, string> = {};
  for (const path of filesFromGitLsTree(input.treeOutput)) {
    const content = input.readFileAtRef(input.ref, path);
    if (content !== null) files[path] = content;
  }
  return files;
}

export function firstParentCommitPairs(input: {
  readonly revListOutput: string;
  readonly parentLineFor: (commit: string) => string;
}): readonly { readonly parent: string; readonly commit: string }[] {
  return input.revListOutput
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((commit) => {
      const parent = input.parentLineFor(commit).trim().split(/\s+/u)[1];
      return parent ? [{ parent, commit }] : [];
    });
}

export function createCalibrationArtifact(input: {
  readonly baseline: string;
  readonly baselineSha: string;
  readonly generatedAt: string;
  readonly commitsSampled: number;
  readonly scales: CalibrationScales;
}): CalibrationArtifact {
  return {
    schemaVersion: 1,
    baseline: input.baseline,
    baselineSha: input.baselineSha,
    generatedAt: input.generatedAt,
    commitsSampled: input.commitsSampled,
    scales: input.scales,
  };
}

/** Arg-vector plan for the git commands the runtime executes. */
export function calibrationGitCommandPlan(input: {
  readonly baseline: string;
  readonly srcDir: string;
}): {
  readonly resolveBaseline: readonly string[];
  readonly listCommits: readonly string[];
  readonly filesAt: (ref: string) => readonly string[];
  readonly showAt: (ref: string, path: string) => readonly string[];
  readonly parentLineFor: (commit: string) => readonly string[];
} {
  const baseline = assertSafeBaseline(input.baseline);
  const path = assertSafeSourcePath(sourcePath(input.srcDir));
  return {
    resolveBaseline: ["rev-parse", "--verify", "--end-of-options", baseline],
    listCommits: ["rev-list", "--first-parent", "--max-count=80", "--end-of-options", baseline, "--", path],
    filesAt: (ref) => ["ls-tree", "-r", "-z", "--name-only", ref, "--", path],
    showAt: (ref, filePath) => ["show", `${ref}:${filePath}`],
    parentLineFor: (commit) => ["rev-list", "--parents", "-n", "1", commit],
  };
}

function readFileAtRef(repo: string, ref: string, path: string): string | null {
  const result = tryRun("git", calibrationGitCommandPlan({ baseline: ref, srcDir: "." }).showAt(ref, path), {
    cwd: repo,
  });
  return result.ok ? result.out : null;
}

export async function runCalibrateCommand(
  _args: readonly string[] = [],
  env: Env = process.env,
  cwd = process.cwd(),
): Promise<CalibrateCommandResult> {
  try {
    const config = loadConfig(env, cwd);
    const plan = calibrationGitCommandPlan({ baseline: config.baseline, srcDir: config.srcDir });
    const revListOutput = run("git", plan.listCommits, { cwd: config.repo });
    const pairs = firstParentCommitPairs({
      revListOutput,
      parentLineFor: (commit) => run("git", plan.parentLineFor(commit), { cwd: config.repo }),
    });

    const deltas: CommitDelta[] = [];
    for (const { parent, commit } of pairs) {
      const parentFiles = run("git", plan.filesAt(parent), { cwd: config.repo });
      const commitFiles = run("git", plan.filesAt(commit), { cwd: config.repo });
      const before = measure(
        snapshotFromGitOutput({
          ref: parent,
          treeOutput: parentFiles,
          readFileAtRef: (ref, path) => readFileAtRef(config.repo, ref, path),
        }),
      );
      const after = measure(
        snapshotFromGitOutput({
          ref: commit,
          treeOutput: commitFiles,
          readFileAtRef: (ref, path) => readFileAtRef(config.repo, ref, path),
        }),
      );
      const delta = deltaOf(before, after);
      if (delta.dL > 0 || delta.dCx > 0 || delta.dDup > 0) deltas.push(delta);
    }

    const derived = deriveScales(deltas);
    const baselineSha = run("git", plan.resolveBaseline, { cwd: config.repo }).trim();
    const artifact = createCalibrationArtifact({
      baseline: config.baseline,
      baselineSha,
      generatedAt: new Date().toISOString(),
      commitsSampled: derived.commitsSampled,
      scales: derived.scales,
    });
    mkdirSync(`${config.repo}/.codenuke`, { recursive: true });
    writeFileSync(`${config.repo}/.codenuke/calibration.json`, JSON.stringify(artifact, null, 2));

    return {
      exitCode: 0,
      stdout: `calibration @ ${config.baseline} commits=${derived.commitsSampled}${derived.enoughHistory ? "" : " fallback=defaults"} sL=${derived.scales.sL} sCx=${derived.scales.sCx} sDup=${derived.scales.sDup}\n`,
      stderr: "",
    };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${error instanceof Error ? error.message : String(error)}\n`,
    };
  }
}
