/**
 * codenuke configuration (repo-agnostic). Resolved, in order, from:
 *   1. environment (CN_REPO, CN_SRC, CN_TARGET, CN_BASE, CN_TAG, CN_TEST_FILE, …)
 *   2. a `codenuke.loop.json` at the repo root
 *   3. auto-detection (test runner, tsc, source dir, regions)
 *
 * Migrated from `legacy/codenuke/loop/config.mjs`. Now depends on `@codenuke/json`
 * (safe read) and `@codenuke/exec` (PATH probe). The legacy shell-string `sh`
 * re-export is intentionally dropped — consumers use `@codenuke/exec` directly.
 *
 * @see analysis/codenuke/BUSINESS_RULES.md — RULE-033 (source/test classification),
 *      RULE-034 (region detection), and the config-resolution defaults (006/010 params).
 */
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { CommandSpec } from "@codenuke/exec";
import { readJson } from "@codenuke/json";

const IGNORED_SOURCE_DIRS = new Set([".codenuke", ".git", "coverage", "dist", "node_modules"]);

type Env = Record<string, string | undefined>;

/** Where the engine runs and how it scores — the resolved configuration. */
export interface Config {
  readonly repo: string;
  readonly srcDir: string;
  readonly target: string;
  readonly region: string;
  readonly regions: readonly string[];
  readonly testLayout: { readonly roots: readonly string[]; readonly description: string };
  readonly baseline: string;
  readonly tag: string;
  readonly branch: string;
  readonly worktree: string;
  readonly testCommand: CommandSpec;
  readonly typeCheckCommand: CommandSpec | null;
  readonly implementerCommand: CommandSpec | null;
  readonly state: string;
  readonly promptFile: string;
  readonly fenceArtifact: string;
  readonly results: string;
  readonly program: string;
  readonly benchmarkDir: string;
  readonly thresholds: { readonly fenceLB: number };
  readonly weights: {
    readonly dL: number;
    readonly dCx: number;
    readonly dDup: number;
    readonly scaleL: number;
    readonly scaleCx: number;
    readonly scaleDup: number;
    readonly r3: number;
    readonly [extra: string]: number;
  };
  readonly proposerBudgetUsd: string;
  readonly proposerTimeoutMs: number;
}

/** Slugify a path/identifier for use in branch/worktree/state names. */
export const slug = (value: unknown): string =>
  String(value)
    .replace(/^\.?\/*/, "")
    .replace(/\/+$/, "")
    .replace(/[^A-Za-z0-9_.-]+/g, "-") || "root";

/** A test file (RULE-033): `.test`/`.spec` of a JS/TS extension, excluding `.d.ts`. */
const isTestPath = (p: string): boolean =>
  /\.(test|spec)\.[jt]sx?$/.test(p) && !p.endsWith(".d.ts");

/** A source file (RULE-033): JS/TS extension, not a declaration, not a test/accept file. */
export const isSourceFile = (p: string): boolean =>
  /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p) && !p.endsWith(".d.ts") && !/\.(test|spec|accept)\./.test(p);

/** True iff `path` is `srcDir` itself or sits beneath it. */
export const isUnderSourceDir = (path: string, srcDir: string): boolean =>
  srcDir === "." || path === srcDir || path.startsWith(`${srcDir}/`);

export const programPathFromModuleUrl = (moduleUrl: string): string =>
  fileURLToPath(new URL("./program.md", moduleUrl));

const runtimeModuleUrl = (moduleUrl: string | undefined): string => {
  if (moduleUrl) {
    return moduleUrl;
  }
  if (process.argv[1]) {
    return pathToFileURL(realpathSync(process.argv[1])).href;
  }
  const cwdUrl = pathToFileURL(`${realpathSync(process.cwd())}/`).href;
  return cwdUrl.endsWith("/") ? cwdUrl : `${cwdUrl}/`;
};

export function stripSourcePrefix(target: string, srcDir: string): string {
  const normalizedTarget = target.replace(/\/+$/u, "");
  const normalizedSrc = srcDir.replace(/\/+$/u, "");
  if (srcDir === "." || normalizedTarget === "." || normalizedTarget === normalizedSrc) {
    return normalizedTarget === normalizedSrc ? "" : normalizedTarget;
  }
  return normalizedTarget.startsWith(`${normalizedSrc}/`)
    ? normalizedTarget.slice(normalizedSrc.length + 1)
    : normalizedTarget;
}

/** Which region a path belongs to (RULE-034): the first path segment under `srcDir`. */
export const regionOf = (p: string, srcDir = "src"): string => {
  if (srcDir === ".") {
    return p.includes("/") ? p.split("/")[0] : ".";
  }
  const rel = p.startsWith(`${srcDir}/`) ? p.slice(srcDir.length + 1) : p;
  return rel.includes("/") ? rel.split("/")[0] : srcDir;
};

function detectTestCommand(repo: string): CommandSpec {
  if (existsSync(`${repo}/node_modules/.bin/vitest`)) {
    return { file: "node_modules/.bin/vitest", args: ["run", "--reporter=dot"] };
  }
  if (existsSync(`${repo}/node_modules/.bin/jest`)) {
    return { file: "node_modules/.bin/jest" };
  }
  if (existsSync(`${repo}/node_modules/.bin/mocha`)) {
    return { file: "node_modules/.bin/mocha" };
  }
  if (existsSync(`${repo}/node_modules/.bin/ava`)) {
    return { file: "node_modules/.bin/ava" };
  }
  const pkg = readJson<{ packageManager?: string }>(`${repo}/package.json`);
  const usesBun =
    existsSync(`${repo}/bun.lock`) ||
    existsSync(`${repo}/bun.lockb`) ||
    (pkg?.packageManager?.startsWith("bun@") ?? false);
  if (usesBun) {
    return { file: "bun", args: ["test"] };
  }
  const pm = existsSync(`${repo}/pnpm-lock.yaml`)
    ? "pnpm"
    : existsSync(`${repo}/yarn.lock`)
      ? "yarn"
      : "npm";
  return { file: pm, args: ["test"] };
}

function detectTypeCheck(repo: string): CommandSpec | null {
  if (existsSync(`${repo}/tsconfig.json`) && existsSync(`${repo}/node_modules/.bin/tsc`)) {
    return { file: "node_modules/.bin/tsc", args: ["-p", "tsconfig.json", "--noEmit"] };
  }
  return null;
}

function sourceFileCount(dir: string): number {
  try {
    return readdirSync(dir, { withFileTypes: true }).reduce((count, entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        return IGNORED_SOURCE_DIRS.has(entry.name) ? count : count + sourceFileCount(path);
      }
      return count + (entry.isFile() && isSourceFile(entry.name) ? 1 : 0);
    }, 0);
  } catch {
    return 0;
  }
}

const hasSourceFile = (dir: string): boolean => sourceFileCount(dir) > 0;

function hasTestFile(dir: string): boolean {
  try {
    return readdirSync(dir, { withFileTypes: true }).some((entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        return IGNORED_SOURCE_DIRS.has(entry.name) ? false : hasTestFile(path);
      }
      return entry.isFile() && isTestPath(entry.name);
    });
  } catch {
    return false;
  }
}

function detectTestLayout(repo: string, srcDir: string): { roots: string[]; description: string } {
  const candidates = ["test", "tests"];
  if (srcDir !== "." && srcDir.includes("/")) {
    const pkgRoot = srcDir.split("/").slice(0, -1).join("/");
    candidates.push(`${pkgRoot}/test`, `${pkgRoot}/tests`);
  }
  for (const root of candidates) {
    if (hasTestFile(`${repo}/${root}`)) {
      return { roots: [root], description: `${root}/**/*.(test|spec).[jt]s(x)` };
    }
  }
  const root = srcDir === "." ? "." : srcDir;
  return {
    roots: [root],
    description:
      root === "."
        ? "co-located **/*.(test|spec).[jt]s(x) files"
        : `${root}/**/*.(test|spec).[jt]s(x)`,
  };
}

const cleanDir = (dir: string): string => dir.replace(/^\.\//, "").replace(/\/+$/, "") || ".";

function includeBase(pattern: string): string {
  const beforeGlob = pattern.split(/[*?{]/u)[0] ?? "";
  const cleaned = cleanDir(beforeGlob);
  if (/\.[A-Za-z0-9]+$/.test(cleaned)) {
    const parts = cleaned.split("/");
    parts.pop();
    return cleanDir(parts.join("/"));
  }
  return cleaned;
}

function packageHintPaths(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(packageHintPaths);
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(packageHintPaths);
  }
  return [];
}

function detectSrcDir(repo: string): string {
  const tsconfig = readJson<{ compilerOptions?: { rootDir?: string }; include?: string[] }>(
    `${repo}/tsconfig.json`,
  );
  const tsconfigCandidates: string[] = [];
  const rootDir = tsconfig?.compilerOptions?.rootDir;
  if (rootDir) {
    tsconfigCandidates.push(cleanDir(rootDir));
  }
  for (const pattern of tsconfig?.include ?? []) {
    tsconfigCandidates.push(includeBase(pattern));
  }
  const tsconfigSource = tsconfigCandidates
    .map((candidate) => ({ candidate, count: sourceFileCount(`${repo}/${candidate}`) }))
    .filter(({ count }) => count > 0)
    .toSorted((left, right) => right.count - left.count)[0];
  const conventionalSource = ["src", "lib", "app", "source"]
    .map((candidate) => ({ candidate, count: sourceFileCount(`${repo}/${candidate}`) }))
    .find(({ count }) => count > 0);
  if (tsconfigSource && (!conventionalSource || tsconfigSource.count >= conventionalSource.count)) {
    return tsconfigSource.candidate;
  }
  const pkg = readJson<{ source?: unknown }>(`${repo}/package.json`);
  for (const hint of [pkg?.source].flatMap(packageHintPaths)) {
    const candidate = includeBase(hint);
    if (candidate !== "." && hasSourceFile(`${repo}/${candidate}`)) {
      return candidate;
    }
  }
  if (conventionalSource) {
    return conventionalSource.candidate;
  }
  return hasSourceFile(repo) ? "." : "src";
}

/** Source regions: immediate subdirectories of `srcDir` with non-test source (RULE-034). */
function detectRegions(repo: string, srcDir: string): string[] {
  const root = `${repo}/${srcDir}`;
  if (!existsSync(root)) {
    return [];
  }
  try {
    const nested = readdirSync(root)
      .filter((name) => !IGNORED_SOURCE_DIRS.has(name))
      .filter((name) => {
        try {
          return statSync(`${root}/${name}`).isDirectory() && hasSourceFile(`${root}/${name}`);
        } catch {
          return false;
        }
      })
      .toSorted();
    if (nested.length > 0) {
      return nested;
    }
    return hasSourceFile(root) ? [srcDir] : [];
  } catch {
    return [];
  }
}

const normalizeRegions = (regions: string[]): string[] =>
  regions.map((region) => region.trim()).filter(Boolean);

function weightOverrides(source: string, value: unknown): Record<string, number> {
  if (value === undefined) {
    return {};
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${source} must be a JSON object of finite numeric weights`);
  }
  const overrides: Record<string, number> = {};
  for (const [key, weight] of Object.entries(value)) {
    if (typeof weight !== "number" || !Number.isFinite(weight)) {
      throw new Error(`${source} weight ${key} must be a finite number`);
    }
    overrides[key] = weight;
  }
  return overrides;
}

function envWeightOverrides(value: string | undefined): Record<string, number> {
  if (value == null) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("CN_WEIGHTS must be valid JSON object of finite numeric weights");
  }
  return weightOverrides("CN_WEIGHTS", parsed);
}

function parseArgsJson(source: string, value: string | undefined): readonly string[] | undefined {
  if (value == null || value === "") {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${source} must be a JSON array of strings`);
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error(`${source} must be a JSON array of strings`);
  }
  return parsed;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

function commandSpec(source: string, value: unknown): CommandSpec {
  if (typeof value === "string") {
    throw new Error(`${source} no longer accepts shell strings; use { "file": "...", "args": [...] }`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${source} must be a command object with file and optional args`);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.file !== "string" || record.file.trim().length === 0) {
    throw new Error(`${source}.file must be a non-empty string`);
  }
  if (record.args !== undefined && !isStringArray(record.args)) {
    throw new Error(`${source}.args must be an array of strings`);
  }
  if (
    record.timeoutMs !== undefined &&
    (typeof record.timeoutMs !== "number" ||
      !Number.isFinite(record.timeoutMs) ||
      record.timeoutMs <= 0)
  ) {
    throw new Error(`${source}.timeoutMs must be a finite positive number`);
  }
  if (record.env !== undefined && !isStringRecord(record.env)) {
    throw new Error(`${source}.env must be an object of string values`);
  }
  return {
    file: record.file,
    ...(record.args ? { args: record.args } : {}),
    ...(record.timeoutMs ? { timeoutMs: record.timeoutMs } : {}),
    ...(record.env ? { env: record.env } : {}),
  };
}

function envCommandSpec(
  env: Env,
  prefix: "CN_TEST" | "CN_TYPECHECK" | "CN_IMPLEMENTER",
): CommandSpec | undefined {
  const old = env[prefix];
  if (old !== undefined) {
    throw new Error(`${prefix} no longer accepts shell strings; use ${prefix}_FILE and optional ${prefix}_ARGS_JSON`);
  }
  const file = env[`${prefix}_FILE`];
  const args = parseArgsJson(`${prefix}_ARGS_JSON`, env[`${prefix}_ARGS_JSON`]);
  if (!file && args) {
    throw new Error(`${prefix}_FILE is required when ${prefix}_ARGS_JSON is set`);
  }
  return file ? { file, ...(args ? { args } : {}) } : undefined;
}

function fileCommandSpec(
  fileCfg: Record<string, unknown>,
  key: "testCommand" | "typeCheckCommand" | "implementerCommand",
): CommandSpec | undefined {
  return fileCfg[key] === undefined ? undefined : commandSpec(key, fileCfg[key]);
}

function numericSetting(
  source: string,
  value: unknown,
  bounds: { min?: number; max?: number; minExclusive?: number } = {},
): number {
  if (value === null || value === "" || (typeof value === "object" && value !== null)) {
    throw new Error(`${source} must be a finite number`);
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (
    !Number.isFinite(parsed) ||
    (bounds.min !== undefined && parsed < bounds.min) ||
    (bounds.max !== undefined && parsed > bounds.max) ||
    (bounds.minExclusive !== undefined && parsed <= bounds.minExclusive)
  ) {
    const range =
      bounds.minExclusive !== undefined
        ? `> ${bounds.minExclusive}`
        : bounds.min !== undefined && bounds.max !== undefined
          ? `between ${bounds.min} and ${bounds.max}`
          : bounds.min !== undefined
            ? `>= ${bounds.min}`
            : "finite";
    throw new Error(`${source} must be a finite number ${range}`);
  }
  return parsed;
}

/** Resolve the full configuration for a repo (RULE-033/034 + scoring defaults). */
export function loadConfig(env: Env = process.env, cwd: string = process.cwd()): Config {
  if (env.CN_PROPOSER !== undefined) {
    throw new Error("CN_PROPOSER no longer accepts shell strings; use the default Codex SDK proposer");
  }
  if (env.CN_IMPLEMENTER !== undefined) {
    throw new Error("CN_IMPLEMENTER no longer accepts shell strings; use CN_IMPLEMENTER_FILE and optional CN_IMPLEMENTER_ARGS_JSON");
  }
  const cwdFileCfg = readJson<Record<string, unknown>>(`${cwd}/codenuke.loop.json`) ?? {};
  const configuredRepo = env.CN_REPO ?? (cwdFileCfg.repo as string | undefined) ?? cwd;
  const repoFileCfg =
    configuredRepo === cwd
      ? cwdFileCfg
      : (readJson<Record<string, unknown>>(`${configuredRepo}/codenuke.loop.json`) ?? {});
  const fileCfg = env.CN_REPO ? repoFileCfg : { ...repoFileCfg, ...cwdFileCfg };
  const pick = (envKey: string, cfgKey: string, dflt: string): string =>
    env[envKey] ?? (fileCfg[cfgKey] as string | undefined) ?? dflt;

  const repo = pick("CN_REPO", "repo", cwd);
  const srcDir = pick("CN_SRC", "srcDir", detectSrcDir(repo));
  const testLayout = detectTestLayout(repo, srcDir);
  const target = pick("CN_TARGET", "target", `${srcDir}/`);
  const baseline = pick("CN_BASE", "baseline", "HEAD");
  const tag = pick("CN_TAG", "tag", "run");
  const region = slug(stripSourcePrefix(target, srcDir) || target);
  const envRegions =
    env.CN_REGIONS == null ? undefined : normalizeRegions(env.CN_REGIONS.split(","));
  const fileRegions = Array.isArray(fileCfg.regions)
    ? normalizeRegions(fileCfg.regions as string[])
    : undefined;
  const regions = envRegions ?? fileRegions ?? detectRegions(repo, srcDir);
  const wt = pick("CN_WORKTREE", "worktree", `/tmp/codenuke-${slug(tag)}-${region}`);
  const fenceLB = numericSetting("fenceLB", env.CN_FENCE_LB ?? fileCfg.fenceLB ?? 0.9, {
    min: 0,
    max: 1,
  });
  const proposerTimeoutMs = numericSetting(
    "proposerTimeoutMs",
    env.CN_TIMEOUT ?? fileCfg.proposerTimeoutMs ?? 900000,
    { minExclusive: 0 },
  );

  return {
    repo,
    srcDir,
    target,
    region,
    regions,
    testLayout,
    baseline,
    tag,
    branch: `autoresearch/${tag}`,
    worktree: wt,
    testCommand:
      envCommandSpec(env, "CN_TEST") ??
      fileCommandSpec(fileCfg, "testCommand") ??
      detectTestCommand(repo),
    typeCheckCommand:
      envCommandSpec(env, "CN_TYPECHECK") ??
      fileCommandSpec(fileCfg, "typeCheckCommand") ??
      detectTypeCheck(repo),
    implementerCommand:
      envCommandSpec(env, "CN_IMPLEMENTER") ??
      fileCommandSpec(fileCfg, "implementerCommand") ??
      null,
    state: pick("CN_STATE", "state", `/tmp/codenuke-${slug(tag)}-${region}.state.json`),
    promptFile: `/tmp/codenuke-${slug(tag)}-${region}.prompt.txt`,
    fenceArtifact: pick("CN_FENCE", "fenceArtifact", `${repo}/.codenuke/fence-fidelity.json`),
    results: pick("CN_RESULTS", "results", `${repo}/.codenuke/results.tsv`),
    program: pick(
      "CN_PROGRAM",
      "program",
      programPathFromModuleUrl(runtimeModuleUrl(import.meta.url)),
    ),
    benchmarkDir: pick("CN_BENCH", "benchmarkDir", `${repo}/codenuke.benchmark`),
    thresholds: { fenceLB },
    weights: {
      dL: 1.0,
      dCx: 1.8,
      dDup: 0.35,
      scaleL: 150,
      scaleCx: 15,
      scaleDup: 5,
      r3: 1.0,
      ...weightOverrides("weights", fileCfg.weights),
      ...envWeightOverrides(env.CN_WEIGHTS),
    },
    proposerBudgetUsd: pick("CN_BUDGET", "proposerBudgetUsd", "8"),
    proposerTimeoutMs,
  };
}
