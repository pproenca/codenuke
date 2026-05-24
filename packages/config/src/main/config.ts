/**
 * codenuke configuration (repo-agnostic). Resolved, in order, from:
 *   1. environment (CN_REPO, CN_SRC, CN_TARGET, CN_BASE, CN_TAG, CN_TEST, …)
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
import { readJson } from "@codenuke/json";
import { commandAvailable } from "@codenuke/exec";

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
  readonly testCommand: string;
  readonly typeCheckCommand: string | null;
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
const isTestPath = (p: string): boolean => /\.(test|spec)\.[jt]sx?$/.test(p) && !p.endsWith(".d.ts");

/** A source file (RULE-033): JS/TS extension, not a declaration, not a test/accept file. */
export const isSourceFile = (p: string): boolean =>
  /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p) && !p.endsWith(".d.ts") && !/\.(test|spec|accept)\./.test(p);

/** True iff `path` is `srcDir` itself or sits beneath it. */
export const isUnderSourceDir = (path: string, srcDir: string): boolean =>
  srcDir === "." || path === srcDir || path.startsWith(`${srcDir}/`);

export const programPathFromModuleUrl = (moduleUrl: string): string =>
  fileURLToPath(new URL("./program.md", moduleUrl));

const runtimeModuleUrl = (moduleUrl: string | undefined): string => {
  if (moduleUrl) return moduleUrl;
  if (process.argv[1]) return pathToFileURL(realpathSync(process.argv[1])).href;
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
  if (srcDir === ".") return p.includes("/") ? p.split("/")[0]! : ".";
  const rel = p.startsWith(`${srcDir}/`) ? p.slice(srcDir.length + 1) : p;
  return rel.includes("/") ? rel.split("/")[0]! : srcDir;
};

function detectTestCommand(repo: string, env: Env): string {
  if (existsSync(`${repo}/node_modules/.bin/vitest`)) return "node_modules/.bin/vitest run --reporter=dot";
  if (existsSync(`${repo}/node_modules/.bin/jest`)) return "node_modules/.bin/jest";
  if (existsSync(`${repo}/node_modules/.bin/mocha`)) return "node_modules/.bin/mocha";
  if (existsSync(`${repo}/node_modules/.bin/ava`)) return "node_modules/.bin/ava";
  const pkg = readJson<{ packageManager?: string }>(`${repo}/package.json`);
  const usesBun =
    existsSync(`${repo}/bun.lock`) ||
    existsSync(`${repo}/bun.lockb`) ||
    String(pkg?.packageManager ?? "").startsWith("bun@");
  if (usesBun && commandAvailable("bun", { cwd: repo, env })) return "bun test";
  const pm = existsSync(`${repo}/pnpm-lock.yaml`)
    ? "pnpm"
    : existsSync(`${repo}/yarn.lock`)
      ? "yarn"
      : "npm";
  return `${pm} test`;
}

function detectTypeCheck(repo: string): string | null {
  if (existsSync(`${repo}/tsconfig.json`) && existsSync(`${repo}/node_modules/.bin/tsc`)) {
    return "node_modules/.bin/tsc -p tsconfig.json --noEmit";
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
      root === "." ? "co-located **/*.(test|spec).[jt]s(x) files" : `${root}/**/*.(test|spec).[jt]s(x)`,
  };
}

const cleanDir = (dir: string): string => String(dir).replace(/^\.\//, "").replace(/\/+$/, "") || ".";

function includeBase(pattern: string): string {
  const beforeGlob = String(pattern).split(/[*?{]/u)[0] ?? "";
  const cleaned = cleanDir(beforeGlob);
  if (/\.[A-Za-z0-9]+$/.test(cleaned)) {
    const parts = cleaned.split("/");
    parts.pop();
    return cleanDir(parts.join("/"));
  }
  return cleaned;
}

function packageHintPaths(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(packageHintPaths);
  if (value && typeof value === "object") return Object.values(value).flatMap(packageHintPaths);
  return [];
}

function detectSrcDir(repo: string): string {
  const tsconfig = readJson<{ compilerOptions?: { rootDir?: string }; include?: string[] }>(
    `${repo}/tsconfig.json`,
  );
  const tsconfigCandidates: string[] = [];
  const rootDir = tsconfig?.compilerOptions?.rootDir;
  if (rootDir) tsconfigCandidates.push(cleanDir(rootDir));
  for (const pattern of tsconfig?.include ?? []) tsconfigCandidates.push(includeBase(pattern));
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
    if (candidate !== "." && hasSourceFile(`${repo}/${candidate}`)) return candidate;
  }
  if (conventionalSource) return conventionalSource.candidate;
  return hasSourceFile(repo) ? "." : "src";
}

/** Source regions: immediate subdirectories of `srcDir` with non-test source (RULE-034). */
function detectRegions(repo: string, srcDir: string): string[] {
  const root = `${repo}/${srcDir}`;
  if (!existsSync(root)) return [];
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
    if (nested.length > 0) return nested;
    return hasSourceFile(root) ? [srcDir] : [];
  } catch {
    return [];
  }
}

const normalizeRegions = (regions: string[]): string[] =>
  regions.map((region) => String(region).trim()).filter(Boolean);

function weightOverrides(source: string, value: unknown): Record<string, number> {
  if (value === undefined) return {};
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
  if (value == null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("CN_WEIGHTS must be valid JSON object of finite numeric weights");
  }
  return weightOverrides("CN_WEIGHTS", parsed);
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
  const cwdFileCfg = readJson<Record<string, unknown>>(`${cwd}/codenuke.loop.json`) ?? {};
  const configuredRepo = (env.CN_REPO ?? (cwdFileCfg.repo as string | undefined) ?? cwd) as string;
  const repoFileCfg =
    configuredRepo === cwd
      ? cwdFileCfg
      : (readJson<Record<string, unknown>>(`${configuredRepo}/codenuke.loop.json`) ?? {});
  const fileCfg = env.CN_REPO ? repoFileCfg : { ...repoFileCfg, ...cwdFileCfg };
  const pick = (envKey: string, cfgKey: string, dflt: string): string =>
    (env[envKey] ?? (fileCfg[cfgKey] as string | undefined) ?? dflt) as string;

  const repo = pick("CN_REPO", "repo", cwd);
  const srcDir = pick("CN_SRC", "srcDir", detectSrcDir(repo));
  const testLayout = detectTestLayout(repo, srcDir);
  const target = pick("CN_TARGET", "target", `${srcDir}/`);
  const baseline = pick("CN_BASE", "baseline", "HEAD");
  const tag = pick("CN_TAG", "tag", "run");
  const region = slug(stripSourcePrefix(target, srcDir) || target);
  const envRegions = env.CN_REGIONS == null ? undefined : normalizeRegions(env.CN_REGIONS.split(","));
  const fileRegions = Array.isArray(fileCfg.regions)
    ? normalizeRegions(fileCfg.regions as string[])
    : undefined;
  const regions = envRegions ?? fileRegions ?? detectRegions(repo, srcDir);
  const wt = pick("CN_WORKTREE", "worktree", `/tmp/codenuke-${slug(tag)}-${region}`);
  const fenceLB = numericSetting("fenceLB", env.CN_FENCE_LB ?? fileCfg.fenceLB ?? 0.9, { min: 0, max: 1 });
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
    testCommand: pick("CN_TEST", "testCommand", detectTestCommand(repo, env)),
    typeCheckCommand:
      (env.CN_TYPECHECK as string | undefined) ??
      (fileCfg.typeCheckCommand as string | undefined) ??
      detectTypeCheck(repo),
    state: pick("CN_STATE", "state", `/tmp/codenuke-${slug(tag)}-${region}.state.json`),
    promptFile: `/tmp/codenuke-${slug(tag)}-${region}.prompt.txt`,
    fenceArtifact: pick("CN_FENCE", "fenceArtifact", `${repo}/.codenuke/fence-fidelity.json`),
    results: pick("CN_RESULTS", "results", `${repo}/.codenuke/results.tsv`),
    program: pick("CN_PROGRAM", "program", programPathFromModuleUrl(runtimeModuleUrl(import.meta.url))),
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
