import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "@codenuke/exec";
import * as fence from "@codenuke/fence";
import { describe, expect, it } from "vitest";
import { runFenceCommand } from "../main/runtime.js";

interface PlannedMutation {
  readonly rel: string;
  readonly start: number;
  readonly end: number;
  readonly repl: string;
  readonly op: string;
}

interface RegionRecord {
  readonly caught: number;
  readonly total: number;
  readonly p: number;
  readonly lo: number;
  readonly hi: number;
  readonly admissible: boolean;
  readonly survivorSpecs: readonly PlannedMutation[];
}

interface FenceArtifact {
  readonly schemaVersion: number;
  readonly baseline: string;
  readonly baselineSha: string;
  readonly generatedAt: string;
  readonly method: "ast-aware";
  readonly threshold: number;
  readonly capPerRegion: number;
  readonly seed: number;
  readonly regions: Record<string, RegionRecord>;
}

interface RuntimeApi {
  readonly regionPath: (srcDir: string, region: string) => string;
  readonly filesFromGitLsTree: (output: string) => string[];
  readonly fenceGitCommandPlan: (input: {
    readonly baseline: string;
    readonly srcDir: string;
    readonly region: string;
  }) => {
    readonly resolveBaseline: readonly string[];
    readonly filesInRegion: (ref: string) => readonly string[];
  };
  readonly createFenceArtifact: (input: {
    readonly baseline: string;
    readonly baselineSha: string;
    readonly generatedAt: string;
    readonly threshold: number;
    readonly capPerRegion: number;
    readonly seed: number;
    readonly regions: Record<string, RegionRecord>;
  }) => FenceArtifact;
  readonly baselineRedResult: () => {
    readonly ok: false;
    readonly exitCode: 1;
    readonly artifact: { readonly error: "baseline red" };
    readonly stdout: readonly string[];
    readonly cleanupWorktree: true;
  };
  readonly createAuditPlan: (input: {
    readonly regions: readonly string[];
    readonly filesByRegion: Record<
      string,
      readonly { readonly rel: string; readonly text: string }[]
    >;
    readonly capPerRegion: number;
    readonly seed: number;
  }) => Record<string, readonly PlannedMutation[]>;
  readonly recordMutationResult: (
    site: PlannedMutation,
    status: "green" | "fail" | "timeout",
  ) => { readonly caught: boolean; readonly survivorSpec: PlannedMutation | null };
  readonly regionRecordFromResults: (input: {
    readonly plan: readonly PlannedMutation[];
    readonly statuses: readonly ("green" | "fail" | "timeout")[];
    readonly threshold: number;
  }) => RegionRecord;
  readonly mergeFilteredAuditArtifact: (
    previous: FenceArtifact,
    refresh: FenceArtifact,
    filteredRegions: readonly string[],
  ) => FenceArtifact;
  readonly canReuseFilteredAuditArtifact: (
    previous: FenceArtifact,
    refresh: FenceArtifact,
  ) => boolean;
  readonly safeWorktreePath: (worktreeRoot: string, rel: string) => string;
  readonly assertReplaySourcesUnchanged: (input: {
    readonly artifact: FenceArtifact;
    readonly region: string;
    readonly readBaseline: (rel: string) => string;
    readonly readWorktree: (rel: string) => string;
    readonly worktreeRoot?: string;
  }) => void;
  readonly assertReplayBaselineGreen: (status: "green" | "fail" | "timeout") => void;
  readonly replaySurvivors: (input: {
    readonly artifact: FenceArtifact;
    readonly region: string;
    readonly statuses: readonly ("green" | "fail" | "timeout")[];
    readonly threshold: number;
  }) => FenceArtifact;
}

function runtime<K extends keyof RuntimeApi>(name: K): RuntimeApi[K] {
  const value = (fence as Record<string, unknown>)[name];
  if (typeof value !== "function") {
    throw new Error(`@codenuke/fence must export runtime helper ${name}`);
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

function nodeCommand(script: string): string {
  return `node ${JSON.stringify(script)}`;
}

function removeFixtureWorktree(root: string, worktree: string): void {
  try {
    git(root, ["worktree", "remove", "--force", worktree]);
  } catch {
    /* fixture cleanup best effort */
  }
  try {
    git(root, ["worktree", "prune"]);
  } catch {
    /* fixture cleanup best effort */
  }
  rmSync(worktree, { recursive: true, force: true });
}

const survivor = (overrides: Partial<PlannedMutation> = {}): PlannedMutation => ({
  rel: "src/api/rules.ts",
  start: 46,
  end: 47,
  repl: ">",
  op: "<->".replace("-", "→"),
  ...overrides,
});

const regionRecord = (overrides: Partial<RegionRecord> = {}): RegionRecord => ({
  caught: 0,
  total: 1,
  p: 0,
  lo: 0,
  hi: 0.7934567085261071,
  admissible: false,
  survivorSpecs: [survivor()],
  ...overrides,
});

const artifact = (overrides: Partial<FenceArtifact> = {}): FenceArtifact => ({
  schemaVersion: 1,
  baseline: "HEAD",
  baselineSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  generatedAt: "2026-05-23T12:00:00.000Z",
  method: "ast-aware",
  threshold: 0.9,
  capPerRegion: 60,
  seed: 1337,
  regions: { api: regionRecord() },
  ...overrides,
});

describe("fence runtime region discovery", () => {
  it("maps legacy region arguments to git pathspecs", () => {
    const regionPath = runtime("regionPath");

    expect(regionPath("src", "api")).toBe("src/api");
    expect(regionPath("src", "src")).toBe("src");
    expect(regionPath(".", "api")).toBe(".");
  });

  it("parses NUL-delimited git ls-tree output and preserves awkward source filenames", () => {
    const filesFromGitLsTree = runtime("filesFromGitLsTree");

    expect(
      filesFromGitLsTree(
        [
          "src/api/index.ts",
          "src/api/view.tsx",
          "src/api/runtime.mjs",
          "src/api/legacy.cjs",
          "src/api/has space.ts",
          'src/api/"quoted".tsx',
          "src/api/line\nbreak.ts",
          "src/api/types.d.ts",
          "src/api/index.test.ts",
          "src/api/rules.spec.ts",
          "src/api/rules.accept.ts",
          "src/api/readme.md",
          "",
        ].join("\0"),
      ),
    ).toEqual([
      "src/api/index.ts",
      "src/api/view.tsx",
      "src/api/runtime.mjs",
      "src/api/legacy.cjs",
      "src/api/has space.ts",
      'src/api/"quoted".tsx',
      "src/api/line\nbreak.ts",
    ]);
  });

  it("plans runtime git discovery with a resolved commit and -z so path parsing is lossless", () => {
    const fenceGitCommandPlan = runtime("fenceGitCommandPlan");
    const plan = fenceGitCommandPlan({
      baseline: "feature/reduce-1",
      srcDir: "packages/app/src",
      region: "api",
    });

    expect(plan.resolveBaseline).toEqual([
      "rev-parse",
      "--verify",
      "--end-of-options",
      "feature/reduce-1",
    ]);
    expect(plan.filesInRegion("0123456789abcdef0123456789abcdef01234567")).toEqual([
      "ls-tree",
      "-r",
      "-z",
      "--name-only",
      "0123456789abcdef0123456789abcdef01234567",
      "--",
      "packages/app/src/api",
    ]);
  });

  it("parses real git ls-tree -z output with spaces, quotes, and embedded newlines", () => {
    const filesFromGitLsTree = runtime("filesFromGitLsTree");
    const fenceGitCommandPlan = runtime("fenceGitCommandPlan");
    const root = fixtureRoot("codenuke-fence-ls-tree-");
    initRepo(root);
    write(root, "src/api/index.ts", "export const index = 1;\n");
    write(root, "src/api/has space.ts", "export const spaced = 1;\n");
    write(root, 'src/api/"quoted".tsx', "export const quoted = 1;\n");
    write(root, "src/api/line\nbreak.ts", "export const lineBreak = 1;\n");
    write(root, "src/api/index.test.ts", "test('skip', () => {});\n");
    write(root, "src/api/types.d.ts", "export type Skip = string;\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "fixtures"]);
    const plan = fenceGitCommandPlan({ baseline: "HEAD", srcDir: "src", region: "api" });
    const head = run("git", plan.resolveBaseline, { cwd: root }).trim();

    expect(filesFromGitLsTree(run("git", plan.filesInRegion(head), { cwd: root }))).toEqual([
      'src/api/"quoted".tsx',
      "src/api/has space.ts",
      "src/api/index.ts",
      "src/api/line\nbreak.ts",
    ]);
  });
});

describe("fence runtime artifact metadata", () => {
  it("writes the legacy audit metadata plus the rebuild schema version", () => {
    const createFenceArtifact = runtime("createFenceArtifact");

    expect(
      createFenceArtifact({
        baseline: "HEAD",
        baselineSha: "0123456789abcdef0123456789abcdef01234567",
        generatedAt: "2026-05-23T12:34:56.000Z",
        threshold: 0.9,
        capPerRegion: 60,
        seed: 1337,
        regions: {
          src: regionRecord({
            caught: 1,
            total: 1,
            p: 1,
            lo: 0.20654329147389294,
            hi: 1,
            admissible: false,
            survivorSpecs: [],
          }),
        },
      }),
    ).toEqual({
      schemaVersion: 1,
      baseline: "HEAD",
      baselineSha: "0123456789abcdef0123456789abcdef01234567",
      generatedAt: "2026-05-23T12:34:56.000Z",
      method: "ast-aware",
      threshold: 0.9,
      capPerRegion: 60,
      seed: 1337,
      regions: {
        src: {
          caught: 1,
          total: 1,
          p: 1,
          lo: 0.20654329147389294,
          hi: 1,
          admissible: false,
          survivorSpecs: [],
        },
      },
    });
  });

  it("returns the legacy fail-closed artifact and cleanup signal when baseline tests are red", () => {
    const baselineRedResult = runtime("baselineRedResult");

    expect(baselineRedResult()).toEqual({
      ok: false,
      exitCode: 1,
      artifact: { error: "baseline red" },
      stdout: ["baseline RED — abort"],
      cleanupWorktree: true,
    });
  });
});

describe("fence runtime audit plan and survivor classification", () => {
  const source = [
    "export const lt = (a: number, b: number) => a < b;",
    "export const ge = (a: number, b: number) => a >= b;",
    "export const eq = (a: string, b: string) => a === b;",
    "export const both = (a: boolean, b: boolean) => a && b;",
    'export const prefix = (s: string) => s.startsWith("x");',
    "export function flag() { return true; }",
    "",
  ].join("\n");

  it("creates the same deterministic mutation sample as the legacy seeded shuffle", () => {
    const createAuditPlan = runtime("createAuditPlan");

    const plan = createAuditPlan({
      regions: ["api"],
      filesByRegion: { api: [{ rel: "src/api/rules.ts", text: source }] },
      capPerRegion: 3,
      seed: 1337,
    });

    expect(plan.api.map((site) => site.op)).toEqual([
      "===→!==",
      "startsWith→endsWith",
      "true→false",
    ]);
    expect(plan.api).toEqual([
      { rel: "src/api/rules.ts", start: 149, end: 152, repl: "!==", op: "===→!==" },
      {
        rel: "src/api/rules.ts",
        start: 251,
        end: 261,
        repl: "endsWith",
        op: "startsWith→endsWith",
      },
      { rel: "src/api/rules.ts", start: 300, end: 304, repl: "false", op: "true→false" },
    ]);
  });

  it("classifies only green mutants as survivors and keeps survivorSpecs schema minimal", () => {
    const recordMutationResult = runtime("recordMutationResult");
    const regionRecordFromResults = runtime("regionRecordFromResults");
    const plan = [
      survivor({ rel: "src/api/rules.ts", start: 46, end: 47, repl: ">", op: "<→>" }),
      survivor({ rel: "src/api/rules.ts", start: 97, end: 99, repl: "<=", op: ">=→<=" }),
      survivor({ rel: "src/api/rules.ts", start: 149, end: 152, repl: "!==", op: "===→!==" }),
    ];

    expect(recordMutationResult(plan[0], "green")).toEqual({
      caught: false,
      survivorSpec: plan[0],
    });
    expect(recordMutationResult(plan[1], "fail")).toEqual({ caught: true, survivorSpec: null });
    expect(recordMutationResult(plan[2], "timeout")).toEqual({ caught: true, survivorSpec: null });

    expect(
      regionRecordFromResults({ plan, statuses: ["green", "fail", "timeout"], threshold: 0.9 }),
    ).toEqual({
      caught: 2,
      total: 3,
      p: 0.6666666666666666,
      lo: 0.2076549551264879,
      hi: 0.9385096847238394,
      admissible: false,
      survivorSpecs: [plan[0]],
    });
  });
});

describe("fence runtime filtered refresh", () => {
  it("preserves prior unfiltered regions while updating top-level baseline metadata", () => {
    const mergeFilteredAuditArtifact = runtime("mergeFilteredAuditArtifact");
    const previous = artifact({
      baseline: "OLD",
      baselineSha: "0000000000000000000000000000000000000000",
      generatedAt: "2026-05-22T00:00:00.000Z",
      regions: {
        api: regionRecord({ total: 1, survivorSpecs: [survivor({ rel: "src/api/old.ts" })] }),
        cli: regionRecord({
          caught: 35,
          total: 35,
          p: 1,
          lo: 0.9, // exact value is irrelevant to the merge behavior
          hi: 1,
          admissible: true,
          survivorSpecs: [],
        }),
      },
    });
    const refreshedApi = regionRecord({
      caught: 1,
      total: 1,
      p: 1,
      lo: 0.20654329147389294,
      hi: 1,
      admissible: false,
      survivorSpecs: [],
    });
    const refresh = artifact({
      baseline: "HEAD",
      baselineSha: "1111111111111111111111111111111111111111",
      generatedAt: "2026-05-23T12:00:00.000Z",
      capPerRegion: 5,
      seed: 123,
      regions: { api: refreshedApi },
    });

    expect(mergeFilteredAuditArtifact(previous, refresh, ["api"])).toEqual({
      ...refresh,
      regions: {
        api: refreshedApi,
        cli: previous.regions.cli,
      },
    });
  });

  it("only reuses prior regions when the measurement frame is unchanged", () => {
    const canReuseFilteredAuditArtifact = runtime("canReuseFilteredAuditArtifact");
    const previous = artifact();
    const matchingRefresh = artifact({
      generatedAt: "2026-05-23T12:05:00.000Z",
      regions: { api: regionRecord({ caught: 1, total: 1, survivorSpecs: [] }) },
    });

    expect(canReuseFilteredAuditArtifact(previous, matchingRefresh)).toBe(true);
    expect(
      canReuseFilteredAuditArtifact(
        previous,
        artifact({ baselineSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }),
      ),
    ).toBe(false);
    expect(canReuseFilteredAuditArtifact(previous, artifact({ threshold: 0.8 }))).toBe(false);
    expect(canReuseFilteredAuditArtifact(previous, artifact({ capPerRegion: 10 }))).toBe(false);
    expect(canReuseFilteredAuditArtifact(previous, artifact({ seed: 42 }))).toBe(false);
    expect(canReuseFilteredAuditArtifact({ ...previous, schemaVersion: 0 }, matchingRefresh)).toBe(
      false,
    );
  });
});

describe("fence runtime audit cleanup", () => {
  it("fails closed and removes the fence worktree when an unexpected runtime error happens after baseline green", async () => {
    const root = fixtureRoot("codenuke-fence-cleanup-");
    const worktree = join(root, "..", "cleanup-worktree");
    const fenceWorktree = `${worktree}-fence`;
    const marker = join(root, ".codenuke", "baseline-ran.txt");
    const testScript = join(root, "scripts", "green.mjs");
    initRepo(root);
    write(root, "src/api/rules.ts", "export const allows = (value: number) => value < 10;\n");
    write(
      root,
      "scripts/green.mjs",
      [
        'import { appendFileSync, mkdirSync } from "node:fs";',
        'import { dirname } from "node:path";',
        "mkdirSync(dirname(process.env.CN_BASELINE_MARKER), { recursive: true });",
        "appendFileSync(process.env.CN_BASELINE_MARKER, `${process.cwd()}\\n`);",
        "",
      ].join("\n"),
    );
    write(root, "artifact-parent-is-file", "not a directory\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "fixtures"]);

    try {
      const settled = await runFenceCommand(
        ["1", "1337"],
        {
          ...process.env,
          CN_REPO: root,
          CN_SRC: "src",
          CN_TARGET: "src/api",
          CN_REGIONS: "api",
          CN_BASE: "HEAD",
          CN_WORKTREE: worktree,
          CN_FENCE: join(root, "artifact-parent-is-file", "fence-fidelity.json"),
          CN_TEST: nodeCommand(testScript),
          CN_BASELINE_MARKER: marker,
        },
        root,
      ).then(
        (result) => ({ status: "fulfilled" as const, result }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      );

      expect.soft(readFileSync(marker, "utf8")).toContain(fenceWorktree);
      expect.soft(settled.status).toBe("fulfilled");
      expect.soft(settled.status === "fulfilled" ? settled.result.exitCode : undefined).toBe(1);
      expect
        .soft(settled.status === "fulfilled" ? (settled.result.stderr ?? "") : "")
        .toContain("artifact-parent-is-file");
      expect.soft(existsSync(fenceWorktree)).toBe(false);
    } finally {
      removeFixtureWorktree(root, fenceWorktree);
    }
  });
});

describe("fence runtime replay guards and monotonicity", () => {
  it("resolves worktree paths and rejects traversal and symlink escapes before writes", () => {
    const safeWorktreePath = runtime("safeWorktreePath");
    const root = mkdtempSync(join(tmpdir(), "codenuke-safe-path-"));
    mkdirSync(join(root, "src", "api"), { recursive: true });
    writeFileSync(join(root, "src", "api", "rules.ts"), "export const ok = true;\n");
    symlinkSync("/tmp", join(root, "src", "api", "escape.ts"));

    expect(safeWorktreePath(root, "src/api/rules.ts")).toMatch(/src\/api\/rules\.ts$/u);
    expect(() => safeWorktreePath(root, "../outside.ts")).toThrow(
      "unsafe survivor path before replay: ../outside.ts",
    );
    expect(() => safeWorktreePath(root, "src/api/escape.ts")).toThrow(
      "unsafe survivor path before replay: src/api/escape.ts",
    );
  });

  it("aborts replay when a survivor source file changed or escapes the worktree", () => {
    const assertReplaySourcesUnchanged = runtime("assertReplaySourcesUnchanged");
    const unchanged = "export const lt = (a: number, b: number) => a < b;\n";

    expect(() =>
      assertReplaySourcesUnchanged({
        artifact: artifact(),
        region: "api",
        readBaseline: () => unchanged,
        readWorktree: () => "export const lt = (a: number, b: number) => a <= b;\n",
        worktreeRoot: "/tmp/codenuke-run-api",
      }),
    ).toThrow("source changed before replay: src/api/rules.ts");

    expect(() =>
      assertReplaySourcesUnchanged({
        artifact: artifact({
          regions: { api: regionRecord({ survivorSpecs: [survivor({ rel: "../outside.ts" })] }) },
        }),
        region: "api",
        readBaseline: () => unchanged,
        readWorktree: () => unchanged,
        worktreeRoot: "/tmp/codenuke-run-api",
      }),
    ).toThrow("unsafe survivor path before replay: ../outside.ts");
  });

  it("aborts replay when the worktree baseline is not green", () => {
    const assertReplayBaselineGreen = runtime("assertReplayBaselineGreen");

    expect(() => assertReplayBaselineGreen("green")).not.toThrow();
    expect(() => assertReplayBaselineGreen("fail")).toThrow("worktree baseline not green");
    expect(() => assertReplayBaselineGreen("timeout")).toThrow("worktree baseline not green");
  });

  it("retests only prior survivors, keeps total fixed, and can only shrink survivorSpecs", () => {
    const replaySurvivors = runtime("replaySurvivors");
    const before = artifact({
      regions: {
        api: regionRecord({
          caught: 1,
          total: 3,
          p: 0.3333333333333333,
          lo: 0.0614903152761605,
          hi: 0.7923450448735121,
          admissible: false,
          survivorSpecs: [
            survivor({ start: 46, end: 47, repl: ">", op: "<→>" }),
            survivor({ start: 97, end: 99, repl: "<=", op: ">=→<=" }),
          ],
        }),
      },
    });

    const after = replaySurvivors({
      artifact: before,
      region: "api",
      statuses: ["fail", "green"],
      threshold: 0.9,
    });

    expect(after.regions.api).toEqual({
      caught: 2,
      total: 3,
      p: 0.6666666666666666,
      lo: 0.2076549551264879,
      hi: 0.9385096847238394,
      admissible: false,
      survivorSpecs: [survivor({ start: 97, end: 99, repl: "<=", op: ">=→<=" })],
    });
    expect(after.regions.api.total).toBe(before.regions.api.total);
    expect(after.regions.api.caught).toBeGreaterThanOrEqual(before.regions.api.caught);
    expect(after.regions.api.lo).toBeGreaterThanOrEqual(before.regions.api.lo);
    expect(after.regions.api.survivorSpecs.length).toBeLessThanOrEqual(
      before.regions.api.survivorSpecs.length,
    );
  });
});
