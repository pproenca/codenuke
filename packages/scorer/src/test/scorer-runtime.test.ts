import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import * as scorer from "@codenuke/scorer";
import { measure, type Files } from "@codenuke/measure";
import { wilson } from "@codenuke/stats";

interface ScorerState {
  readonly baselineSha: string;
  readonly baselineTsc: number;
  readonly startL: number;
  readonly accepted: readonly string[];
  readonly iter: number;
}

interface ScorerGitCommandPlan {
  readonly resolveBaseline: readonly string[];
  readonly addWorktree: (ref: string) => readonly string[];
  readonly targetTree: (ref: string) => readonly string[];
  readonly changedSource: readonly string[];
  readonly addChangedSource: (paths: readonly string[]) => readonly string[];
  readonly cleanSource: readonly string[];
}

interface RuntimeResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface RuntimeApi {
  readonly scorerGitCommandPlan: (input: {
    readonly worktree: string;
    readonly ref: string;
    readonly target: string;
    readonly srcDir: string;
  }) => ScorerGitCommandPlan;
  readonly runScorerCommand: (
    args: readonly string[],
    env: Record<string, string | undefined>,
    cwd: string,
  ) => Promise<RuntimeResult>;
}

const created: string[] = [];

afterAll(() => {
  for (const path of created.reverse()) rmSync(path, { recursive: true, force: true });
});

function runtime<K extends keyof RuntimeApi>(name: K): RuntimeApi[K] {
  const value = (scorer as unknown as Record<string, unknown>)[name];
  if (typeof value !== "function") {
    throw new Error(`@codenuke/scorer must export runtime helper ${String(name)}`);
  }
  return value as RuntimeApi[K];
}

function fixtureRoot(name = "codenuke-scorer-"): string {
  const root = mkdtempSync(join(tmpdir(), name));
  created.push(root);
  return root;
}

function fixtureWorktree(name = "codenuke-scorer-wt-"): string {
  const parent = mkdtempSync(join(tmpdir(), name));
  created.push(parent);
  return join(parent, "worktree");
}

function write(root: string, path: string, contents: string): string {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
  return absolute;
}

function git(root: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function initRepo(root: string): void {
  git(root, ["init"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test User"]);
  git(root, ["config", "commit.gpgsign", "false"]);
}

function commit(root: string, message: string): string {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-m", message]);
  return git(root, ["rev-parse", "--verify", "HEAD"]).trim();
}

function script(root: string, name: string, contents: string): string {
  return write(root, `scripts/${name}.mjs`, contents);
}

function nodeCommand(path: string): string {
  return `node ${JSON.stringify(path)}`;
}

function readState(path: string): ScorerState {
  return JSON.parse(readFileSync(path, "utf8")) as ScorerState;
}

function writePassingFence(root: string, baselineSha: string): void {
  const stats = wilson(99, 100);
  write(root, ".codenuke/fence-fidelity.json", JSON.stringify({
    schemaVersion: 1,
    baseline: "HEAD",
    baselineSha,
    generatedAt: new Date().toISOString(),
    method: "ast-aware",
    threshold: 0.9,
    capPerRegion: 60,
    seed: 1337,
    regions: {
      src: {
        caught: 99,
        total: 100,
        p: stats.p,
        lo: stats.lo,
        hi: stats.hi,
        admissible: stats.lo >= 0.9,
        survivorSpecs: [{ rel: "src/index.ts", start: 0, end: 1, repl: "x", op: "replace" }],
      },
    },
  }, null, 2));
}

function awkwardSourceFiles(): Files {
  return {
    "src/line\nbreak.ts": "export function lineBreak() {\n  if (true) return 1;\n  return 2;\n}\n",
    'src/quote "module".ts': "export function quoted() {\n  if (true) return 1;\n  return 2;\n}\n",
    "src/space name.ts": "export function spaced() {\n  if (true) return 1;\n  return 2;\n}\n",
  };
}

function writeAwkwardSourceRepo(root: string): string {
  initRepo(root);
  write(root, "package.json", JSON.stringify({ name: "scorer-awkward-fixture" }, null, 2));
  for (const [path, contents] of Object.entries(awkwardSourceFiles())) write(root, path, contents);
  write(root, "src/skip.test.ts", "export function skipTest() {\n  if (true) return 1;\n  return 2;\n}\n");
  write(root, "src/types.d.ts", "export interface Skip {\n  value: string;\n}\n");
  write(root, "src/readme.md", "# ignored\n");
  return commit(root, "baseline with awkward source paths");
}

function baseEnv(
  root: string,
  worktree: string,
  extra: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  const pass = script(root, "pass.mjs", "process.exit(0);\n");
  return {
    ...process.env,
    CN_REPO: root,
    CN_SRC: "src",
    CN_TARGET: "src",
    CN_BASE: "HEAD",
    CN_TAG: `scorer-${Date.now()}`,
    CN_WORKTREE: worktree,
    CN_STATE: join(root, ".codenuke/scorer.state.json"),
    CN_FENCE: join(root, ".codenuke/fence-fidelity.json"),
    CN_TEST: nodeCommand(pass),
    CN_TYPECHECK: "",
    ...extra,
  };
}

function initializedRepo(): {
  root: string;
  worktree: string;
  env: Record<string, string | undefined>;
  baselineSha: string;
} {
  const root = fixtureRoot();
  initRepo(root);
  write(root, "package.json", JSON.stringify({ name: "scorer-fixture" }, null, 2));
  write(root, "src/index.ts", "export function value() {\n  if (true) return 1;\n  return 2;\n}\n");
  const baselineSha = commit(root, "baseline");
  const worktree = fixtureWorktree();
  return { root, worktree, env: baseEnv(root, worktree), baselineSha };
}

function parseJsonVerdict(stdout: string): Record<string, unknown> {
  const line = stdout.split(/\r?\n/u).find((entry) => entry.startsWith("@@JSON@@"));
  if (!line) throw new Error(`missing @@JSON@@ verdict in stdout:\n${stdout}`);
  return JSON.parse(line.slice("@@JSON@@".length)) as Record<string, unknown>;
}

describe("scorer runtime argv-vector and path-safety contract", () => {
  it("builds SHA-resolving, NUL-delimited git argv vectors with pathspec delimiters", () => {
    const scorerGitCommandPlan = runtime("scorerGitCommandPlan");
    const resolvedBaseline = "0123456789abcdef0123456789abcdef01234567";

    const plan = scorerGitCommandPlan({
      worktree: "/tmp/codenuke-wt",
      ref: "feature/reduce-1",
      target: "src",
      srcDir: "src",
    });

    expect(plan.resolveBaseline).toEqual(["rev-parse", "--verify", "--end-of-options", "feature/reduce-1"]);
    expect(plan.addWorktree(resolvedBaseline)).toEqual(["worktree", "add", "-f", "/tmp/codenuke-wt", resolvedBaseline]);
    expect(plan.targetTree(resolvedBaseline)).toEqual([
      "ls-tree",
      "-r",
      "-z",
      "--name-only",
      resolvedBaseline,
      "--",
      "src",
    ]);
    expect(plan.changedSource).toEqual(["diff", "-z", "--name-only", "HEAD", "--", "src"]);
    expect(plan.addChangedSource(["src/-dash.ts", "src/$(touch owned).ts"])).toEqual([
      "add",
      "-A",
      "--",
      "src/-dash.ts",
      "src/$(touch owned).ts",
    ]);
    expect(plan.cleanSource).toEqual(["clean", "-fdq", "--", "src"]);
    expect(() => plan.addWorktree("HEAD")).toThrow("resolved git SHA for scorer");
    expect(() => plan.targetTree("--glob=refs/heads/*")).toThrow("resolved git SHA for scorer");

    expect(() =>
      scorerGitCommandPlan({
        worktree: "/tmp/codenuke-wt",
        ref: "--glob=refs/heads/*",
        target: "src",
        srcDir: "src",
      }),
    ).toThrow("unsafe git ref for scorer");
    expect(() =>
      scorerGitCommandPlan({
        worktree: "/tmp/codenuke-wt",
        ref: "HEAD",
        target: ":(glob)**/*.ts",
        srcDir: "src",
      }),
    ).toThrow("unsafe target path for scorer");
    expect(() =>
      scorerGitCommandPlan({
        worktree: "/tmp/codenuke-wt",
        ref: "HEAD",
        target: "src",
        srcDir: "../src",
      }),
    ).toThrow("unsafe source path for scorer");
  });
});

describe("scorer runtime git source discovery", () => {
  it("measures baseline target sources from NUL-delimited ls-tree output, preserving awkward filenames", async () => {
    const root = fixtureRoot("codenuke-scorer-ls-tree-");
    const baselineSha = writeAwkwardSourceRepo(root);
    const worktree = fixtureWorktree("codenuke-scorer-ls-tree-wt-");
    const env = baseEnv(root, worktree, { CN_BASE: baselineSha, CN_TARGET: "src" });
    const runScorerCommand = runtime("runScorerCommand");

    const result = await runScorerCommand(["init"], env, root);
    const state = readState(env.CN_STATE!);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(state.startL).toBe(measure(awkwardSourceFiles()).L);
  });

  it("discovers changed sources from NUL-delimited diff output, preserving awkward filenames and filtering non-source paths", async () => {
    const root = fixtureRoot("codenuke-scorer-diff-");
    const baselineSha = writeAwkwardSourceRepo(root);
    const worktree = fixtureWorktree("codenuke-scorer-diff-wt-");
    const env = baseEnv(root, worktree, { CN_BASE: baselineSha, CN_TARGET: "src" });
    const runScorerCommand = runtime("runScorerCommand");
    expect((await runScorerCommand(["init"], env, root)).exitCode).toBe(0);
    writePassingFence(root, baselineSha);

    write(worktree, "src/line\nbreak.ts", "export const lineBreak = 1;\n");
    write(worktree, 'src/quote "module".ts', "export const quoted = 1;\n");
    write(worktree, "src/space name.ts", "export const spaced = 1;\n");
    write(worktree, "src/skip.test.ts", "export const skipTest = 1;\n");
    write(worktree, "src/types.d.ts", "export type Skip = string;\n");
    write(worktree, "src/readme.md", "ignored\n");

    const result = await runScorerCommand(["score", "--json"], env, root);
    const verdict = parseJsonVerdict(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(verdict.files).toEqual([
      "line\nbreak.ts",
      'quote "module".ts',
      "space name.ts",
    ]);
    expect(verdict.touched).toEqual(["src"]);
  });
});

describe("runScorerCommand init lifecycle", () => {
  it("creates an isolated worktree and writes baseline state with type errors, AST size, accepted, and iter", async () => {
    const root = fixtureRoot();
    initRepo(root);
    write(root, "src/index.ts", "export function value() {\n  if (true) return 1;\n  return 2;\n}\n");
    commit(root, "baseline");
    const worktree = fixtureWorktree();
    const typecheck = script(
      root,
      "typecheck-red.mjs",
      'console.log("src/index.ts(1,1): error TS2322: baseline"); process.exit(1);\n',
    );
    const env = baseEnv(root, worktree, { CN_TYPECHECK: nodeCommand(typecheck) });
    const runScorerCommand = runtime("runScorerCommand");

    const result = await runScorerCommand(["init"], env, root);
    const state = readState(env.CN_STATE!);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("verifying baseline (test + typecheck)");
    expect(result.stdout).toContain("baseline GREEN");
    expect(existsSync(worktree)).toBe(true);
    expect(state).toMatchObject({ baselineSha: git(root, ["rev-parse", "--verify", "HEAD"]).trim(), baselineTsc: 1, accepted: [], iter: 0 });
    expect(state.startL).toBeGreaterThan(0);
  });

  it("fails closed and cleans the worktree when baseline tests are red", async () => {
    const root = fixtureRoot();
    initRepo(root);
    write(root, "src/index.ts", "export const value = 1;\n");
    commit(root, "baseline");
    const worktree = fixtureWorktree();
    const fail = script(root, "fail.mjs", "process.exit(1);\n");
    const env = baseEnv(root, worktree, { CN_TEST: nodeCommand(fail) });
    const runScorerCommand = runtime("runScorerCommand");

    const result = await runScorerCommand(["init"], env, root);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`baseline tests RED (cmd: ${nodeCommand(fail)}) — abort`);
    expect(existsSync(env.CN_STATE!)).toBe(false);
    expect(existsSync(worktree)).toBe(false);
  });
});

describe("runScorerCommand score lifecycle", () => {
  it("requires initialized state before scoring", async () => {
    const { root, worktree, env } = initializedRepo();
    const runScorerCommand = runtime("runScorerCommand");

    const result = await runScorerCommand(["score"], env, root);

    expect(existsSync(worktree)).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("run `codenuke init` first\n");
  });

  it("exits zero with no candidate when the worktree is clean", async () => {
    const { root, env } = initializedRepo();
    const runScorerCommand = runtime("runScorerCommand");

    expect((await runScorerCommand(["init"], env, root)).exitCode).toBe(0);
    const result = await runScorerCommand(["score"], env, root);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("no candidate (working tree clean) — proposer must edit first.");
  });

  it("emits @@JSON@@ verdict with files, gates, touched/blocked, and null loss on gate failure", async () => {
    const { root, worktree, env } = initializedRepo();
    const runScorerCommand = runtime("runScorerCommand");
    expect((await runScorerCommand(["init"], env, root)).exitCode).toBe(0);
    write(worktree, "src/index.ts", "export const value = 1;\n");

    const result = await runScorerCommand(["score", "--json"], env, root);
    const verdict = parseJsonVerdict(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("VERDICT: REJECT (G1′ fence)");
    expect(verdict).toMatchObject({
      admissible: false,
      keep: false,
      loss: null,
      touched: ["src"],
      blocked: ["src"],
      gates: { G1: true, G1prime: false, G3: true, G4: true },
      files: ["index.ts"],
    });
    expect(verdict.dL).toBeGreaterThan(0);
  });

  it("keeps artifact freshness pinned to the baseline SHA captured during init when a symbolic branch moves", async () => {
    const root = fixtureRoot("codenuke-scorer-branch-move-");
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "scorer-branch-move-fixture" }, null, 2));
    write(root, "src/index.ts", "export function value() {\n  if (true) return 1;\n  return 2;\n}\n");
    const baselineSha = commit(root, "baseline");
    git(root, ["branch", "moving-base", baselineSha]);
    const worktree = fixtureWorktree("codenuke-scorer-branch-move-wt-");
    const env = baseEnv(root, worktree, { CN_BASE: "moving-base" });
    const runScorerCommand = runtime("runScorerCommand");
    expect((await runScorerCommand(["init"], env, root)).exitCode).toBe(0);
    writePassingFence(root, baselineSha);

    write(root, "src/other.ts", "export const moved = true;\n");
    const movedSha = commit(root, "move symbolic baseline");
    git(root, ["branch", "-f", "moving-base", movedSha]);
    write(worktree, "src/index.ts", "export const value = 1;\n");

    const result = await runScorerCommand(["score", "--json"], env, root);
    const verdict = parseJsonVerdict(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(readState(env.CN_STATE!).baselineSha).toBe(baselineSha);
    expect(verdict.gates).toMatchObject({ G1prime: true });
    expect(verdict.blocked).toEqual([]);
    expect(result.stdout).not.toContain("STALE AUDIT");
  });
});

describe("runScorerCommand accept/revert/status/cleanup lifecycle", () => {
  it("accept commits changed source only, increments iter, and records the accepted short SHA", async () => {
    const { root, worktree, env, baselineSha } = initializedRepo();
    const runScorerCommand = runtime("runScorerCommand");
    expect((await runScorerCommand(["init"], env, root)).exitCode).toBe(0);
    writePassingFence(root, baselineSha);
    write(worktree, "src/index.ts", "export const value = 1;\n");
    write(worktree, "package.json", JSON.stringify({ name: "mutated" }, null, 2));

    const result = await runScorerCommand(["accept"], env, root);
    const state = readState(env.CN_STATE!);
    const committedFiles = git(worktree, ["show", "--name-only", "--format=", state.accepted[0]!])
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("accepted (iteration 1).");
    expect(state.iter).toBe(1);
    expect(state.accepted).toHaveLength(1);
    expect(state.accepted[0]).toMatch(/^[0-9a-f]{7,}$/u);
    expect(committedFiles).toEqual(["src/index.ts"]);
    expect(git(worktree, ["status", "--short"])).toContain(" M package.json");
  });

  it("accept fails closed when the current candidate does not pass scorer gates", async () => {
    const { root, worktree, env } = initializedRepo();
    const runScorerCommand = runtime("runScorerCommand");
    expect((await runScorerCommand(["init"], env, root)).exitCode).toBe(0);
    write(worktree, "src/index.ts", "export const value = 1;\n");

    const result = await runScorerCommand(["accept"], env, root);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("candidate not accepted: REJECT (G1′ fence)\n");
    expect(readState(env.CN_STATE!).iter).toBe(0);
    expect(git(worktree, ["rev-list", "--count", "HEAD"]).trim()).toBe("1");
  });

  it("revert resets tracked source changes and cleans untracked source files", async () => {
    const { root, worktree, env } = initializedRepo();
    const runScorerCommand = runtime("runScorerCommand");
    expect((await runScorerCommand(["init"], env, root)).exitCode).toBe(0);
    write(worktree, "src/index.ts", "export const value = 99;\n");
    write(worktree, "src/new.ts", "export const extra = true;\n");
    write(worktree, "package.json", JSON.stringify({ name: "mutated" }, null, 2));

    const result = await runScorerCommand(["revert"], env, root);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("candidate reverted.\n");
    expect(readFileSync(join(worktree, "src/index.ts"), "utf8")).toContain("return 2");
    expect(existsSync(join(worktree, "src/new.ts"))).toBe(false);
    expect(readFileSync(join(worktree, "package.json"), "utf8")).toContain("mutated");
  });

  it("status reports accepted iterations and cumulative AST reduction", async () => {
    const { root, worktree, env, baselineSha } = initializedRepo();
    const runScorerCommand = runtime("runScorerCommand");
    expect((await runScorerCommand(["init"], env, root)).exitCode).toBe(0);
    writePassingFence(root, baselineSha);
    write(worktree, "src/index.ts", "export const value = 1;\n");
    expect((await runScorerCommand(["accept"], env, root)).exitCode).toBe(0);
    const state = readState(env.CN_STATE!);

    const result = await runScorerCommand(["status"], env, root);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`iterations=1 accepted=[${state.accepted[0]}]`);
    expect(result.stdout).toMatch(/src astNodes: \d+ -> \d+  \(cumulative reduction \d+, \d+\.\d%\)/u);
  });

  it("cleanup removes the scorer state file and isolated worktree", async () => {
    const { root, worktree, env } = initializedRepo();
    const runScorerCommand = runtime("runScorerCommand");
    expect((await runScorerCommand(["init"], env, root)).exitCode).toBe(0);

    const result = await runScorerCommand(["cleanup"], env, root);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("worktree removed.\n");
    expect(existsSync(env.CN_STATE!)).toBe(false);
    expect(existsSync(worktree)).toBe(false);
  });

  it("prints usage and exits zero for unsupported scorer commands", async () => {
    const { root, env } = initializedRepo();
    const runScorerCommand = runtime("runScorerCommand");

    const result = await runScorerCommand(["wat"], env, root);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("usage: scorer.mjs init|score [--json]|accept|revert|status|cleanup\n");
  });
});
