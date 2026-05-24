import { stripSourcePrefix } from "@codenuke/config";

/**
 * Orchestration-layer pure logic, migrated from the decision points of
 * `loop/autoloop.mjs` (region/move selection), `loop/doctor.mjs` (readiness gaps),
 * and `bin/codenuke.mjs` (command dispatch). The surrounding loop — spawning the
 * proposer, scorer and fence as subprocesses, managing worktrees — is engine-level
 * orchestration that composes the already-migrated slices.
 *
 * @see analysis/codenuke/BUSINESS_RULES.md — RULE-039 (move selection), RULE-032 (doctor)
 */

interface FenceLike {
  readonly regions: Record<string, { admissible?: boolean; lo?: number } | undefined>;
}

const LONG_RUN_ITERATIONS = 5;
const RESULT_COLUMNS = ["iter", "commit", "dAST", "dCx", "behavior", "mfence", "loss", "status", "description"] as const;

/**
 * Pick the region to work on (RULE-039): prefer fence-blocked regions, the one
 * closest to clearing the bar (highest `lo`) first; else any admissible region;
 * else the default region. (Raising is prioritised over reducing.)
 */
export function chooseRegion(fence: FenceLike, candidates: readonly string[], defaultRegion: string): string {
  const blocked = [...candidates]
    .filter((key) => fence.regions[key]?.admissible !== true)
    .toSorted((a, b) => (fence.regions[b]?.lo ?? 0) - (fence.regions[a]?.lo ?? 0));
  return (
    blocked[0] ??
    candidates.find((key) => fence.regions[key]?.admissible === true) ??
    defaultRegion
  );
}

/** A well-fenced region is reduced; an under-fenced one is raised first (RULE-039). */
export const selectMode = (region: { admissible?: boolean } | undefined): "reduce" | "raise" =>
  region?.admissible === true ? "reduce" : "raise";

function targetRegionFilter(target: string, srcDir: string): string | null {
  const normalizedTarget = target.replace(/\/+$/u, "");
  const normalizedSrc = srcDir.replace(/\/+$/u, "");
  if (normalizedTarget === normalizedSrc || normalizedTarget === "." || normalizedTarget === `${normalizedSrc}`) {
    return null;
  }
  const rel = stripSourcePrefix(normalizedTarget, normalizedSrc);
  return rel ? rel.split("/")[0] ?? null : null;
}

/** In-scope fence regions after applying the configured target filter (RULE-039). */
export function inScopeRegions(
  fence: FenceLike,
  detectedRegions: readonly string[],
  target: string,
  srcDir: string,
): string[] {
  const fenced = fence.regions ?? {};
  const filter = targetRegionFilter(target, srcDir);
  const detected = detectedRegions.filter((regionKey) => fenced[regionKey]);
  if (filter) return detected.filter((regionKey) => regionKey === filter);
  return detected.length > 0 ? detected : Object.keys(fenced);
}

/** Resolved status of a periodic artifact for the readiness check. */
export interface ArtifactReadiness {
  readonly present: boolean;
  readonly stale: boolean;
  readonly usable: boolean;
}

export interface ReadinessChecks {
  readonly baseline: string;
  readonly baselineExists: boolean;
  readonly baselineGreen: boolean;
  readonly typecheckOk: boolean;
  readonly hasRegions: boolean;
  readonly fence: ArtifactReadiness;
  readonly calibration: ArtifactReadiness;
  readonly proposerAvailable: boolean;
}

/** Assemble the doctor readiness-gap list, in the legacy order (RULE-032). */
export function readinessGaps(c: ReadinessChecks): string[] {
  const gaps: string[] = [];
  if (!c.baselineExists) gaps.push(`baseline ${c.baseline} not found`);
  if (!c.baselineGreen) gaps.push("baseline test command is not green");
  if (!c.typecheckOk) gaps.push("typecheck command is not green");
  if (!c.hasRegions) gaps.push("no source regions detected");
  if (!c.fence.present) gaps.push("fence artifact missing");
  else if (c.fence.stale) gaps.push("fence artifact stale");
  else if (!c.fence.usable) gaps.push("fence artifact invalid");
  if (!c.calibration.present) gaps.push("calibration missing");
  else if (c.calibration.stale) gaps.push("calibration stale");
  else if (!c.calibration.usable) gaps.push("calibration invalid");
  if (!c.proposerAvailable) gaps.push("proposer unavailable");
  return gaps;
}

/** Doctor is ready (exit 0) iff there are no gaps; otherwise exit 2. */
export const isReady = (gaps: readonly string[]): boolean => gaps.length === 0;

/** Which engine module a CLI command routes to (the `bin/codenuke.mjs` dispatch table). */
export function commandTarget(command: string | undefined): { module: string; passCommand: boolean } | null {
  switch (command) {
    case undefined:
      return { module: "help", passCommand: false };
    case "--version":
    case "-v":
      return { module: "package-version", passCommand: false };
    case "fence":
      return { module: "fence", passCommand: false };
    case "run":
    case "loop":
      return { module: "autoloop", passCommand: false };
    case "changecost":
      return { module: "changecost", passCommand: false };
    case "validate-proxy":
      return { module: "value-proxy", passCommand: false };
    case "calibrate":
      return { module: "calibrate", passCommand: false };
    case "doctor":
      return { module: "doctor", passCommand: false };
    case "init":
    case "score":
    case "accept":
    case "revert":
    case "status":
    case "cleanup":
      return { module: "scorer", passCommand: true };
    default:
      return null;
  }
}

/** Legacy CLI help text, kept local to the dispatcher. */
export function cliHelpText(): string {
  return `codenuke loop — autonomous behavior-preserving code reduction

  Karpathy's autoresearch loop, applied to refactoring: an agent proposes a
  reduction, an immutable metric judges it, keep-if-genuinely-smaller-and-behavior-
  preserved, else revert. Runs in an isolated git worktree; your tree is untouched.

usage (run from your repo root):
  codenuke fence [cap=60] [seed=1337]   measure each region's behavior-fence fidelity
  codenuke run [iterations=5]           run the loop (propose → score → keep/revert)
  codenuke score [--json]               score the current worktree change
  codenuke changecost [ref]             evaluate change-cost on your benchmark (periodic)
  codenuke validate-proxy [json]         validate proxy-vs-changecost rank correlation
  codenuke calibrate                    derive per-repo value scales
  codenuke doctor                       report readiness or precise gaps
  codenuke init | accept | revert | status | cleanup

config: codenuke.loop.json at the repo root, or CN_* env. Auto-detects src dir,
test runner, typecheck, and source regions. See README. First run 'fence' so the
loop has a measured fence to gate on.`;
}

export interface DoctorReportInput {
  readonly repo: string;
  readonly baseline: string;
  readonly srcDir: string;
  readonly regions: readonly string[];
  readonly testCommand: string;
  readonly typeCheckCommand?: string | null;
  readonly checks: ReadinessChecks;
  readonly fenceArtifact: string;
  readonly calibrationArtifact: string;
}

/** Render the legacy doctor output lines (RULE-032). */
export function formatDoctorReport(input: DoctorReportInput): string[] {
  const { checks } = input;
  const gaps = readinessGaps(checks);
  const fenceState = checks.fence.usable
    ? "present"
    : checks.fence.stale
      ? "stale"
      : checks.fence.present
        ? "invalid"
        : "missing";
  const calibrationState = checks.calibration.usable
    ? "present"
    : checks.calibration.stale
      ? "stale"
      : checks.calibration.present
        ? "invalid"
        : "missing";
  const lines = [
    "doctor",
    `repo: ${input.repo}`,
    `baseline: ${checks.baselineGreen ? "green" : "not-ready"} (${input.baseline})`,
    `srcDir: ${input.srcDir}`,
    `regions: ${input.regions.length > 0 ? input.regions.join(",") : "none"}`,
    `test: ${checks.baselineGreen ? "green" : "not-ready"} (${input.testCommand})`,
    `typecheck: ${
      input.typeCheckCommand
        ? `${checks.typecheckOk ? "green" : "not-ready"} (${input.typeCheckCommand})`
        : "skipped"
    }`,
    `fence: ${fenceState} (${input.fenceArtifact})`,
    `calibration: ${calibrationState} (${input.calibrationArtifact})`,
    `proposer: ${checks.proposerAvailable ? "available" : "missing"}`,
  ];
  if (gaps.length > 0) lines.push("not ready:", ...gaps.map((gap) => `- ${gap}`));
  else lines.push("ready");
  return lines;
}

export interface StartupArtifactReadiness extends ArtifactReadiness {
  readonly present: boolean;
}

export interface RunStartupInput {
  readonly fence: StartupArtifactReadiness;
  readonly calibration: StartupArtifactReadiness;
  readonly valueProxy: StartupArtifactReadiness;
  readonly inScopeRegionCount: number;
  readonly baseline: string;
  readonly repo: string;
  readonly fenceArtifact: string;
  readonly target: string;
  readonly iterations?: number;
}

export const shouldRequireValueProxyValidation = (iterations: number): boolean =>
  iterations > LONG_RUN_ITERATIONS;

/** First startup failure, in legacy fail-closed order (RULE-030/031). */
export function runStartupFailure(input: RunStartupInput): { exitCode: 1; message: string } | null {
  if (!input.fence.present) {
    return {
      exitCode: 1,
      message: `fence artifact missing or invalid at ${input.fenceArtifact}; run \`codenuke fence\` first, then \`codenuke doctor\`.`,
    };
  }
  if (!input.fence.usable) {
    const label = input.fence.stale ? "stale" : "invalid";
    return {
      exitCode: 1,
      message: `fence artifact is ${label} for baseline ${input.baseline}; run \`codenuke fence\` first, then \`codenuke doctor\`.`,
    };
  }
  if (input.inScopeRegionCount === 0) {
    return {
      exitCode: 1,
      message: `fence artifact has no measured in-scope regions for target ${input.target}; run \`codenuke fence\` for the detected regions, then \`codenuke doctor\`.`,
    };
  }
  if (!input.calibration.present) {
    return {
      exitCode: 1,
      message: `calibration artifact missing at ${input.repo}/.codenuke/calibration.json; run \`codenuke calibrate\` first, then \`codenuke doctor\`.`,
    };
  }
  if (!input.calibration.usable) {
    const label = input.calibration.stale ? "stale" : "invalid";
    return {
      exitCode: 1,
      message: `calibration artifact is ${label} for baseline ${input.baseline}; run \`codenuke calibrate\` first, then \`codenuke doctor\`.`,
    };
  }
  if (!shouldRequireValueProxyValidation(input.iterations ?? LONG_RUN_ITERATIONS)) return null;
  if (!input.valueProxy.present) {
    return {
      exitCode: 1,
      message: `value proxy validation missing at ${input.repo}/.codenuke/value-proxy-validation.json; run \`codenuke changecost\` and \`codenuke validate-proxy\` before long unattended runs.`,
    };
  }
  if (!input.valueProxy.usable) {
    return {
      exitCode: 1,
      message: "value proxy validation is not passing; run `codenuke changecost` and `codenuke validate-proxy` before long unattended runs.",
    };
  }
  return null;
}

const isSourceFile = (path: string): boolean =>
  /\.(ts|tsx|js|jsx|mjs|cjs)$/u.test(path) && !path.endsWith(".d.ts") && !/\.(test|spec|accept)\./u.test(path);

const isUnderSourceDir = (path: string, srcDir: string): boolean =>
  srcDir === "." || path === srcDir || path.startsWith(`${srcDir}/`);

const ROOT_TOOLING_DIRS = new Set([
  ".github",
  "benchmarks",
  "benchmark",
  "codenuke.benchmark",
  "doc",
  "docs",
  "script",
  "scripts",
  "test",
  "tests",
]);

const isRootToolingPath = (path: string): boolean => {
  const parts = path.split("/");
  const first = parts[0] ?? "";
  const name = parts.at(-1) ?? "";
  return ROOT_TOOLING_DIRS.has(first) || /\.config\.[cm]?[jt]s$/u.test(name) || /^config\.[cm]?[jt]s$/u.test(name);
};

/** Reduce moves may only edit source under the configured source dir (RULE-025). */
export const isAllowedReducePath = (path: string, srcDir: string): boolean =>
  isUnderSourceDir(path, srcDir) && isSourceFile(path) && (srcDir !== "." || !isRootToolingPath(path));

const underTestRoot = (path: string, root: string): boolean =>
  root === "." || path === root || path.startsWith(`${root}/`);

/** Raise moves may only edit discovered `.test`/`.spec` files (RULE-026). */
export const isAllowedRaisePath = (path: string, testRoots: readonly string[]): boolean =>
  /\.(test|spec)\.[jt]sx?$/u.test(path) && testRoots.some((root) => underTestRoot(path, root));

export const reducePrompt = (regionTarget: string, programText: string): string =>
  `${programText}\n\n---\nYou are running now. Target region: ${regionTarget}. Make exactly ONE behavior-preserving reduction in a single file under ${regionTarget}, then stop. Do not run commands; just edit.`;

export interface SurvivorPromptSpec {
  readonly rel: string;
  readonly line: number | string;
  readonly op: string;
}

export function raisePrompt(
  regionTarget: string,
  testLayoutDescription: string,
  specs: readonly SurvivorPromptSpec[],
): string {
  const shown = specs
    .slice(0, 12)
    .map((spec) => `  - ${spec.rel} line ${spec.line}: operator \`${spec.op}\` is undetected by any test`)
    .join("\n");
  return `You are the fence-raising proposer. The region ${regionTarget} is fence-BLOCKED: its tests miss some behavior changes (mutation survivors). ADD characterization tests where this repo's test command will discover them: ${testLayoutDescription}. Do NOT change any source — only add/extend tests.\n\nSurviving mutations:\n${shown}\n\nRead the source, understand what each operator decides, and assert the real current outputs for inputs exercising both sides. Make the tests pass against current code. Then stop. Do not run commands; just write tests.`;
}

const compactTail = (output: string): string => output.replace(/\s+/gu, " ").trim().slice(-200);

export function proposerFailure(input: {
  readonly timedOut: boolean;
  readonly out: string;
  readonly timeoutMs: number;
}): { status: "crash-timeout" | "crash-budget" | "crash"; description: string } {
  if (input.timedOut) {
    return { status: "crash-timeout", description: `proposer timeout after ${input.timeoutMs}ms` };
  }
  if (/Reached maximum budget|maximum budget/iu.test(input.out)) {
    return { status: "crash-budget", description: `proposer budget exhausted: ${compactTail(input.out)}` };
  }
  return { status: "crash", description: `proposer error: ${compactTail(input.out)}` };
}

export const formatResultsHeader = (): string => RESULT_COLUMNS.join("\t");

export interface ResultRow {
  readonly iter: number;
  readonly commit: string;
  readonly dAST: number;
  readonly dCx: number;
  readonly behavior: boolean | string;
  readonly mfence: number | string;
  readonly loss: number | string;
  readonly status: string;
  readonly description: string;
}

export function formatResultRow(row: ResultRow): string {
  return [
    row.iter,
    row.commit,
    row.dAST,
    row.dCx,
    row.behavior,
    row.mfence,
    row.loss,
    row.status,
    row.description,
  ].join("\t");
}
