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

function detectTestCommand(repo) {
  if (existsSync(`${repo}/node_modules/.bin/vitest`))
    return "node_modules/.bin/vitest run --reporter=dot";
  if (existsSync(`${repo}/node_modules/.bin/jest`)) return "node_modules/.bin/jest";
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

// Source regions = immediate subdirectories of srcDir that contain non-test source.
function detectRegions(repo, srcDir) {
  const root = `${repo}/${srcDir}`;
  if (!existsSync(root)) return [];
  const isSrc = (p) =>
    /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p) &&
    !/\.d\.ts$/.test(p) &&
    !/\.(test|spec|accept)\./.test(p);
  const hasSource = (dir) => {
    try {
      return readdirSync(dir, { recursive: true }).some((f) => isSrc(String(f)));
    } catch {
      return false;
    }
  };
  try {
    return readdirSync(root)
      .filter((name) => {
        try {
          return statSync(`${root}/${name}`).isDirectory() && hasSource(`${root}/${name}`);
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [];
  }
}

export function loadConfig(env = process.env, cwd = process.cwd()) {
  const fileCfg = (() => {
    try {
      return JSON.parse(readFileSync(`${cwd}/codenuke.loop.json`, "utf8"));
    } catch {
      return {};
    }
  })();
  const pick = (envKey, cfgKey, dflt) => env[envKey] ?? fileCfg[cfgKey] ?? dflt;

  const repo = pick("CN_REPO", "repo", cwd);
  const srcDir = pick("CN_SRC", "srcDir", "src");
  const target = pick("CN_TARGET", "target", `${srcDir}/`);
  const baseline = pick("CN_BASE", "baseline", "HEAD");
  const tag = pick("CN_TAG", "tag", "run");
  const region = slug(target.replace(new RegExp(`^${srcDir}/?`), "") || target);
  const regions = env.CN_REGIONS?.split(",") ?? fileCfg.regions ?? detectRegions(repo, srcDir);
  const wt = pick("CN_WORKTREE", "worktree", `/tmp/codenuke-${slug(tag)}-${region}`);

  return {
    repo,
    srcDir,
    target, // the region the proposer reduces, e.g. "src/" or "src/mappers/"
    region, // slug of target, used to look up its fence in the artifact
    regions, // all source regions, for the fence audit
    baseline, // git ref to start the run from (HEAD by default)
    tag,
    branch: `autoresearch/${tag}`,
    worktree: wt,
    testCommand: pick("CN_TEST", "testCommand", detectTestCommand(repo)),
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

export const regionOf = (p, srcDir = "src") =>
  p.replace(new RegExp(`^${srcDir}/`), "").split("/")[0];
export const isSourceFile = (p) =>
  /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p) && !/\.d\.ts$/.test(p) && !/\.(test|spec|accept)\./.test(p);
export { slug, sh };
