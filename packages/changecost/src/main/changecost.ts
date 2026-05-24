/**
 * Change-cost library and runtime (the Vhat ground-truth audit). Migrated from
 * `legacy/codenuke/loop/changecost.mjs`.
 *
 * @see analysis/codenuke/BUSINESS_RULES.md — RULE-011 (𝒱̂), RULE-012 (editCost), RULE-013 (verifyCost)
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fenceArtifactStatus } from "@codenuke/artifacts";
import { isSourceFile, isUnderSourceDir, loadConfig, regionOf } from "@codenuke/config";
import { commandDisplay, run, tryRunCommand, type TryResult } from "@codenuke/exec";
import {
  isHiddenBenchmarkDeletion,
  isNodeModulesPath,
  linkWorktreeNodeModules,
  removeWorktree,
  resetAndCleanWorktree,
} from "@codenuke/substrate";
import ts from "typescript";

type Env = Record<string, string | undefined>;

export interface RuntimeResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ChangeCostCommandOptions {
  readonly reporter?: { emit(line: string): void };
}

/** Leaf-token stream of a source file (formatting-invariant edit unit). */
export function tokenize(name: string, text: string): string[] {
  const sf = ts.createSourceFile(
    name,
    text,
    ts.ScriptTarget.Latest,
    true,
    name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const tokens: string[] = [];
  (function walk(node: ts.Node): void {
    const kids = node.getChildren(sf);
    if (kids.length === 0) {
      const t = node.getText(sf);
      if (t !== "") {
        tokens.push(t);
      }
    } else {
      for (const k of kids) {
        walk(k);
      }
    }
  })(sf);
  return tokens;
}

/** Token-level edit size = insertions + deletions via LCS (RULE-012). */
export function lcsEditSize(a: readonly string[], b: readonly string[]): number {
  const n = a.length;
  const m = b.length;
  if (n === 0) {
    return m;
  }
  if (m === 0) {
    return n;
  }
  let prev = Array.from({ length: m + 1 }, () => 0);
  for (let i = 1; i <= n; i++) {
    const cur = Array.from({ length: m + 1 }, () => 0);
    const ai = a[i - 1];
    for (let j = 1; j <= m; j++) {
      cur[j] = ai === b[j - 1] ? prev[j - 1] + 1 : prev[j] >= cur[j - 1] ? prev[j] : cur[j - 1];
    }
    prev = cur;
  }
  return n - prev[m] + (m - prev[m]);
}

export interface EditCostResult {
  readonly tokens: number;
  readonly filesTouched: number;
  readonly perFile: Record<string, number>;
}

export interface BenchmarkDelta {
  readonly id: string;
  readonly title: string;
  readonly prompt: string;
  readonly region?: string;
  readonly acceptPath: string;
  readonly dir: string;
  readonly acceptTest: string;
}

export interface ChangeCostResult {
  readonly id: string;
  readonly status: "impl-fail" | "impl-bad-surface" | "not-done" | "done";
  readonly editTokens?: number;
  readonly filesTouched?: number;
  readonly regions?: readonly string[];
  readonly verifyFrac?: number;
  readonly cost?: number;
  readonly disallowed?: readonly string[];
}

export interface ChangeCostArtifact {
  readonly schemaVersion: 1;
  readonly ref: string;
  readonly beta: number;
  readonly Vhat: number | null;
  readonly done: number;
  readonly total: number;
  readonly results: readonly ChangeCostResult[];
}

export interface GitCommandPlan {
  readonly resolveRef: readonly string[];
  readonly addWorktree: readonly string[];
  readonly snapshotFiles: readonly string[];
  readonly statusPorcelain: readonly string[];
  readonly resetAndCleanAll: readonly string[];
  readonly resetAndCleanPaths: (paths: readonly string[]) => readonly string[];
}

function metadataString(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return fallback;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return `${value}`;
  }
  return fallback;
}

/** Formatting-invariant token edit size over changed counted source files (RULE-012). */
export function editCost(
  beforeMap: Record<string, string>,
  afterMap: Record<string, string>,
  srcDir = "src",
): EditCostResult {
  const counted = (p: string): boolean =>
    (srcDir === "." || p.startsWith(`${srcDir}/`)) && isSourceFile(p);
  const files = new Set([...Object.keys(beforeMap), ...Object.keys(afterMap)].filter(counted));
  let tokens = 0;
  let touched = 0;
  const perFile: Record<string, number> = {};
  for (const f of files) {
    if (beforeMap[f] === afterMap[f]) {
      continue;
    }
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

/** Mean fence gap over touched regions: mean(1 − fidelity) (RULE-013). */
export function verifyCost(
  touchedRegions: readonly string[],
  fenceArtifact: { regions?: Record<string, { p?: number }> } | null,
): number {
  if (touchedRegions.length === 0) {
    return 0;
  }
  const fid = (r: string): number => fenceArtifact?.regions?.[r]?.p ?? 0;
  return touchedRegions.reduce((s, r) => s + (1 - fid(r)), 0) / touchedRegions.length;
}

/** Realized cost of one change: edit tokens + β·verify-gap (RULE-011). */
export const costOf = (editTokens: number, verifyFrac: number, beta = 60): number =>
  editTokens + beta * verifyFrac;

/** 𝒱̂ — mean realized cost over completed changes, or null if none (RULE-011). */
export const meanChangeCost = (costs: readonly number[]): number | null =>
  costs.length ? costs.reduce((s, c) => s + c, 0) / costs.length : null;

/** The implementer prompt for a benchmark change (pure string). */
export function buildImplementerPrompt(
  delta: { prompt: string; acceptPath: string },
  srcDir: string,
): string {
  return `Implement this change-request (cwd is the repo root).

## Request
${delta.prompt}

The hidden acceptance test will be installed at ${delta.acceptPath} after implementation and run with the full suite. Edit ONLY non-test source under ${srcDir}/. Implement for real (no test-specific hacks). When done, stop.`;
}

export const defaultChangeCostOutputPath = (repo: string): string =>
  `${repo}/.codenuke/changecost.json`;

export function parseChangeCostBeta(env: Env): number {
  const beta = Number(env.CN_BETA ?? 60);
  if (!Number.isFinite(beta) || beta < 0) {
    throw new Error("CN_BETA must be a finite non-negative number");
  }
  return beta;
}

export const changeCostRef = (args: readonly string[], env: Env, defaultBaseline: string): string =>
  args[0] ?? env.CN_BASE ?? defaultBaseline;

export function createChangeCostArtifact(
  input: Omit<ChangeCostArtifact, "schemaVersion">,
): ChangeCostArtifact {
  return { schemaVersion: 1, ...input };
}

function assertSafeRef(ref: string): void {
  if (!ref || ref.startsWith("-") || ref.includes("\0")) {
    throw new Error("unsafe git ref for changecost");
  }
}

const pathSegments = (value: string): string[] => value.split(/[\\/]+/u).filter(Boolean);
const hasParentTraversal = (value: string): boolean => pathSegments(value).includes("..");
const escapesRoot = (relativePath: string): boolean =>
  isAbsolute(relativePath) || pathSegments(relativePath)[0] === "..";

function assertSafeSourcePath(srcDir: string): void {
  if (
    !srcDir ||
    isAbsolute(srcDir) ||
    srcDir.includes("\0") ||
    srcDir.includes("\\") ||
    hasParentTraversal(srcDir) ||
    srcDir.startsWith(":")
  ) {
    throw new Error("unsafe source path for changecost");
  }
}

export function changeCostGitCommandPlan(input: {
  readonly repo: string;
  readonly worktree: string;
  readonly ref: string;
  readonly srcDir: string;
}): GitCommandPlan {
  assertSafeRef(input.ref);
  assertSafeSourcePath(input.srcDir);
  return {
    resolveRef: ["rev-parse", "--verify", "--end-of-options", input.ref],
    addWorktree: ["worktree", "add", "-f", input.worktree, input.ref],
    snapshotFiles: ["ls-files", "-z", "--", input.srcDir],
    statusPorcelain: ["status", "--porcelain", "-z"],
    resetAndCleanAll: ["reset", "--hard", "--"],
    resetAndCleanPaths: (paths) => ["checkout", "--", ...paths],
  };
}

export function safeWorktreePath(worktreeRoot: string, rel: string): string {
  if (isAbsolute(rel) || rel.includes("\0") || rel.includes("\\")) {
    throw new Error("unsafe worktree path");
  }
  const root = resolve(worktreeRoot);
  const path = resolve(root, rel);
  const back = relative(root, path);
  if (escapesRoot(back)) {
    throw new Error("unsafe worktree path");
  }
  const parts = pathSegments(back);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error("unsafe worktree path");
    }
  }
  return path;
}

export function discoverBenchmarks(benchmarkDir: string): readonly BenchmarkDelta[] {
  if (!existsSync(benchmarkDir)) {
    return [];
  }
  return readdirSync(benchmarkDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = join(benchmarkDir, entry.name);
      const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as {
        id?: unknown;
        title?: unknown;
        prompt?: unknown;
        region?: unknown;
        acceptPath?: unknown;
      };
      const id = metadataString(meta.id, entry.name);
      return {
        id,
        title: metadataString(meta.title, id),
        prompt: metadataString(meta.prompt, ""),
        region: typeof meta.region === "string" ? meta.region : undefined,
        acceptPath: metadataString(meta.acceptPath, "accept.test.ts"),
        dir,
        acceptTest: readFileSync(join(dir, "accept.test.ts"), "utf8"),
      };
    })
    .toSorted((left, right) => left.id.localeCompare(right.id));
}

export function dirtyPathsFromPorcelainZ(
  output: string,
  options: { benchmarkInsideRepo: boolean; benchmarkRel: string },
): string[] {
  const fields = output.split("\0").filter(Boolean);
  const paths: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    const isRenameOrCopy = status.includes("R") || status.includes("C");
    const renameSource = isRenameOrCopy ? fields[++i] : undefined;
    for (const candidate of [path, renameSource].filter((value): value is string =>
      Boolean(value),
    )) {
      if (
        !isHiddenBenchmarkDeletion({
          benchmarkInsideRepo: options.benchmarkInsideRepo,
          benchmarkRel: options.benchmarkRel,
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

async function snapshotWorktree(
  worktree: string,
  srcDir: string,
  includeUntracked = false,
): Promise<Record<string, string>> {
  const lsArgs = includeUntracked
    ? ["-C", worktree, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", srcDir]
    : ["-C", worktree, "ls-files", "-z", "--", srcDir];
  const files = (await run("git", lsArgs))
    .split("\0")
    .filter((path) => path.length > 0 && isSourceFile(path));
  const snapshot: Record<string, string> = {};
  for (const file of files) {
    try {
      snapshot[file] = readFileSync(safeWorktreePath(worktree, file), "utf8");
    } catch {
      /* deleted between ls-files and read */
    }
  }
  return snapshot;
}

async function runCodexImplementer(input: {
  readonly prompt: string;
  readonly worktree: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
}): Promise<TryResult> {
  const controller = new AbortController();
  let timedOut = false;
  const startedAt = Date.now();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, input.timeoutMs);
  timer.unref();
  try {
    const { Codex } = await import("@openai/codex-sdk");
    const codex = new Codex({
      env: Object.fromEntries(
        Object.entries(input.env).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
    });
    const thread = codex.startThread({ workingDirectory: input.worktree, sandboxMode: "workspace-write", approvalPolicy: "never" });
    const streamed = await thread.runStreamed(input.prompt, { signal: controller.signal });
    let finalResponse = "";
    for await (const event of streamed.events) {
      if (event.type === "item.completed" && event.item.type === "agent_message") {
        finalResponse = event.item.text;
      }
      if (event.type === "turn.failed") {
        throw new Error(event.error.message);
      }
      if (event.type === "error") {
        throw new Error(event.message);
      }
    }
    return {
      ok: true,
      out: finalResponse,
      timedOut,
      elapsedMs: Date.now() - startedAt,
      exitCode: 0,
      signal: null,
    };
  } catch (error) {
    return {
      ok: false,
      out: error instanceof Error ? error.message : String(error),
      timedOut,
      elapsedMs: Date.now() - startedAt,
      exitCode: null,
      signal: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

function formatChangeCostSummary(artifact: ChangeCostArtifact, out: string): string {
  const value = artifact.Vhat == null ? "n/a" : artifact.Vhat.toFixed(1);
  return `\n=== Vhat(${artifact.ref}) = ${value} over ${artifact.done}/${artifact.total} changes ===  -> ${out}\n`;
}

export async function runChangeCostCommand(
  args: readonly string[],
  env: Env,
  cwd: string,
  options: ChangeCostCommandOptions = {},
): Promise<RuntimeResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const log = (line = ""): void => {
    stdout.push(`${line}\n`);
    options.reporter?.emit(line);
  };

  let config: ReturnType<typeof loadConfig>;
  let ref: string;
  let beta: number;
  try {
    options.reporter?.emit("changecost: resolving config");
    config = loadConfig(env, cwd);
    ref = changeCostRef(args, env, config.baseline);
    beta = parseChangeCostBeta(env);
  } catch (error) {
    return { exitCode: 1, stdout: "", stderr: `${(error as Error).message}\n` };
  }

  const worktree = `${config.worktree}-changecost`;
  const out = defaultChangeCostOutputPath(config.repo);
  const benchmarkRel = relative(config.repo, config.benchmarkDir);
  const benchmarkInsideRepo =
    benchmarkRel.length > 0 && !benchmarkRel.startsWith("..") && !isAbsolute(benchmarkRel);
  const benchmarkDeltas = discoverBenchmarks(config.benchmarkDir);

  if (benchmarkDeltas.length === 0) {
    log(
      `no benchmark in ${config.benchmarkDir} (add change-requests: <id>/meta.json + accept.test.ts)`,
    );
    return { exitCode: 1, stdout: stdout.join(""), stderr: stderr.join("") };
  }

  const plan = changeCostGitCommandPlan({
    repo: config.repo,
    worktree,
    ref,
    srcDir: config.srcDir,
  });

  const cleanupWorktree = async (): Promise<void> => removeWorktree(config.repo, worktree);
  const cleanupFailureMessage = async (): Promise<string> => {
    try {
      await cleanupWorktree();
      return "";
    } catch (error) {
      return `cleanup failed: ${(error as Error).message}\n`;
    }
  };
  const cleanWT = async (): Promise<void> => resetAndCleanWorktree(worktree, { all: true });
  const dirtyPaths = async (): Promise<string[]> =>
    dirtyPathsFromPorcelainZ(await run("git", ["-C", worktree, ...plan.statusPorcelain]), {
      benchmarkInsideRepo,
      benchmarkRel,
    });
  const hideBenchmarkFromWorktree = (): void => {
    if (benchmarkInsideRepo) {
      rmSync(safeWorktreePath(worktree, benchmarkRel), { recursive: true, force: true });
    }
  };
  const green = async (): Promise<boolean> =>
    (
      await tryRunCommand(config.testCommand, {
        cwd: worktree,
        env: env as NodeJS.ProcessEnv,
        progress: options.reporter,
        progressLabel: "test command",
      })
    ).ok;

  try {
    options.reporter?.emit(`changecost: preparing worktree ${worktree}`);
    await cleanupWorktree();
    await run("git", plan.addWorktree, { cwd: config.repo, env });
    await linkWorktreeNodeModules(config.repo, worktree);

    options.reporter?.emit("changecost: checking baseline tests");
    if (!(await green())) {
      log("baseline RED — abort");
      await cleanupWorktree();
      return { exitCode: 1, stdout: stdout.join(""), stderr: stderr.join("") };
    }

    const baseline = await snapshotWorktree(worktree, config.srcDir);
    const fenceStatus = await fenceArtifactStatus(config);
    const fence = fenceStatus.usable ? fenceStatus.artifact : null;
    log(
      `evaluate_changecost @ ${ref}  β=${beta}  implementer=${config.implementerCommand ? commandDisplay(config.implementerCommand) : "codex sdk"}`,
    );
    options.reporter?.emit(`changecost: ${benchmarkDeltas.length} benchmark deltas`);

    const results: ChangeCostResult[] = [];
    for (const [index, delta] of benchmarkDeltas.entries()) {
      log();
      log(`--- δ ${delta.id}: ${delta.title} ---`);
      options.reporter?.emit(
        `changecost: implementer ${index + 1}/${benchmarkDeltas.length} for ${delta.id}`,
      );
      hideBenchmarkFromWorktree();
      const runEnv = { ...process.env, ...env, CN_DELTA: delta.id } as NodeJS.ProcessEnv;
      const prompt = buildImplementerPrompt(delta, config.srcDir);
      const impl = config.implementerCommand
        ? await tryRunCommand(config.implementerCommand, {
            cwd: worktree,
            timeout: 300000,
            env: runEnv,
            progress: options.reporter,
            progressLabel: "change implementer",
          })
        : await runCodexImplementer({
            prompt,
            worktree,
            timeoutMs: 300000,
            env: runEnv,
          });

      if (!impl.ok) {
        log("  implementer error");
        results.push({ id: delta.id, status: "impl-fail" });
        await cleanWT();
        continue;
      }

      const disallowed = (await dirtyPaths()).filter(
        (path) => !(isUnderSourceDir(path, config.srcDir) && isSourceFile(path)),
      );
      if (disallowed.length > 0) {
        log(`  implementer touched outside source surface: ${disallowed.join(",")}`);
        results.push({ id: delta.id, status: "impl-bad-surface", disallowed });
        await cleanWT();
        continue;
      }

      const acceptAbs = safeWorktreePath(worktree, delta.acceptPath);
      mkdirSync(dirname(acceptAbs), { recursive: true });
      writeFileSync(acceptAbs, delta.acceptTest);

      options.reporter?.emit(`changecost: running acceptance test for ${delta.id}`);
      if (!(await green())) {
        log("  acceptance/suite RED — not done");
        results.push({ id: delta.id, status: "not-done" });
        await cleanWT();
        continue;
      }

      const e = editCost(baseline, await snapshotWorktree(worktree, config.srcDir, true), config.srcDir);
      const regions = [
        ...new Set(Object.keys(e.perFile).map((path) => regionOf(path, config.srcDir))),
      ];
      const verifyFrac = fence ? verifyCost(regions, fence) : 1;
      const cost = costOf(e.tokens, verifyFrac, beta);
      log(
        `  edit=${e.tokens} tokens (${e.filesTouched} files: ${regions.join(",") || "-"})  verify=${verifyFrac.toFixed(2)}  cost=${cost.toFixed(1)}`,
      );
      results.push({
        id: delta.id,
        status: "done",
        editTokens: e.tokens,
        filesTouched: e.filesTouched,
        regions,
        verifyFrac,
        cost,
      });
      await cleanWT();
    }

    const doneCosts = results.flatMap((result) =>
      result.status === "done" && result.cost != null ? [result.cost] : [],
    );
    const artifact = createChangeCostArtifact({
      ref,
      beta,
      Vhat: meanChangeCost(doneCosts),
      done: doneCosts.length,
      total: benchmarkDeltas.length,
      results,
    });
    mkdirSync(dirname(out), { recursive: true });
    options.reporter?.emit("changecost: writing change-cost artifact");
    writeFileSync(out, JSON.stringify(artifact, null, 2));
    const cleanupFailure = await cleanupFailureMessage();
    if (cleanupFailure) {
      return { exitCode: 1, stdout: stdout.join(""), stderr: cleanupFailure };
    }
    const summary = formatChangeCostSummary(artifact, out);
    stdout.push(summary);
    options.reporter?.emit(summary.trim());
    return { exitCode: 0, stdout: stdout.join(""), stderr: stderr.join("") };
  } catch (error) {
    const cleanupFailure = await cleanupFailureMessage();
    return {
      exitCode: 1,
      stdout: stdout.join(""),
      stderr: `${(error as Error).message}\n${cleanupFailure}`,
    };
  }
}
