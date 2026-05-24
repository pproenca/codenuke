/**
 * Runtime adapters for the modernized codenuke engine.
 *
 * These functions compose the migrated typed slices to provide the side-effectful
 * doctor and reduce-loop paths from `loop/doctor.mjs` and `loop/autoloop.mjs`.
 *
 * @see analysis/codenuke/BUSINESS_RULES.md — RULE-025, RULE-030..032,
 *      RULE-038..040, RULE-046..047
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { relative } from "node:path";
import {
  calibrationArtifactStatus,
  fenceArtifactStatus,
  valueProxyValidationStatus,
  type ArtifactStatus,
  type ValueProxyStatus,
} from "@codenuke/artifacts";
import { loadConfig, regionOf, slug, type Config } from "@codenuke/config";
import { commandAvailable, run, tryRun } from "@codenuke/exec";
import { runFenceCommand, textReporter } from "@codenuke/fence/runtime";
import { measure, type Files, type Measurement } from "@codenuke/measure";
import { decide, type CalibrationScales, type Verdict } from "@codenuke/scorer";
import {
  isHiddenBenchmarkDeletion,
  isNodeModulesPath,
  linkWorktreeNodeModules,
  removeWorktree,
  resetAndCleanWorktree,
  runShellGroup,
  unlinkWorktreeNodeModules,
  type ProgressReporter,
} from "@codenuke/substrate";
import {
  chooseRegion,
  formatDoctorReport,
  formatResultRow,
  formatResultsHeader,
  inScopeRegions,
  isAllowedRaisePath,
  isAllowedReducePath,
  proposerFailure,
  raisePrompt,
  reducePrompt,
  runStartupFailure,
  selectMode,
} from "./orchestrator.js";
import { selectProposerAdapter, type ProposerMode, type ProposerResult } from "./proposer.js";

type Env = Record<string, string | undefined>;

interface CommandOptions {
  readonly reporter?: ProgressReporter;
}

interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr?: string;
}

interface EngineState {
  readonly baselineSha: string;
  readonly baselineTsc: number;
  readonly startL: number;
  readonly accepted: string[];
  readonly iter: number;
}

interface ScoreResult extends Verdict {
  readonly files: string[];
  readonly touched: string[];
  readonly blocked: string[];
}

interface FenceRegionRuntime {
  readonly admissible?: boolean;
  readonly lo?: number;
  readonly p?: number;
  readonly survivorSpecs?: readonly {
    readonly rel?: string;
    readonly start?: number;
    readonly line?: number | string;
    readonly op?: string;
  }[];
}

const COMMAND_TIMEOUT = 300000;

const lines = (values: readonly string[]): string => `${values.join("\n")}\n`;

function recordLine(out: string[], reporter: ProgressReporter | undefined, line = ""): void {
  out.push(line);
  reporter?.emit(line);
}

const shellOk = async (
  cmd: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeout = COMMAND_TIMEOUT,
  reporter?: ProgressReporter,
  label = "shell command",
): Promise<boolean> =>
  (
    await runShellGroup(cmd, {
      cwd,
      env,
      timeout,
      progress: reporter,
      progressLabel: label,
    })
  ).ok;

function isResolvedSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/u.test(value);
}

function readState(path: string): EngineState {
  const state = JSON.parse(readFileSync(path, "utf8")) as Partial<EngineState>;
  const { baselineSha, baselineTsc, startL, accepted, iter } = state;
  if (
    !isResolvedSha(baselineSha) ||
    typeof baselineTsc !== "number" ||
    !Number.isInteger(baselineTsc) ||
    typeof startL !== "number" ||
    !Number.isInteger(startL) ||
    !Array.isArray(accepted) ||
    !accepted.every((commit) => typeof commit === "string") ||
    typeof iter !== "number" ||
    !Number.isInteger(iter)
  ) {
    throw new Error("invalid autoloop state: missing or malformed baselineSha");
  }
  return {
    baselineSha,
    baselineTsc,
    startL,
    accepted,
    iter,
  };
}
const writeState = (path: string, state: EngineState): void =>
  writeFileSync(path, JSON.stringify(state, null, 2));

const resolveBaselineSha = (config: Config, env: NodeJS.ProcessEnv): string =>
  run("git", ["rev-parse", "--verify", "--end-of-options", `${config.baseline}^{commit}`], {
    cwd: config.repo,
    env,
  }).trim();

function assertStateBaselineSha(config: Config, env: NodeJS.ProcessEnv, state: EngineState): void {
  try {
    const resolved = run(
      "git",
      ["rev-parse", "--verify", "--end-of-options", `${state.baselineSha}^{commit}`],
      {
        cwd: config.repo,
        env,
      },
    ).trim();
    if (resolved !== state.baselineSha) {
      throw new Error("baselineSha resolved to a different commit");
    }
  } catch (cause) {
    throw new Error("invalid autoloop state: baselineSha does not resolve to a repository commit", {
      cause,
    });
  }
}

const artifactConfig = (config: Config, state: EngineState | null): Config =>
  state ? { ...config, baseline: state.baselineSha } : config;

const mkdirParent = (path: string): void => {
  const parent = path.split("/").slice(0, -1).join("/");
  if (parent) {
    mkdirSync(parent, { recursive: true });
  }
};

function artifactReadiness(status: ArtifactStatus): {
  present: boolean;
  stale: boolean;
  usable: boolean;
} {
  return { present: status.artifact != null, stale: status.stale, usable: status.usable };
}

function valueProxyReadiness(status: ValueProxyStatus): {
  present: boolean;
  stale: boolean;
  usable: boolean;
} {
  return { present: status.artifact != null, stale: false, usable: status.usable };
}

async function isolatedChecks(
  config: Config,
  env: NodeJS.ProcessEnv,
  reporter?: ProgressReporter,
): Promise<{
  baselineExists: boolean;
  baselineGreen: boolean;
  typecheckOk: boolean;
}> {
  const worktree = `${config.worktree}-doctor-${slug(Date.now())}`;
  const resolved = tryRun("git", ["rev-parse", "--verify", "--end-of-options", config.baseline], {
    cwd: config.repo,
    env,
  });
  if (!resolved.ok) {
    return { baselineExists: false, baselineGreen: false, typecheckOk: false };
  }
  const baselineSha = resolved.out.trim();
  try {
    reporter?.emit(`doctor: checking baseline worktree ${baselineSha.slice(0, 12)}`);
    removeWorktree(config.repo, worktree);
    run("git", ["worktree", "add", "-f", worktree, baselineSha], { cwd: config.repo, env });
    linkWorktreeNodeModules(config.repo, worktree);
    reporter?.emit("doctor: running test command");
    const baselineGreen = await shellOk(
      config.testCommand,
      worktree,
      env,
      COMMAND_TIMEOUT,
      reporter,
      "test command",
    );
    reporter?.emit("doctor: running typecheck command");
    const typecheckOk = config.typeCheckCommand
      ? await shellOk(
          config.typeCheckCommand,
          worktree,
          env,
          COMMAND_TIMEOUT,
          reporter,
          "typecheck command",
        )
      : true;
    return { baselineExists: true, baselineGreen, typecheckOk };
  } catch {
    return { baselineExists: true, baselineGreen: false, typecheckOk: false };
  } finally {
    removeWorktree(config.repo, worktree);
  }
}

/** Run the modernized doctor preflight and return printable output. */
export async function runDoctor(
  env: Env = process.env,
  cwd = process.cwd(),
  options: CommandOptions = {},
): Promise<CommandResult> {
  options.reporter?.emit("doctor: resolving config");
  const config = loadConfig(env, cwd);
  const isolated = await isolatedChecks(config, env as NodeJS.ProcessEnv, options.reporter);
  options.reporter?.emit("doctor: checking artifacts and proposer");
  const fenceStatus = fenceArtifactStatus(config);
  const calibrationStatus = calibrationArtifactStatus(config);
  const proposerProvider = selectProposerAdapter(env as NodeJS.ProcessEnv).provider;
  const proposerAvailable =
    proposerProvider === "shell" ||
    proposerProvider === "codex-sdk" ||
    commandAvailable("codex", { cwd: config.repo, env, timeout: 5000 });
  const checks = {
    baseline: config.baseline,
    ...isolated,
    hasRegions: config.regions.length > 0,
    fence: artifactReadiness(fenceStatus),
    calibration: artifactReadiness(calibrationStatus),
    proposerAvailable,
  };
  const report = formatDoctorReport({
    repo: config.repo,
    baseline: config.baseline,
    srcDir: config.srcDir,
    regions: config.regions,
    testCommand: config.testCommand,
    typeCheckCommand: config.typeCheckCommand,
    checks,
    fenceArtifact: config.fenceArtifact,
    calibrationArtifact: `${config.repo}/.codenuke/calibration.json`,
  });
  for (const line of report) {
    options.reporter?.emit(line);
  }
  return {
    exitCode: report.includes("ready") && !report.includes("not ready:") ? 0 : 2,
    stdout: lines(report),
  };
}

function targetL(config: Config, ref: string): number {
  const files = run("git", ["ls-tree", "-r", "-z", "--name-only", ref, "--", config.target], {
    cwd: config.worktree,
  })
    .split("\0")
    .filter((value) => value.length > 0 && isAllowedReducePath(value, config.srcDir));
  const map: Files = Object.fromEntries(
    files.flatMap((file) => {
      const shown = tryRun("git", ["show", `${ref}:${file}`], { cwd: config.worktree });
      return shown.ok ? [[file, shown.out]] : [];
    }),
  );
  return measure(map).L;
}

async function typeErrors(
  config: Config,
  env: NodeJS.ProcessEnv,
  reporter?: ProgressReporter,
): Promise<number> {
  if (!config.typeCheckCommand) {
    return 0;
  }
  const result = await runShellGroup(config.typeCheckCommand, {
    cwd: config.worktree,
    env,
    timeout: COMMAND_TIMEOUT,
    progress: reporter,
    progressLabel: "typecheck command",
  });
  if (result.ok) {
    return 0;
  }
  return result.out.split("\n").filter((line) => /error TS/u.test(line)).length || 1;
}

async function initializeWorktree(
  config: Config,
  env: NodeJS.ProcessEnv,
  out: string[],
  baselineSha: string,
  reporter?: ProgressReporter,
): Promise<void> {
  if (existsSync(config.state)) {
    return;
  }
  recordLine(out, reporter, `initializing worktree @ ${config.baseline}...`);
  removeWorktree(config.repo, config.worktree);
  run("git", ["worktree", "add", "-f", config.worktree, baselineSha], { cwd: config.repo, env });
  linkWorktreeNodeModules(config.repo, config.worktree);
  const green = await shellOk(
    config.testCommand,
    config.worktree,
    env,
    COMMAND_TIMEOUT,
    reporter,
    "test command",
  );
  const baselineTsc = await typeErrors(config, env, reporter);
  if (!green) {
    removeWorktree(config.repo, config.worktree);
    throw new Error(`baseline tests RED (cmd: ${config.testCommand}) — abort`);
  }
  const startL = targetL(config, baselineSha);
  writeState(config.state, { baselineSha, baselineTsc, startL, accepted: [], iter: 0 });
  tryRun("git", ["checkout", "-B", config.branch], { cwd: config.worktree, env });
  recordLine(out, reporter, `trajectory branch: ${config.branch}`);
}

function changedSource(config: Config): string[] {
  return run("git", ["diff", "-z", "--name-only", "HEAD", "--", config.srcDir], {
    cwd: config.worktree,
  })
    .split("\0")
    .filter((value) => value.length > 0 && isAllowedReducePath(value, config.srcDir));
}

function changedMeasurement(
  config: Config,
  changed: readonly string[],
  ref: "HEAD" | "worktree",
): Measurement {
  const map: Files = Object.fromEntries(
    changed.map((file) => {
      if (ref === "HEAD") {
        const shown = tryRun("git", ["show", `HEAD:${file}`], { cwd: config.worktree });
        return [file, shown.ok ? shown.out : ""];
      }
      return [
        file,
        existsSync(`${config.worktree}/${file}`)
          ? readFileSync(`${config.worktree}/${file}`, "utf8")
          : "",
      ];
    }),
  );
  return measure(map);
}

function diffSize(config: Config): number {
  const out = run("git", ["diff", "--shortstat", "HEAD", "--", config.srcDir], {
    cwd: config.worktree,
  });
  return Number(out.match(/(\d+) insert/u)?.[1] ?? 0) + Number(out.match(/(\d+) delet/u)?.[1] ?? 0);
}

async function scoreCandidate(
  config: Config,
  env: NodeJS.ProcessEnv,
  state: EngineState,
  reporter?: ProgressReporter,
): Promise<ScoreResult | null> {
  const changed = changedSource(config);
  if (changed.length === 0) {
    return null;
  }
  const before = changedMeasurement(config, changed, "HEAD");
  const after = changedMeasurement(config, changed, "worktree");
  const pinnedConfig = artifactConfig(config, state);
  const fenceStatus = fenceArtifactStatus(pinnedConfig);
  const fence = fenceStatus.usable ? fenceStatus.artifact : null;
  const touched = [...new Set(changed.map((path) => regionOf(path, config.srcDir)))];
  const fenceRegions = (fence?.regions ?? {}) as Record<
    string,
    { admissible?: boolean; p?: number } | undefined
  >;
  const blocked = touched.filter((region) => fenceRegions[region]?.admissible !== true);
  const calibration = calibrationArtifactStatus(pinnedConfig);
  const scales = calibration.usable
    ? ((calibration.artifact?.scales ?? null) as CalibrationScales | null)
    : null;
  const verdict = decide({
    before,
    after,
    testsPass: await shellOk(
      config.testCommand,
      config.worktree,
      env,
      COMMAND_TIMEOUT,
      reporter,
      "test command",
    ),
    fenceUsable: fenceStatus.usable,
    blockedRegions: blocked,
    touchedFidelities: touched.map((region) => fenceRegions[region]?.p ?? 0),
    diffsize: diffSize(config),
    typeErrors: await typeErrors(config, env, reporter),
    baselineTypeErrors: state.baselineTsc,
    weights: config.weights,
    scales,
  });
  return {
    ...verdict,
    files: changed.map((path) => path.replace(`${config.srcDir}/`, "")),
    touched,
    blocked,
  };
}

function benchmarkInfo(config: Config): { benchmarkRel: string; benchmarkInsideRepo: boolean } {
  const benchmarkRel = relative(config.repo, config.benchmarkDir);
  return {
    benchmarkRel,
    benchmarkInsideRepo: Boolean(
      benchmarkRel && !benchmarkRel.startsWith("..") && !benchmarkRel.startsWith("/"),
    ),
  };
}

function hideBenchmark(config: Config, benchmarkRel: string, benchmarkInsideRepo: boolean): void {
  if (benchmarkInsideRepo) {
    rmSync(`${config.worktree}/${benchmarkRel}`, { recursive: true, force: true });
  }
}

function restoreBenchmark(
  config: Config,
  benchmarkRel: string,
  benchmarkInsideRepo: boolean,
  env: NodeJS.ProcessEnv,
): void {
  if (benchmarkInsideRepo) {
    const restored = tryRun("git", ["restore", "--staged", "--worktree", "--", benchmarkRel], {
      cwd: config.worktree,
      env,
    });
    if (!restored.ok) {
      tryRun("git", ["checkout", "HEAD", "--", benchmarkRel], { cwd: config.worktree, env });
    }
  }
}

function restoreRuntimeDeps(config: Config): void {
  unlinkWorktreeNodeModules(config.repo, config.worktree);
  linkWorktreeNodeModules(config.repo, config.worktree);
}

function dirtyPaths(config: Config, benchmarkRel: string, benchmarkInsideRepo: boolean): string[] {
  const fields = tryRun("git", ["status", "--porcelain=v1", "-z", "-uall"], {
    cwd: config.worktree,
  })
    .out.split("\0")
    .filter(Boolean);
  const paths: string[] = [];
  for (let i = 0; i < fields.length; i += 1) {
    const entry = fields[i];
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    const isRenameOrCopy = status.includes("R") || status.includes("C");
    const source = isRenameOrCopy ? fields[++i] : undefined;
    for (const candidate of [path, source].filter((value): value is string => Boolean(value))) {
      if (
        !isHiddenBenchmarkDeletion({
          benchmarkInsideRepo,
          benchmarkRel,
          path: candidate,
          status,
        }) &&
        !isNodeModulesPath(candidate)
      ) {
        paths.push(candidate);
      }
    }
  }
  return paths;
}

function dirtyPathsAfterProposer(
  config: Config,
  benchmarkRel: string,
  benchmarkInsideRepo: boolean,
): string[] {
  const paths = dirtyPaths(config, benchmarkRel, benchmarkInsideRepo);
  if (existsSync(`${config.worktree}/node_modules`)) {
    paths.push("node_modules");
  }
  return [...new Set(paths)];
}

function cleanPaths(config: Config, paths: readonly string[]): void {
  const cleanRoots = [...new Set([config.srcDir, ...config.testLayout.roots, ...paths])];
  resetAndCleanWorktree(config.worktree, { paths: cleanRoots });
}

function discardTipCommit(config: Config): void {
  const cleanRoots = [...new Set([config.srcDir, ...config.testLayout.roots])];
  resetAndCleanWorktree(config.worktree, { ref: "HEAD~1", paths: cleanRoots });
}

function compactProcessOutput(result: {
  readonly stdout?: string;
  readonly stderr?: string;
}): string {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.replace(/\s+/gu, " ").trim().slice(-200);
}

function readReducerProgram(config: Config): string {
  if (!existsSync(config.program)) {
    throw new Error(
      `program.md missing at ${config.program}; set CN_PROGRAM or reinstall the packaged runtime data.`,
    );
  }
  const program = readFileSync(config.program, "utf8");
  if (program.trim().length === 0) {
    throw new Error(
      `program.md is empty at ${config.program}; set CN_PROGRAM or reinstall the packaged runtime data.`,
    );
  }
  return program;
}

async function runProposer(
  config: Config,
  env: NodeJS.ProcessEnv,
  prompt: string,
  regionKey: string,
  mode: ProposerMode,
  reporter?: ProgressReporter,
): Promise<ProposerResult> {
  const target = regionTarget(config, regionKey);
  return selectProposerAdapter(env).propose({
    mode,
    prompt,
    promptFile: config.promptFile,
    repo: config.repo,
    worktree: config.worktree,
    regionKey,
    regionTarget: target,
    timeoutMs: config.proposerTimeoutMs,
    budgetUsd: config.proposerBudgetUsd,
    env,
    progress: reporter,
  });
}

function regionTarget(config: Config, regionKey: string): string {
  if (config.srcDir === ".") {
    return regionKey === "." ? "." : `${regionKey}/`;
  }
  if (regionKey === config.srcDir) {
    return `${config.srcDir}/`;
  }
  return `${config.srcDir}/${regionKey}/`;
}

function proposerStatusLine(input: {
  readonly provider: string;
  readonly mode: ProposerMode;
  readonly region: string;
  readonly target: string;
  readonly threadId?: string;
}): string {
  return `  proposer start: provider=${input.provider} mode=${input.mode} region=${input.region} target=${input.target}${input.threadId ? ` thread=${input.threadId}` : ""}`;
}

function proposerResultLine(result: ProposerResult): string {
  return `  proposer result: provider=${result.provider} status=${result.ok ? "ok" : "failed"}${result.threadId ? ` thread=${result.threadId}` : ""}${result.summary ? ` summary=${result.summary}` : ""}`;
}

function logRow(
  config: Config,
  out: string[],
  reporter: ProgressReporter | undefined,
  row: Parameters<typeof formatResultRow>[0],
): void {
  appendFileSync(config.results, `${formatResultRow(row)}\n`);
  recordLine(out, reporter, `  -> ${row.status.toUpperCase()}  ${row.description}`);
}

/** Run the modernized autonomous loop, including reduce scoring and raise replay. */
export async function runAutoloop(
  iterations: number,
  env: Env = process.env,
  cwd = process.cwd(),
  options: CommandOptions = {},
): Promise<CommandResult> {
  const reporter = options.reporter;
  const config = loadConfig(env, cwd);
  const out: string[] = [];
  reporter?.emit("run: resolving startup state");
  let existingState: EngineState | null;
  try {
    existingState = existsSync(config.state) ? readState(config.state) : null;
    if (existingState) {
      assertStateBaselineSha(config, env as NodeJS.ProcessEnv, existingState);
    }
  } catch (error) {
    return { exitCode: 1, stdout: `${error instanceof Error ? error.message : String(error)}\n` };
  }
  let startupBaselineSha: string;
  try {
    startupBaselineSha =
      existingState?.baselineSha ?? resolveBaselineSha(config, env as NodeJS.ProcessEnv);
  } catch {
    return { exitCode: 1, stdout: `baseline ${config.baseline} not found\n` };
  }
  const startupConfig = artifactConfig(
    config,
    existingState ?? {
      baselineSha: startupBaselineSha,
      baselineTsc: 0,
      startL: 0,
      accepted: [],
      iter: 0,
    },
  );
  const fenceStatus = fenceArtifactStatus(startupConfig);
  const calibrationStatus = calibrationArtifactStatus(startupConfig);
  const valueProxyStatus = valueProxyValidationStatus(startupConfig);
  const fence = fenceStatus.artifact;
  const candidates = fence
    ? inScopeRegions(
        {
          regions: (fence.regions ?? {}) as Record<
            string,
            { admissible?: boolean; lo?: number } | undefined
          >,
        },
        config.regions,
        config.target,
        config.srcDir,
      )
    : [];
  const startup = runStartupFailure({
    fence: artifactReadiness(fenceStatus),
    calibration: artifactReadiness(calibrationStatus),
    valueProxy: valueProxyReadiness(valueProxyStatus),
    inScopeRegionCount: candidates.length,
    baseline: config.baseline,
    repo: config.repo,
    fenceArtifact: config.fenceArtifact,
    target: config.target,
    iterations,
  });
  if (startup) {
    return { exitCode: startup.exitCode, stdout: `${startup.message}\n` };
  }

  mkdirParent(config.results);
  try {
    await initializeWorktree(config, env as NodeJS.ProcessEnv, out, startupBaselineSha, reporter);
  } catch (error) {
    return { exitCode: 1, stdout: `${error instanceof Error ? error.message : String(error)}\n` };
  }
  if (!existsSync(config.results)) {
    writeFileSync(config.results, `${formatResultsHeader()}\n`);
  }
  recordLine(
    out,
    reporter,
    `\n=== autoloop: ${iterations} iters, proposer=${selectProposerAdapter(env as NodeJS.ProcessEnv).provider}, regions=${config.regions.join(",") || config.region}, branch=${config.branch} ===`,
  );
  let kept = 0;
  let raised = 0;
  const bench = benchmarkInfo(config);
  for (let i = 1; i <= iterations; i += 1) {
    const stateForArtifacts = existsSync(config.state) ? readState(config.state) : null;
    const freshFenceStatus = fenceArtifactStatus(artifactConfig(config, stateForArtifacts));
    const freshFence = freshFenceStatus.artifact;
    const regionMap = (freshFence?.regions ?? {}) as Record<string, FenceRegionRuntime | undefined>;
    const scoped = inScopeRegions(
      { regions: regionMap },
      config.regions,
      config.target,
      config.srcDir,
    );
    const activeRegion = chooseRegion({ regions: regionMap }, scoped, config.region);
    const region = regionMap[activeRegion];
    const mode = selectMode(region);
    recordLine(
      out,
      reporter,
      `\n--- iter ${i}/${iterations} [${mode}] ${activeRegion} fence ${
        region
          ? `${((region.p ?? 0) * 100).toFixed(0)}% lo=${((region.lo ?? 0) * 100).toFixed(0)}%`
          : "unmeasured"
      } ---`,
    );
    if (mode === "raise") {
      const specs = region?.survivorSpecs ?? [];
      if (specs.length === 0) {
        logRow(config, out, reporter, {
          iter: i,
          commit: "-",
          dAST: 0,
          dCx: 0,
          behavior: "-",
          mfence: region ? (region.p ?? 0).toFixed(2) : "-",
          loss: "-",
          status: "raise-skip",
          description: `${activeRegion}: no survivor specs — run 'fence' (AST-aware audit) first`,
        });
        break;
      }
      const loBefore = region?.lo ?? 0;
      hideBenchmark(config, bench.benchmarkRel, bench.benchmarkInsideRepo);
      unlinkWorktreeNodeModules(config.repo, config.worktree);
      recordLine(
        out,
        reporter,
        proposerStatusLine({
          provider: selectProposerAdapter(env as NodeJS.ProcessEnv).provider,
          mode: "raise-fence",
          region: activeRegion,
          target: regionTarget(config, activeRegion),
        }),
      );
      const proposal = await runProposer(
        config,
        env as NodeJS.ProcessEnv,
        raisePrompt(
          regionTarget(config, activeRegion),
          config.testLayout.description,
          specs.map((spec) => ({
            rel: spec.rel ?? "",
            line: spec.line ?? spec.start ?? "?",
            op: spec.op ?? "",
          })),
        ),
        activeRegion,
        "raise-fence",
        reporter,
      );
      recordLine(out, reporter, proposerResultLine(proposal));
      if (!proposal.ok) {
        const failure = proposerFailure({ ...proposal, timeoutMs: config.proposerTimeoutMs });
        restoreBenchmark(
          config,
          bench.benchmarkRel,
          bench.benchmarkInsideRepo,
          env as NodeJS.ProcessEnv,
        );
        restoreRuntimeDeps(config);
        cleanPaths(config, []);
        logRow(config, out, reporter, {
          iter: i,
          commit: "-",
          dAST: 0,
          dCx: 0,
          behavior: "-",
          mfence: (region?.p ?? 0).toFixed(2),
          loss: "-",
          status: failure.status,
          description: failure.description,
        });
        continue;
      }
      const dirtyAfterRaise = dirtyPathsAfterProposer(
        config,
        bench.benchmarkRel,
        bench.benchmarkInsideRepo,
      );
      if (dirtyAfterRaise.length === 0) {
        restoreBenchmark(
          config,
          bench.benchmarkRel,
          bench.benchmarkInsideRepo,
          env as NodeJS.ProcessEnv,
        );
        restoreRuntimeDeps(config);
        cleanPaths(config, []);
        logRow(config, out, reporter, {
          iter: i,
          commit: "-",
          dAST: 0,
          dCx: 0,
          behavior: "-",
          mfence: (region?.p ?? 0).toFixed(2),
          loss: "-",
          status: "raise-noop",
          description: "no tests added",
        });
        continue;
      }
      const disallowed = dirtyAfterRaise.filter(
        (path) => !isAllowedRaisePath(path, config.testLayout.roots),
      );
      if (disallowed.length > 0) {
        restoreBenchmark(
          config,
          bench.benchmarkRel,
          bench.benchmarkInsideRepo,
          env as NodeJS.ProcessEnv,
        );
        restoreRuntimeDeps(config);
        cleanPaths(config, disallowed);
        logRow(config, out, reporter, {
          iter: i,
          commit: "-",
          dAST: 0,
          dCx: 0,
          behavior: "-",
          mfence: (region?.p ?? 0).toFixed(2),
          loss: "-",
          status: "raise-badtest",
          description: `touched outside raise test surface; outside discovered test surface (${config.testLayout.description}): ${disallowed.join(",")}`,
        });
        continue;
      }
      const raisePaths = dirtyAfterRaise;
      restoreBenchmark(
        config,
        bench.benchmarkRel,
        bench.benchmarkInsideRepo,
        env as NodeJS.ProcessEnv,
      );
      restoreRuntimeDeps(config);
      if (
        !(await shellOk(
          config.testCommand,
          config.worktree,
          env as NodeJS.ProcessEnv,
          COMMAND_TIMEOUT,
          reporter,
          "test command",
        ))
      ) {
        cleanPaths(config, []);
        logRow(config, out, reporter, {
          iter: i,
          commit: "-",
          dAST: 0,
          dCx: 0,
          behavior: "-",
          mfence: (region?.p ?? 0).toFixed(2),
          loss: "-",
          status: "raise-badtest",
          description: "added tests fail on current code",
        });
        continue;
      }
      run("git", ["add", "-A", "--", ...raisePaths], { cwd: config.worktree, env });
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
          `raise(iter ${i}): characterization tests for ${activeRegion}`,
        ],
        { cwd: config.worktree, env },
      );
      const commit = run("git", ["rev-parse", "--short", "HEAD"], {
        cwd: config.worktree,
        env,
      }).trim();
      const replay = await runFenceCommand(["replay", activeRegion, config.worktree], env, cwd, {
        reporter: reporter ? textReporter((line) => reporter.emit(line)) : undefined,
      });
      if (replay.exitCode !== 0) {
        discardTipCommit(config);
        logRow(config, out, reporter, {
          iter: i,
          commit: "-",
          dAST: 0,
          dCx: 0,
          behavior: "true",
          mfence: (region?.p ?? 0).toFixed(2),
          loss: "-",
          status: "raise-error",
          description: `replay failed: ${compactProcessOutput(replay)}`,
        });
        continue;
      }
      const replayStateForArtifacts = existsSync(config.state) ? readState(config.state) : null;
      const replayFenceStatus = fenceArtifactStatus(
        artifactConfig(config, replayStateForArtifacts),
      );
      const replayRegion = (
        (replayFenceStatus.artifact?.regions ?? {}) as Record<
          string,
          FenceRegionRuntime | undefined
        >
      )[activeRegion];
      if (!replayRegion) {
        discardTipCommit(config);
        logRow(config, out, reporter, {
          iter: i,
          commit: "-",
          dAST: 0,
          dCx: 0,
          behavior: "true",
          mfence: (region?.p ?? 0).toFixed(2),
          loss: "-",
          status: "raise-error",
          description: "replay failed: missing replayed region",
        });
        continue;
      }
      raised += 1;
      const status = (replayRegion.lo ?? 0) > loBefore + 1e-9 ? "raise" : "raise-nogain";
      const keptCommit = status === "raise";
      if (!keptCommit) {
        discardTipCommit(config);
      }
      logRow(config, out, reporter, {
        iter: i,
        commit: keptCommit ? commit : "-",
        dAST: 0,
        dCx: 0,
        behavior: "true",
        mfence: (replayRegion.p ?? 0).toFixed(2),
        loss: "-",
        status,
        description: `${activeRegion} fence ${(loBefore * 100).toFixed(0)}%→${((replayRegion.p ?? 0) * 100).toFixed(0)}% lo=${((replayRegion.lo ?? 0) * 100).toFixed(0)}%${replayRegion.admissible ? " ADMISSIBLE✓" : ""}`,
      });
      continue;
    }

    hideBenchmark(config, bench.benchmarkRel, bench.benchmarkInsideRepo);
    unlinkWorktreeNodeModules(config.repo, config.worktree);
    let program: string;
    try {
      program = readReducerProgram(config);
    } catch (error) {
      restoreBenchmark(
        config,
        bench.benchmarkRel,
        bench.benchmarkInsideRepo,
        env as NodeJS.ProcessEnv,
      );
      restoreRuntimeDeps(config);
      return {
        exitCode: 1,
        stdout: lines([...out, error instanceof Error ? error.message : String(error)]),
      };
    }
    recordLine(
      out,
      reporter,
      proposerStatusLine({
        provider: selectProposerAdapter(env as NodeJS.ProcessEnv).provider,
        mode: "reduce",
        region: activeRegion,
        target: regionTarget(config, activeRegion),
      }),
    );
    const proposal = await runProposer(
      config,
      env as NodeJS.ProcessEnv,
      reducePrompt(regionTarget(config, activeRegion), program),
      activeRegion,
      "reduce",
      reporter,
    );
    recordLine(out, reporter, proposerResultLine(proposal));
    if (!proposal.ok) {
      const failure = proposerFailure({ ...proposal, timeoutMs: config.proposerTimeoutMs });
      restoreBenchmark(
        config,
        bench.benchmarkRel,
        bench.benchmarkInsideRepo,
        env as NodeJS.ProcessEnv,
      );
      restoreRuntimeDeps(config);
      cleanPaths(config, []);
      logRow(config, out, reporter, {
        iter: i,
        commit: "-",
        dAST: 0,
        dCx: 0,
        behavior: "-",
        mfence: (region?.p ?? 0).toFixed(2),
        loss: "+Inf",
        status: failure.status,
        description: failure.description,
      });
      continue;
    }
    const disallowed = dirtyPathsAfterProposer(
      config,
      bench.benchmarkRel,
      bench.benchmarkInsideRepo,
    ).filter((path) => !isAllowedReducePath(path, config.srcDir));
    if (disallowed.length > 0) {
      restoreBenchmark(
        config,
        bench.benchmarkRel,
        bench.benchmarkInsideRepo,
        env as NodeJS.ProcessEnv,
      );
      restoreRuntimeDeps(config);
      cleanPaths(config, disallowed);
      logRow(config, out, reporter, {
        iter: i,
        commit: "-",
        dAST: 0,
        dCx: 0,
        behavior: "-",
        mfence: (region?.p ?? 0).toFixed(2),
        loss: "+Inf",
        status: "revert",
        description: `proposer touched outside reduce source surface: ${disallowed.join(",")}`,
      });
      continue;
    }
    restoreBenchmark(
      config,
      bench.benchmarkRel,
      bench.benchmarkInsideRepo,
      env as NodeJS.ProcessEnv,
    );
    restoreRuntimeDeps(config);
    const state = readState(config.state);
    const score = await scoreCandidate(config, env as NodeJS.ProcessEnv, state, reporter);
    if (!score) {
      cleanPaths(config, []);
      logRow(config, out, reporter, {
        iter: i,
        commit: "-",
        dAST: 0,
        dCx: 0,
        behavior: "-",
        mfence: (region?.p ?? 0).toFixed(2),
        loss: "-",
        status: "noop",
        description: "no scorable src change",
      });
      continue;
    }
    const desc = `ΔAST=${score.dL} ${score.files.join(",")}`;
    if (score.keep) {
      run("git", ["add", "-A", "--", ...changedSource(config)], { cwd: config.worktree, env });
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
      const commit = run("git", ["rev-parse", "--short", "HEAD"], {
        cwd: config.worktree,
        env,
      }).trim();
      writeState(config.state, {
        ...state,
        iter: state.iter + 1,
        accepted: [...state.accepted, commit],
      });
      kept += 1;
      logRow(config, out, reporter, {
        iter: i,
        commit,
        dAST: score.dL,
        dCx: score.dCx,
        behavior: score.gates.G1,
        mfence: score.mfence.toFixed(2),
        loss: score.loss?.toFixed(3) ?? "+Inf",
        status: "keep",
        description: desc,
      });
    } else {
      cleanPaths(config, []);
      logRow(config, out, reporter, {
        iter: i,
        commit: "-",
        dAST: score.dL,
        dCx: score.dCx,
        behavior: score.gates.G1,
        mfence: score.mfence.toFixed(2),
        loss: score.loss?.toFixed(3) ?? "+Inf",
        status: "revert",
        description:
          `${desc} | ${score.gates.G1prime ? "" : "G1′ "}${score.gates.G1 ? "" : "G1 "}${score.gates.G3 ? "" : "G3 "}${score.gates.G4 ? "" : "G4↓"}`.trim(),
      });
    }
  }
  recordLine(out, reporter, `\n=== done: ${kept} kept, ${raised} fence-raises ===`);
  if (existsSync(config.state)) {
    const state = readState(config.state);
    const headSha = run("git", ["rev-parse", "--verify", "--end-of-options", "HEAD"], {
      cwd: config.worktree,
    }).trim();
    const now = targetL(config, headSha);
    const cut = state.startL - now;
    recordLine(out, reporter, `iterations=${state.iter} accepted=[${state.accepted.join(", ")}]`);
    recordLine(
      out,
      reporter,
      `${config.target} astNodes: ${state.startL} -> ${now}  (cumulative reduction ${cut}, ${state.startL ? ((cut / state.startL) * 100).toFixed(1) : "0"}%)`,
    );
  }
  recordLine(out, reporter, `branch ${config.branch} | results: ${config.results}`);
  return { exitCode: 0, stdout: lines(out) };
}
