import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import * as calibrate from "@codenuke/calibrate";

interface CalibrationScales {
  readonly sL: number;
  readonly sCx: number;
  readonly sDup: number;
}

interface CalibrationArtifact {
  readonly schemaVersion: number;
  readonly baseline: string;
  readonly baselineSha: string;
  readonly generatedAt: string;
  readonly commitsSampled: number;
  readonly scales: CalibrationScales;
}

interface GitCommandPlan {
  readonly resolveBaseline: readonly string[];
  readonly listCommits: readonly string[];
  readonly filesAt: (ref: string) => readonly string[];
  readonly showAt: (ref: string, path: string) => readonly string[];
  readonly parentLineFor: (commit: string) => readonly string[];
}

interface RuntimeResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface RuntimeApi {
  readonly sourcePath: (srcDir: string) => string;
  readonly filesFromGitLsTree: (output: string) => string[];
  readonly snapshotFromGitOutput: (input: {
    readonly ref: string;
    readonly treeOutput: string;
    readonly readFileAtRef: (ref: string, path: string) => string | null;
  }) => Record<string, string>;
  readonly firstParentCommitPairs: (input: {
    readonly revListOutput: string;
    readonly parentLineFor: (commit: string) => string;
  }) => readonly { readonly parent: string; readonly commit: string }[];
  readonly createCalibrationArtifact: (input: {
    readonly baseline: string;
    readonly baselineSha: string;
    readonly generatedAt: string;
    readonly commitsSampled: number;
    readonly scales: CalibrationScales;
  }) => CalibrationArtifact;
  readonly calibrationGitCommandPlan: (input: {
    readonly baseline: string;
    readonly srcDir: string;
  }) => GitCommandPlan;
  readonly runCalibrateCommand: (
    args: readonly string[],
    env: Record<string, string | undefined>,
    cwd: string,
  ) => Promise<RuntimeResult>;
}

function runtime<K extends keyof RuntimeApi>(name: K): RuntimeApi[K] {
  const value = (calibrate as Record<string, unknown>)[name];
  if (typeof value !== "function") {
    throw new Error(`@codenuke/calibrate must export runtime helper ${String(name)}`);
  }
  return value as RuntimeApi[K];
}

function fixtureRoot(name: string): string {
  return mkdtempSync(join(tmpdir(), name));
}

function write(root: string, path: string, contents: string): void {
  const absolute = join(root, path);
  mkdirSync(absolute.split("/").slice(0, -1).join("/"), { recursive: true });
  writeFileSync(absolute, contents);
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

function commit(root: string, message: string): void {
  git(root, ["add", "."]);
  git(root, ["commit", "-m", message]);
}

async function runCalibrate(root: string): Promise<{ readonly result: RuntimeResult; readonly artifact: CalibrationArtifact }> {
  const runCalibrateCommand = runtime("runCalibrateCommand");
  const result = await runCalibrateCommand([], { CN_REPO: root, CN_SRC: "src", CN_BASE: "HEAD" }, root);
  const artifact = JSON.parse(readFileSync(join(root, ".codenuke/calibration.json"), "utf8")) as CalibrationArtifact;
  return { result, artifact };
}

describe("calibrate runtime source discovery", () => {
  it("maps the configured source directory to the legacy git pathspec", () => {
    const sourcePath = runtime("sourcePath");

    expect(sourcePath(".")).toBe(".");
    expect(sourcePath("src")).toBe("src");
    expect(sourcePath("packages/app/src")).toBe("packages/app/src");
  });

  it("parses NUL-delimited git ls-tree output and keeps only non-test source files", () => {
    const filesFromGitLsTree = runtime("filesFromGitLsTree");

    expect(
      filesFromGitLsTree(
        [
          "src/index.ts",
          "src/view.tsx",
          "src/runtime.mjs",
          "src/legacy.cjs",
          "src/-leading-dash.ts",
          "src/has space.ts",
          "src/$(touch owned).ts",
          "src/types.d.ts",
          "src/index.test.ts",
          "src/rules.spec.ts",
          "src/rules.accept.ts",
          "src/readme.md",
          "",
        ].join("\0"),
      ),
    ).toEqual([
      "src/index.ts",
      "src/view.tsx",
      "src/runtime.mjs",
      "src/legacy.cjs",
      "src/-leading-dash.ts",
      "src/has space.ts",
      "src/$(touch owned).ts",
    ]);
  });

  it("creates snapshots by reading only filtered source files at the requested ref", () => {
    const snapshotFromGitOutput = runtime("snapshotFromGitOutput");
    const reads: { ref: string; path: string }[] = [];

    const snapshot = snapshotFromGitOutput({
      ref: "abc123",
      treeOutput: ["src/index.ts", "src/index.test.ts", "src/-dash.ts", "src/missing.ts", ""].join("\0"),
      readFileAtRef(ref, path) {
        reads.push({ ref, path });
        return path === "src/missing.ts" ? null : `content:${ref}:${path}`;
      },
    });

    expect(snapshot).toEqual({
      "src/index.ts": "content:abc123:src/index.ts",
      "src/-dash.ts": "content:abc123:src/-dash.ts",
    });
    expect(reads).toEqual([
      { ref: "abc123", path: "src/index.ts" },
      { ref: "abc123", path: "src/-dash.ts" },
      { ref: "abc123", path: "src/missing.ts" },
    ]);
  });
});

describe("calibrate runtime commit extraction and artifacts", () => {
  it("extracts first-parent commit pairs and skips root commits", () => {
    const firstParentCommitPairs = runtime("firstParentCommitPairs");

    expect(
      firstParentCommitPairs({
        revListOutput: ["merge", "feature", "root", ""].join("\n"),
        parentLineFor(commit) {
          return {
            merge: "merge first-parent second-parent",
            feature: "feature parent-of-feature",
            root: "root",
          }[commit]!;
        },
      }),
    ).toEqual([
      { parent: "first-parent", commit: "merge" },
      { parent: "parent-of-feature", commit: "feature" },
    ]);
  });

  it("creates the legacy calibration artifact plus rebuild schemaVersion", () => {
    const createCalibrationArtifact = runtime("createCalibrationArtifact");

    expect(
      createCalibrationArtifact({
        baseline: "HEAD",
        baselineSha: "0123456789abcdef0123456789abcdef01234567",
        generatedAt: "2026-05-23T12:34:56.000Z",
        commitsSampled: 3,
        scales: { sL: 14, sCx: 1, sDup: 5 },
      }),
    ).toEqual({
      schemaVersion: 1,
      baseline: "HEAD",
      baselineSha: "0123456789abcdef0123456789abcdef01234567",
      generatedAt: "2026-05-23T12:34:56.000Z",
      commitsSampled: 3,
      scales: { sL: 14, sCx: 1, sDup: 5 },
    });
  });
});

describe("calibrate runtime git command safety", () => {
  it("builds argv vectors with -- before pathspecs and -z for porcelain output", () => {
    const calibrationGitCommandPlan = runtime("calibrationGitCommandPlan");

    const plan = calibrationGitCommandPlan({
      baseline: "feature/reduce-1",
      srcDir: "packages/app/src",
    });

    expect(plan.resolveBaseline).toEqual(["rev-parse", "--verify", "--end-of-options", "feature/reduce-1"]);
    expect(plan.listCommits).toEqual([
      "rev-list",
      "--first-parent",
      "--max-count=80",
      "--end-of-options",
      "feature/reduce-1",
      "--",
      "packages/app/src",
    ]);
    expect(plan.filesAt("abc123")).toEqual([
      "ls-tree",
      "-r",
      "-z",
      "--name-only",
      "abc123",
      "--",
      "packages/app/src",
    ]);
    expect(plan.parentLineFor("-commit;$(touch owned)")).toEqual([
      "rev-list",
      "--parents",
      "-n",
      "1",
      "-commit;$(touch owned)",
    ]);
    expect(plan.showAt("abc123", "src/$(touch owned).ts")).toEqual(["show", "abc123:src/$(touch owned).ts"]);
  });

  it("rejects option-like refs and unsafe pathspec input instead of preserving them", () => {
    const calibrationGitCommandPlan = runtime("calibrationGitCommandPlan");

    expect(() =>
      calibrationGitCommandPlan({
        baseline: "--glob=refs/heads/*;touch owned",
        srcDir: "src",
      }),
    ).toThrow("unsafe git ref for calibration");
    expect(() =>
      calibrationGitCommandPlan({
        baseline: "HEAD",
        srcDir: ":(glob)**/*.ts",
      }),
    ).toThrow("unsafe source path for calibration");
    expect(() =>
      calibrationGitCommandPlan({
        baseline: "HEAD",
        srcDir: "../src",
      }),
    ).toThrow("unsafe source path for calibration");
  });
});

describe("runCalibrateCommand", () => {
  it("writes a schema-versioned default calibration when fewer than 3 useful deltas exist", async () => {
    const root = fixtureRoot("codenuke-calibrate-defaults-");
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "calibrate-defaults-fixture" }));
    write(root, "src/index.ts", "export const value = 1;\n");
    commit(root, "initial");
    write(root, "src/index.ts", "export const value = 1;\nexport const inc = (n: number) => n + 1;\n");
    commit(root, "add inc");

    const { result, artifact } = await runCalibrate(root);
    const head = git(root, ["rev-parse", "--verify", "HEAD"]).trim();

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("calibration @ HEAD commits=1 fallback=defaults sL=150 sCx=15 sDup=5");
    expect(artifact).toMatchObject({
      schemaVersion: 1,
      baseline: "HEAD",
      baselineSha: head,
      commitsSampled: 1,
      scales: { sL: 150, sCx: 15, sDup: 5 },
    });
    expect(Date.parse(artifact.generatedAt)).not.toBeNaN();
  });

  it("writes derived median scales when at least 3 useful first-parent deltas exist", async () => {
    const root = fixtureRoot("codenuke-calibrate-derived-");
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "calibrate-derived-fixture" }));
    write(root, "src/index.ts", "export const value = 1;\n");
    commit(root, "initial");
    write(root, "src/index.ts", "export const value = 1;\nexport const inc = (n: number) => n + 1;\n");
    commit(root, "add inc");
    write(
      root,
      "src/index.ts",
      [
        "export const value = 1;",
        "export const inc = (n: number) => n + 1;",
        "export function sign(n: number) { if (n > 0) return 1; return 0; }",
        "",
      ].join("\n"),
    );
    commit(root, "add sign");
    write(
      root,
      "src/index.ts",
      [
        "export const value = 1;",
        "export const inc = (n: number) => n + 1;",
        "export function sign(n: number) { if (n > 0) return 1; if (n < 0) return -1; return 0; }",
        "",
      ].join("\n"),
    );
    commit(root, "expand sign");

    const { result, artifact } = await runCalibrate(root);
    const head = git(root, ["rev-parse", "--verify", "HEAD"]).trim();

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("calibration @ HEAD commits=3 sL=14 sCx=1 sDup=5");
    expect(artifact).toMatchObject({
      schemaVersion: 1,
      baseline: "HEAD",
      baselineSha: head,
      commitsSampled: 3,
      scales: { sL: 14, sCx: 1, sDup: 5 },
    });
    expect(Date.parse(artifact.generatedAt)).not.toBeNaN();
  });

  it("fails closed and does not write calibration when the history scan input is unsafe", async () => {
    const root = fixtureRoot("codenuke-calibrate-fail-closed-");
    initRepo(root);
    write(root, "src/index.ts", "export const value = 1;\n");
    commit(root, "initial");

    const runCalibrateCommand = runtime("runCalibrateCommand");
    const result = await runCalibrateCommand([], { CN_REPO: root, CN_SRC: "src", CN_BASE: "--glob=refs/heads/*" }, root);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("unsafe git ref for calibration");
    expect(existsSync(join(root, ".codenuke/calibration.json"))).toBe(false);
  });
});
