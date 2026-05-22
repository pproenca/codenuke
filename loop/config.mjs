// codenuke loop — configuration (repo-agnostic).
//
// Everything the engine needs to run on ANY TypeScript repo, resolved from (in order):
//   1. environment (CN_REPO, CN_SRC, CN_TARGET, CN_BASE, CN_TAG, CN_TEST, CN_TYPECHECK, CN_FENCE)
//   2. a codenuke.loop.json file at the repo root
//   3. auto-detection (package manager, test runner, tsc, source regions)
//
// No machine-specific paths, no pinned commits, no fixed module names — those were the
// codenuke-only assumptions of the research prototype.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";

const slug = (v) =>
  String(v)
    .replace(/^\.?\/*/, "")
    .replace(/\/+$/, "")
    .replace(/[^A-Za-z0-9_.-]+/g, "-") || "root";
const sh = (cmd, cwd) => {
  try {
    return execSync(cmd, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString();
  } catch {
    return "";
  }
};

function commandAvailable(command, cwd, env) {
  try {
    execSync(`command -v ${JSON.stringify(command)}`, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function detectTestCommand(repo, env = process.env) {
  if (existsSync(`${repo}/node_modules/.bin/vitest`))
    return "node_modules/.bin/vitest run --reporter=dot";
  if (existsSync(`${repo}/node_modules/.bin/jest`)) return "node_modules/.bin/jest";
  if (existsSync(`${repo}/node_modules/.bin/mocha`)) return "node_modules/.bin/mocha";
  if (existsSync(`${repo}/node_modules/.bin/ava`)) return "node_modules/.bin/ava";
  if (commandAvailable("bun", repo, env)) return "bun test";
  const pm = existsSync(`${repo}/pnpm-lock.yaml`)
    ? "pnpm"
    : existsSync(`${repo}/yarn.lock`)
      ? "yarn"
      : "npm";
  return `${pm} test`;
}

function detectTypeCheck(repo) {
  if (existsSync(`${repo}/tsconfig.json`) && existsSync(`${repo}/node_modules/.bin/tsc`)) {
    return "node_modules/.bin/tsc -p tsconfig.json --noEmit";
  }
  return null; // no type gate (G3) if the repo isn't TS-typechecked
}

const isSourcePath = (p) =>
  /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p) && !/\.d\.ts$/.test(p) && !/\.(test|spec|accept)\./.test(p);

function hasSourceFile(dir) {
  try {
    return readdirSync(dir, { recursive: true }).some((f) => isSourcePath(String(f)));
  } catch {
    return false;
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

const cleanDir = (dir) => String(dir).replace(/^\.\//, "").replace(/\/+$/, "") || ".";

function includeBase(pattern) {
  const beforeGlob = String(pattern).split(/[*?{]/u)[0] ?? "";
  const cleaned = cleanDir(beforeGlob);
  if (/\.[A-Za-z0-9]+$/.test(cleaned)) {
    const parts = cleaned.split("/");
    parts.pop();
    return cleanDir(parts.join("/"));
  }
  return cleaned;
}

function packageHintPaths(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(packageHintPaths);
  if (value && typeof value === "object") return Object.values(value).flatMap(packageHintPaths);
  return [];
}

function detectSrcDir(repo) {
  const tsconfig = readJson(`${repo}/tsconfig.json`);
  const rootDir = tsconfig?.compilerOptions?.rootDir;
  if (rootDir && hasSourceFile(`${repo}/${rootDir}`)) return cleanDir(rootDir);
  for (const pattern of tsconfig?.include ?? []) {
    const candidate = includeBase(pattern);
    if (hasSourceFile(`${repo}/${candidate}`)) return candidate;
  }

  const pkg = readJson(`${repo}/package.json`);
  const packageHints = [pkg?.source].flatMap(packageHintPaths);
  for (const hint of packageHints) {
    const candidate = includeBase(hint);
    if (candidate !== "." && hasSourceFile(`${repo}/${candidate}`)) return candidate;
  }

  for (const candidate of ["src", "lib", "app", "source"]) {
    if (hasSourceFile(`${repo}/${candidate}`)) return candidate;
  }
  return hasSourceFile(repo) ? "." : "src";
}

// Source regions = immediate subdirectories of srcDir that contain non-test source.
function detectRegions(repo, srcDir) {
  const root = `${repo}/${srcDir}`;
  if (!existsSync(root)) return [];
  try {
    const nested = readdirSync(root)
      .filter((name) => {
        try {
          return statSync(`${root}/${name}`).isDirectory() && hasSourceFile(`${root}/${name}`);
        } catch {
          return false;
        }
      })
      .sort();
    if (nested.length > 0) return nested;
    return hasSourceFile(root) ? [srcDir] : [];
  } catch {
    return [];
  }
}

function normalizeRegions(regions) {
  return regions.map((region) => String(region).trim()).filter(Boolean);
}

export function loadConfig(env = process.env, cwd = process.cwd()) {
  const cwdFileCfg = readJson(`${cwd}/codenuke.loop.json`) ?? {};
  const configuredRepo = env.CN_REPO ?? cwdFileCfg.repo ?? cwd;
  const repoFileCfg =
    configuredRepo === cwd ? cwdFileCfg : (readJson(`${configuredRepo}/codenuke.loop.json`) ?? {});
  const fileCfg = env.CN_REPO ? repoFileCfg : { ...repoFileCfg, ...cwdFileCfg };
  const pick = (envKey, cfgKey, dflt) => env[envKey] ?? fileCfg[cfgKey] ?? dflt;

  const repo = pick("CN_REPO", "repo", cwd);
  const srcDir = pick("CN_SRC", "srcDir", detectSrcDir(repo));
  const target = pick("CN_TARGET", "target", `${srcDir}/`);
  const baseline = pick("CN_BASE", "baseline", "HEAD");
  const tag = pick("CN_TAG", "tag", "run");
  const region = slug(target.replace(new RegExp(`^${srcDir}/?`), "") || target);
  const envRegions =
    env.CN_REGIONS == null ? undefined : normalizeRegions(env.CN_REGIONS.split(","));
  const fileRegions = Array.isArray(fileCfg.regions)
    ? normalizeRegions(fileCfg.regions)
    : undefined;
  const regions = envRegions ?? fileRegions ?? detectRegions(repo, srcDir);
  const wt = pick("CN_WORKTREE", "worktree", `/tmp/codenuke-${slug(tag)}-${region}`);

  return {
    repo,
    srcDir,
    target, // optional region filter; "<srcDir>/" means all detected regions
    region, // slug of target, used to look up its fence in the artifact
    regions, // all source regions, for the fence audit
    baseline, // git ref to start the run from (HEAD by default)
    tag,
    branch: `autoresearch/${tag}`,
    worktree: wt,
    testCommand: pick("CN_TEST", "testCommand", detectTestCommand(repo, env)),
    typeCheckCommand: env.CN_TYPECHECK ?? fileCfg.typeCheckCommand ?? detectTypeCheck(repo),
    // periodic-audit artifacts + loop state (kept OUTSIDE the worktree)
    state: pick("CN_STATE", "state", `/tmp/codenuke-${slug(tag)}-${region}.state.json`),
    promptFile: `/tmp/codenuke-${slug(tag)}-${region}.prompt.txt`,
    fenceArtifact: pick("CN_FENCE", "fenceArtifact", `${repo}/.codenuke/fence-fidelity.json`),
    results: pick("CN_RESULTS", "results", `${repo}/.codenuke/results.tsv`),
    program: pick("CN_PROGRAM", "program", new URL("./program.md", import.meta.url).pathname),
    benchmarkDir: pick("CN_BENCH", "benchmarkDir", `${repo}/codenuke.benchmark`), // committable (val-set)
    // thresholds + value weights (calibrated; see docs/spec.md)
    thresholds: { fenceLB: Number(env.CN_FENCE_LB ?? fileCfg.fenceLB ?? 0.9) },
    weights: { dL: 1.0, dCx: 1.8, dDup: 0.35, scaleL: 150, scaleCx: 15, scaleDup: 5, r3: 1.0 },
    proposerBudgetUsd: pick("CN_BUDGET", "proposerBudgetUsd", "1.50"),
  };
}

export const regionOf = (p, srcDir = "src") => {
  if (srcDir === ".") return ".";
  const rel = p.startsWith(`${srcDir}/`) ? p.slice(srcDir.length + 1) : p;
  return rel.includes("/") ? rel.split("/")[0] : srcDir;
};
export const isSourceFile = (p) =>
  /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p) && !/\.d\.ts$/.test(p) && !/\.(test|spec|accept)\./.test(p);
export { slug, sh };
