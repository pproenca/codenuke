import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import * as changecost from "@codenuke/changecost";

interface BenchmarkDelta {
  readonly id: string;
  readonly title: string;
  readonly prompt: string;
  readonly region?: string;
  readonly acceptPath: string;
  readonly dir: string;
  readonly acceptTest: string;
}

interface ChangeCostResult {
  readonly id: string;
  readonly status: "impl-fail" | "impl-bad-surface" | "not-done" | "done";
  readonly editTokens?: number;
  readonly filesTouched?: number;
  readonly regions?: readonly string[];
  readonly verifyFrac?: number;
  readonly cost?: number;
  readonly disallowed?: readonly string[];
}

interface ChangeCostArtifact {
  readonly schemaVersion: number;
  readonly ref: string;
  readonly beta: number;
  readonly Vhat: number | null;
  readonly done: number;
  readonly total: number;
  readonly results: readonly ChangeCostResult[];
}

interface GitCommandPlan {
  readonly resolveRef: readonly string[];
  readonly addWorktree: readonly string[];
  readonly snapshotFiles: readonly string[];
  readonly statusPorcelain: readonly string[];
  readonly resetAndCleanAll: readonly string[];
  readonly resetAndCleanPaths: (paths: readonly string[]) => readonly string[];
}

interface RuntimeResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface RuntimeApi {
  readonly defaultChangeCostOutputPath: (repo: string) => string;
  readonly discoverBenchmarks: (benchmarkDir: string) => readonly BenchmarkDelta[];
  readonly parseChangeCostBeta: (env: Record<string, string | undefined>) => number;
  readonly changeCostRef: (
    args: readonly string[],
    env: Record<string, string | undefined>,
    defaultBaseline: string,
  ) => string;
  readonly createChangeCostArtifact: (input: Omit<ChangeCostArtifact, "schemaVersion">) => ChangeCostArtifact;
  readonly changeCostGitCommandPlan: (input: {
    readonly repo: string;
    readonly worktree: string;
    readonly ref: string;
    readonly srcDir: string;
  }) => GitCommandPlan;
  readonly safeWorktreePath: (worktreeRoot: string, rel: string) => string;
  readonly dirtyPathsFromPorcelainZ: (
    output: string,
    options: { benchmarkInsideRepo: boolean; benchmarkRel: string },
  ) => readonly string[];
  readonly runChangeCostCommand: (
    args: readonly string[],
    env: Record<string, string | undefined>,
    cwd: string,
  ) => Promise<RuntimeResult>;
}

function runtime<K extends keyof RuntimeApi>(name: K): RuntimeApi[K] {
  const value = (changecost as Record<string, unknown>)[name];
  if (typeof value !== "function") {
    throw new Error(`@codenuke/changecost must export runtime helper ${String(name)}`);
  }
  return value as RuntimeApi[K];
}

function fixtureRoot(name = "codenuke-changecost-"): string {
  return mkdtempSync(join(tmpdir(), name));
}

function write(root: string, path: string, contents: string): string {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
  return absolute;
}

function writeJson(root: string, path: string, value: unknown): string {
  return write(root, path, JSON.stringify(value, null, 2));
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
  git(root, ["add", "."]);
  git(root, ["commit", "-m", message]);
  return git(root, ["rev-parse", "--verify", "HEAD"]).trim();
}

function writeBenchmark(
  root: string,
  id: string,
  overrides: Partial<Omit<BenchmarkDelta, "id" | "dir" | "acceptTest">> = {},
  acceptTest = `export const ${id.replaceAll("-", "_")}Accepted = true;\n`,
): void {
  writeJson(root, `codenuke.benchmark/${id}/meta.json`, {
    id,
    title: `Change ${id}`,
    prompt: `Apply ${id}.`,
    region: "src",
    acceptPath: `tests/${id}.accept.test.ts`,
    ...overrides,
  });
  write(root, `codenuke.benchmark/${id}/accept.test.ts`, acceptTest);
}

function readArtifact(root: string): ChangeCostArtifact {
  return JSON.parse(readFileSync(join(root, ".codenuke/changecost.json"), "utf8")) as ChangeCostArtifact;
}

function baseEnv(root: string, worktree: string, extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    ...process.env,
    CN_REPO: root,
    CN_SRC: "src",
    CN_BASE: "HEAD",
    CN_BENCH: join(root, "codenuke.benchmark"),
    CN_WORKTREE: worktree,
    CN_TAG: `changecost-${Date.now()}`,
    CN_TEST: 'node -e "process.exit(0)"',
    ...extra,
  };
}

describe("changecost runtime discovery, metadata, and config", () => {
  it("discovers benchmark directories from meta.json plus accept.test.ts and sorts by id", () => {
    const root = fixtureRoot();
    writeBenchmark(root, "zeta", { title: "Zeta", prompt: "Last.", acceptPath: "tests/z.accept.test.ts" }, "z();\n");
    writeBenchmark(root, "alpha", { title: "Alpha", prompt: "First.", acceptPath: "tests/a.accept.test.ts" }, "a();\n");
    write(root, "codenuke.benchmark/not-a-directory.txt", "ignored\n");
    const discoverBenchmarks = runtime("discoverBenchmarks");

    expect(discoverBenchmarks(join(root, "codenuke.benchmark"))).toEqual([
      {
        id: "alpha",
        title: "Alpha",
        prompt: "First.",
        region: "src",
        acceptPath: "tests/a.accept.test.ts",
        dir: join(root, "codenuke.benchmark/alpha"),
        acceptTest: "a();\n",
      },
      {
        id: "zeta",
        title: "Zeta",
        prompt: "Last.",
        region: "src",
        acceptPath: "tests/z.accept.test.ts",
        dir: join(root, "codenuke.benchmark/zeta"),
        acceptTest: "z();\n",
      },
    ]);
  });

  it("uses the repo-local output path, default ref, beta env, and schema-versioned artifact", () => {
    const defaultChangeCostOutputPath = runtime("defaultChangeCostOutputPath");
    const parseChangeCostBeta = runtime("parseChangeCostBeta");
    const changeCostRef = runtime("changeCostRef");
    const createChangeCostArtifact = runtime("createChangeCostArtifact");

    expect(defaultChangeCostOutputPath("/repo")).toBe("/repo/.codenuke/changecost.json");
    expect(changeCostRef([], { CN_BASE: "main" }, "HEAD")).toBe("main");
    expect(changeCostRef([], {}, "HEAD")).toBe("HEAD");
    expect(changeCostRef(["feature/ref"], { CN_BASE: "main" }, "HEAD")).toBe("feature/ref");
    expect(parseChangeCostBeta({})).toBe(60);
    expect(parseChangeCostBeta({ CN_BETA: "12.5" })).toBe(12.5);
    expect(() => parseChangeCostBeta({ CN_BETA: "NaN" })).toThrow("CN_BETA must be a finite non-negative number");

    expect(
      createChangeCostArtifact({
        ref: "HEAD",
        beta: 10,
        Vhat: 12.5,
        done: 1,
        total: 2,
        results: [
          {
            id: "alpha",
            status: "done",
            editTokens: 3,
            filesTouched: 1,
            regions: ["src"],
            verifyFrac: 0.95,
            cost: 12.5,
          },
          { id: "beta", status: "not-done" },
        ],
      }),
    ).toEqual({
      schemaVersion: 1,
      ref: "HEAD",
      beta: 10,
      Vhat: 12.5,
      done: 1,
      total: 2,
      results: [
        {
          id: "alpha",
          status: "done",
          editTokens: 3,
          filesTouched: 1,
          regions: ["src"],
          verifyFrac: 0.95,
          cost: 12.5,
        },
        { id: "beta", status: "not-done" },
      ],
    });
  });
});

describe("changecost runtime argv-vector and path-safety contract", () => {
  it("builds git argv vectors with explicit pathspec delimiters and rejects unsafe inputs", () => {
    const changeCostGitCommandPlan = runtime("changeCostGitCommandPlan");

    const plan = changeCostGitCommandPlan({
      repo: "/repo",
      worktree: "/tmp/codenuke-wt-changecost",
      ref: "feature/changecost",
      srcDir: "packages/app/src",
    });

    expect(plan.resolveRef).toEqual(["rev-parse", "--verify", "--end-of-options", "feature/changecost"]);
    expect(plan.addWorktree).toEqual(["worktree", "add", "-f", "/tmp/codenuke-wt-changecost", "feature/changecost"]);
    expect(plan.snapshotFiles).toEqual(["ls-files", "-z", "--", "packages/app/src"]);
    expect(plan.statusPorcelain).toEqual(["status", "--porcelain", "-z"]);
    expect(plan.resetAndCleanAll).toEqual(["reset", "--hard", "--"]);
    expect(plan.resetAndCleanPaths(["src/-dash.ts", "src/$(touch owned).ts"])).toEqual([
      "checkout",
      "--",
      "src/-dash.ts",
      "src/$(touch owned).ts",
    ]);

    expect(() =>
      changeCostGitCommandPlan({
        repo: "/repo",
        worktree: "/tmp/codenuke-wt-changecost",
        ref: "--glob=refs/heads/*",
        srcDir: "src",
      }),
    ).toThrow("unsafe git ref for changecost");
    expect(() =>
      changeCostGitCommandPlan({
        repo: "/repo",
        worktree: "/tmp/codenuke-wt-changecost",
        ref: "HEAD",
        srcDir: ":(glob)**/*.ts",
      }),
    ).toThrow("unsafe source path for changecost");
  });

  it("resolves worktree-relative writes and rejects traversal before installing accept tests", () => {
    const safeWorktreePath = runtime("safeWorktreePath");
    const worktree = fixtureRoot("codenuke-changecost-safe-wt-");

    expect(safeWorktreePath(worktree, "tests/value.accept.test.ts")).toBe(join(worktree, "tests/value.accept.test.ts"));
    expect(() => safeWorktreePath(worktree, "/tmp/outside.ts")).toThrow("unsafe worktree path");
    expect(() => safeWorktreePath(worktree, "../outside.ts")).toThrow("unsafe worktree path");
  });

  it("rejects symlinked parent directories before installing accept tests", () => {
    const safeWorktreePath = runtime("safeWorktreePath");
    const worktree = fixtureRoot("codenuke-changecost-safe-wt-");
    const outside = fixtureRoot("codenuke-changecost-outside-");
    symlinkSync(outside, join(worktree, "tests"));

    expect(() => safeWorktreePath(worktree, "tests/value.accept.test.ts")).toThrow("unsafe worktree path");
  });

  it("parses porcelain-z rename records including both destination and source paths", () => {
    const dirtyPathsFromPorcelainZ = runtime("dirtyPathsFromPorcelainZ");

    expect(
      dirtyPathsFromPorcelainZ("R  src/package.ts\0package.json\0", {
        benchmarkInsideRepo: false,
        benchmarkRel: "",
      }),
    ).toEqual(["src/package.ts", "package.json"]);
  });
});

describe("runChangeCostCommand fail-closed paths", () => {
  it("exits 1 and does not write an artifact when the benchmark corpus is missing", async () => {
    const root = fixtureRoot();
    initRepo(root);
    write(root, "src/index.ts", "export const value = 1;\n");
    commit(root, "initial");
    const worktree = join(tmpdir(), `codenuke-changecost-missing-${Date.now()}`);
    const runChangeCostCommand = runtime("runChangeCostCommand");

    const result = await runChangeCostCommand([], baseEnv(root, worktree), root);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(
      `no benchmark in ${join(root, "codenuke.benchmark")} (add change-requests: <id>/meta.json + accept.test.ts)`,
    );
    expect(existsSync(join(root, ".codenuke/changecost.json"))).toBe(false);
    expect(existsSync(`${worktree}-changecost`)).toBe(false);
  });

  it("fails closed and cleans up when baseline tests are red", async () => {
    const root = fixtureRoot();
    initRepo(root);
    write(root, "src/index.ts", "export const value = 1;\n");
    writeBenchmark(root, "value");
    commit(root, "benchmark");
    const worktree = join(tmpdir(), `codenuke-changecost-red-${Date.now()}`);
    const runChangeCostCommand = runtime("runChangeCostCommand");

    const result = await runChangeCostCommand(
      [],
      baseEnv(root, worktree, { CN_TEST: 'node -e "process.exit(1)"' }),
      root,
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("baseline RED \u2014 abort");
    expect(existsSync(join(root, ".codenuke/changecost.json"))).toBe(false);
    expect(existsSync(`${worktree}-changecost`)).toBe(false);
  });
});

describe("runChangeCostCommand benchmark execution", () => {
  it("passes CN_DELTA to the scripted implementer, computes done costs, and averages Vhat over done changes", async () => {
    const root = fixtureRoot();
    initRepo(root);
    const baselineSource = "export const a = 1;\nexport const b = 10;\n";
    write(root, "src/index.ts", baselineSource);
    writeBenchmark(root, "one", { title: "Change one", prompt: "Set a to 2.", acceptPath: "tests/one.accept.test.ts" });
    writeBenchmark(root, "two", { title: "Change two", prompt: "Set b to 20.", acceptPath: "tests/two.accept.test.ts" });
    commit(root, "benchmark");
    const worktree = join(tmpdir(), `codenuke-changecost-done-${Date.now()}`);
    const capture = join(root, "deltas.log");
    const implementer = write(
      root,
      "implementer.mjs",
      `
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
appendFileSync(${JSON.stringify(capture)}, process.env.CN_DELTA + "\\n");
const path = "src/index.ts";
const source = readFileSync(path, "utf8");
if (process.env.CN_DELTA === "one") writeFileSync(path, source.replace("a = 1", "a = 2"));
if (process.env.CN_DELTA === "two") writeFileSync(path, source.replace("b = 10", "b = 20"));
`,
    );
    const testCommand = `node -e "const fs=require('fs');const src=fs.readFileSync('src/index.ts','utf8');if(fs.existsSync('tests/one.accept.test.ts')&&!src.includes('a = 2'))process.exit(1);if(fs.existsSync('tests/two.accept.test.ts')&&!src.includes('b = 20'))process.exit(1);process.exit(0)"`;
    const editCost = runtimePure("editCost");
    const oneEdit = editCost({ "src/index.ts": baselineSource }, { "src/index.ts": baselineSource.replace("a = 1", "a = 2") }, "src");
    const twoEdit = editCost({ "src/index.ts": baselineSource }, { "src/index.ts": baselineSource.replace("b = 10", "b = 20") }, "src");
    const runChangeCostCommand = runtime("runChangeCostCommand");

    const result = await runChangeCostCommand(
      ["HEAD"],
      baseEnv(root, worktree, {
        CN_TEST: testCommand,
        CN_IMPLEMENTER: `node ${JSON.stringify(implementer)}`,
        CN_BETA: "10",
      }),
      root,
    );
    const artifact = readArtifact(root);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("evaluate_changecost @ HEAD  \u03b2=10  implementer=scripted");
    expect(readFileSync(capture, "utf8").trim().split("\n")).toEqual(["one", "two"]);
    expect(artifact).toMatchObject({
      schemaVersion: 1,
      ref: "HEAD",
      beta: 10,
      done: 2,
      total: 2,
    });
    expect(artifact.results[0]).toMatchObject({
      id: "one",
      status: "done",
      editTokens: oneEdit.tokens,
      filesTouched: oneEdit.filesTouched,
      regions: ["src"],
      verifyFrac: 1,
      cost: oneEdit.tokens + 10,
    });
    expect(artifact.results[1]).toMatchObject({
      id: "two",
      status: "done",
      editTokens: twoEdit.tokens,
      filesTouched: twoEdit.filesTouched,
      regions: ["src"],
      verifyFrac: 1,
      cost: twoEdit.tokens + 10,
    });
    expect(artifact.Vhat).toBe(((oneEdit.tokens + 10) + (twoEdit.tokens + 10)) / 2);
    expect(existsSync(`${worktree}-changecost`)).toBe(false);
  });

  it("records not-done when the hidden acceptance test stays red after implementation", async () => {
    const root = fixtureRoot();
    initRepo(root);
    write(root, "src/index.ts", "export const value = 1;\n");
    writeBenchmark(root, "value", { acceptPath: "tests/value.accept.test.ts" });
    commit(root, "benchmark");
    const worktree = join(tmpdir(), `codenuke-changecost-notdone-${Date.now()}`);
    const implementer = write(root, "implementer.mjs", "process.exit(0);\n");
    const testCommand = `node -e "const fs=require('fs');const src=fs.readFileSync('src/index.ts','utf8');process.exit(fs.existsSync('tests/value.accept.test.ts') && !src.includes('value = 2') ? 1 : 0)"`;
    const runChangeCostCommand = runtime("runChangeCostCommand");

    const result = await runChangeCostCommand(
      [],
      baseEnv(root, worktree, {
        CN_TEST: testCommand,
        CN_IMPLEMENTER: `node ${JSON.stringify(implementer)}`,
      }),
      root,
    );
    const artifact = readArtifact(root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("acceptance/suite RED \u2014 not done");
    expect(artifact).toMatchObject({
      schemaVersion: 1,
      done: 0,
      total: 1,
      Vhat: null,
      results: [{ id: "value", status: "not-done" }],
    });
    expect(existsSync(`${worktree}-changecost`)).toBe(false);
  });

  it("enforces the source surface and cleans disallowed implementer writes", async () => {
    const root = fixtureRoot();
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "surface-fixture" }));
    write(root, "src/index.ts", "export const value = 1;\n");
    writeBenchmark(root, "value");
    commit(root, "benchmark");
    const worktree = join(tmpdir(), `codenuke-changecost-surface-${Date.now()}`);
    const implementer = write(
      root,
      "implementer.mjs",
      `
import { writeFileSync } from "node:fs";
writeFileSync("src/index.ts", "export const value = 2;\\n");
writeFileSync("package.json", "{\\"name\\":\\"mutated\\"}\\n");
`,
    );
    const runChangeCostCommand = runtime("runChangeCostCommand");

    const result = await runChangeCostCommand(
      [],
      baseEnv(root, worktree, {
        CN_IMPLEMENTER: `node ${JSON.stringify(implementer)}`,
      }),
      root,
    );
    const artifact = readArtifact(root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("implementer touched outside source surface: package.json");
    expect(artifact.results[0]).toMatchObject({
      id: "value",
      status: "impl-bad-surface",
      disallowed: ["package.json"],
    });
    expect(existsSync(`${worktree}-changecost`)).toBe(false);
  });

  it("treats rename source paths as dirty so non-source renames cannot bypass the surface gate", async () => {
    const root = fixtureRoot();
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "rename-fixture" }));
    write(root, "src/index.ts", "export const value = 1;\n");
    writeBenchmark(root, "value");
    commit(root, "benchmark");
    const worktree = join(tmpdir(), `codenuke-changecost-rename-${Date.now()}`);
    const implementer = write(
      root,
      "implementer.mjs",
      `
import { renameSync } from "node:fs";
renameSync("package.json", "src/package.ts");
`,
    );
    const runChangeCostCommand = runtime("runChangeCostCommand");

    const result = await runChangeCostCommand(
      [],
      baseEnv(root, worktree, {
        CN_IMPLEMENTER: `node ${JSON.stringify(implementer)}`,
      }),
      root,
    );
    const artifact = readArtifact(root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("implementer touched outside source surface: package.json");
    expect(artifact.results[0]).toMatchObject({
      id: "value",
      status: "impl-bad-surface",
      disallowed: ["package.json"],
    });
    expect(existsSync(`${worktree}-changecost`)).toBe(false);
  });
});

function runtimePure<K extends "editCost">(name: K): typeof changecost.editCost {
  const value = (changecost as Record<string, unknown>)[name];
  if (typeof value !== "function") throw new Error(`@codenuke/changecost must export ${name}`);
  return value as typeof changecost.editCost;
}
