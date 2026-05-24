import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { measure, type Files } from "@codenuke/measure";
import { afterAll, describe, expect, it } from "vitest";
import { runAutoloop } from "../main/runtime.js";

interface EngineState {
  readonly baselineSha: string;
  readonly baselineTsc: number;
  readonly startL: number;
  readonly accepted: readonly string[];
  readonly iter: number;
}

const created: string[] = [];
const Z95 = 1.96;

afterAll(() => {
  for (const path of created.toReversed()) {
    rmSync(path, { recursive: true, force: true });
  }
});

function fixtureRoot(name = "codenuke-autoloop-git-"): string {
  const root = mkdtempSync(join(tmpdir(), name));
  created.push(root);
  return root;
}

function fixtureWorktree(name = "codenuke-autoloop-git-wt-"): string {
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

function nodeCommand(path: string): string {
  return `node ${JSON.stringify(path)}`;
}

function wilson(
  caught: number,
  total: number,
): { readonly p: number; readonly lo: number; readonly hi: number } {
  const p = caught / total;
  const z2 = Z95 * Z95;
  const denom = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denom;
  const half = (Z95 * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / denom;
  return { p, lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

function readState(path: string): EngineState {
  return JSON.parse(readFileSync(path, "utf8")) as EngineState;
}

function writeCalibration(root: string, baselineSha: string): void {
  write(
    root,
    ".codenuke/calibration.json",
    JSON.stringify(
      {
        schemaVersion: 1,
        baseline: "HEAD",
        baselineSha,
        generatedAt: new Date().toISOString(),
        commitsSampled: 3,
        scales: { sL: 150, sCx: 15, sDup: 5 },
      },
      null,
      2,
    ),
  );
}

function writeAdmissibleFence(root: string, baselineSha: string, region = "src"): void {
  const stats = wilson(99, 100);
  write(
    root,
    ".codenuke/fence-fidelity.json",
    JSON.stringify(
      {
        schemaVersion: 1,
        baseline: "HEAD",
        baselineSha,
        generatedAt: new Date().toISOString(),
        method: "ast-aware",
        threshold: 0.9,
        capPerRegion: 60,
        seed: 1337,
        regions: {
          [region]: {
            caught: 99,
            total: 100,
            p: stats.p,
            lo: stats.lo,
            hi: stats.hi,
            admissible: true,
            survivorSpecs: [{ rel: "src/index.ts", start: 0, end: 1, repl: "x", op: "replace" }],
          },
        },
      },
      null,
      2,
    ),
  );
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
  write(root, "package.json", JSON.stringify({ name: "autoloop-git-fixture" }, null, 2));
  for (const [path, contents] of Object.entries(awkwardSourceFiles())) {
    write(root, path, contents);
  }
  write(
    root,
    "src/skip.test.ts",
    "export function skipTest() {\n  if (true) return 1;\n  return 2;\n}\n",
  );
  write(root, "src/types.d.ts", "export interface Skip {\n  value: string;\n}\n");
  write(root, "src/readme.md", "# ignored\n");
  return commit(root, "baseline with awkward source paths");
}

function passScript(root: string): string {
  return write(root, "scripts/pass.mjs", "process.exit(0);\n");
}

function baseEnv(
  root: string,
  worktree: string,
  extra: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  const pass = passScript(root);
  const program = write(
    root,
    ".codenuke/program.md",
    "Make a behavior-preserving source reduction.\n",
  );
  return {
    ...process.env,
    CN_REPO: root,
    CN_SRC: "src",
    CN_TARGET: "src",
    CN_REGIONS: "src",
    CN_BASE: "HEAD",
    CN_TAG: `autoloop-git-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    CN_WORKTREE: worktree,
    CN_STATE: join(root, ".codenuke/autoloop.state.json"),
    CN_FENCE: join(root, ".codenuke/fence-fidelity.json"),
    CN_RESULTS: join(root, ".codenuke/results.tsv"),
    CN_TEST: nodeCommand(pass),
    CN_TYPECHECK: "",
    CN_PROGRAM: program,
    ...extra,
  };
}

describe("runAutoloop git baseline and path discovery contract", () => {
  it("resolves the configured baseline before init and measures target sources from NUL-delimited ls-tree output", async () => {
    const root = fixtureRoot("codenuke-autoloop-ls-tree-");
    const baselineSha = writeAwkwardSourceRepo(root);
    git(root, ["branch", "moving-base", baselineSha]);
    writeCalibration(root, baselineSha);
    writeAdmissibleFence(root, baselineSha);
    const worktree = fixtureWorktree("codenuke-autoloop-ls-tree-wt-");
    const env = baseEnv(root, worktree, { CN_BASE: "refs/heads/moving-base" });

    const result = await runAutoloop(0, env, root);
    const state = readState(env.CN_STATE!);

    expect.soft(result.exitCode).toBe(0);
    expect.soft(state.baselineSha).toBe(baselineSha);
    expect.soft(git(worktree, ["rev-parse", "--verify", "HEAD"]).trim()).toBe(baselineSha);
    expect.soft(state.startL).toBe(measure(awkwardSourceFiles()).L);
  });

  it("keeps safety artifact freshness pinned to the initialized baseline SHA when a symbolic branch moves", async () => {
    const root = fixtureRoot("codenuke-autoloop-branch-move-");
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "autoloop-branch-move-fixture" }, null, 2));
    write(root, "src/index.ts", "export function value() {\n  return 1;\n}\n");
    const baselineSha = commit(root, "baseline");
    git(root, ["branch", "moving-base", baselineSha]);
    writeCalibration(root, baselineSha);
    writeAdmissibleFence(root, baselineSha);
    const worktree = fixtureWorktree("codenuke-autoloop-branch-move-wt-");
    const env = baseEnv(root, worktree, { CN_BASE: "refs/heads/moving-base" });
    expect((await runAutoloop(0, env, root)).exitCode).toBe(0);

    write(root, "src/other.ts", "export const moved = true;\n");
    const movedSha = commit(root, "move symbolic baseline");
    git(root, ["branch", "-f", "moving-base", movedSha]);

    const result = await runAutoloop(0, env, root);

    expect.soft(result.exitCode).toBe(0);
    expect.soft(readState(env.CN_STATE!).baselineSha).toBe(baselineSha);
    expect.soft(git(worktree, ["rev-parse", "--verify", "HEAD"]).trim()).toBe(baselineSha);
    expect.soft(result.stdout).not.toContain("stale");
  });

  it("fails closed when an existing autoloop state file lacks a pinned baseline SHA", async () => {
    const root = fixtureRoot("codenuke-autoloop-invalid-state-");
    const baselineSha = writeAwkwardSourceRepo(root);
    writeCalibration(root, baselineSha);
    writeAdmissibleFence(root, baselineSha);
    const worktree = fixtureWorktree("codenuke-autoloop-invalid-state-wt-");
    const env = baseEnv(root, worktree, { CN_BASE: baselineSha });
    write(
      root,
      ".codenuke/autoloop.state.json",
      JSON.stringify({ baselineTsc: 0, startL: 1, accepted: [], iter: 0 }, null, 2),
    );

    const result = await runAutoloop(1, env, root);

    expect.soft(result.exitCode).toBe(1);
    expect.soft(result.stdout).toContain("invalid autoloop state");
    expect.soft(result.stdout).toContain("baselineSha");
  });

  it("fails closed when an existing autoloop state baseline SHA is not in the repository", async () => {
    const root = fixtureRoot("codenuke-autoloop-missing-state-sha-");
    const baselineSha = writeAwkwardSourceRepo(root);
    writeCalibration(root, baselineSha);
    writeAdmissibleFence(root, baselineSha);
    const worktree = fixtureWorktree("codenuke-autoloop-missing-state-sha-wt-");
    const env = baseEnv(root, worktree, { CN_BASE: baselineSha });
    write(
      root,
      ".codenuke/autoloop.state.json",
      JSON.stringify(
        {
          baselineSha: "0123456789abcdef0123456789abcdef01234567",
          baselineTsc: 0,
          startL: 1,
          accepted: [],
          iter: 0,
        },
        null,
        2,
      ),
    );

    const result = await runAutoloop(1, env, root);

    expect.soft(result.exitCode).toBe(1);
    expect.soft(result.stdout).toContain("invalid autoloop state");
    expect.soft(result.stdout).toContain("baselineSha");
  });

  it("discovers changed sources from NUL-delimited diff output, preserving awkward filenames and filtering non-source paths", async () => {
    const root = fixtureRoot("codenuke-autoloop-diff-");
    const baselineSha = writeAwkwardSourceRepo(root);
    writeCalibration(root, baselineSha);
    writeAdmissibleFence(root, baselineSha);
    const proposer = write(
      root,
      "scripts/proposer.mjs",
      `
import { writeFileSync } from "node:fs";

writeFileSync(${JSON.stringify("src/line\nbreak.ts")}, "export const lineBreak = 1;\\n");
writeFileSync(${JSON.stringify('src/quote "module".ts')}, "export const quoted = 1;\\n");
writeFileSync(${JSON.stringify("src/space name.ts")}, "export const spaced = 1;\\n");
`.trimStart(),
    );
    const worktree = fixtureWorktree("codenuke-autoloop-diff-wt-");
    const env = baseEnv(root, worktree, {
      CN_BASE: baselineSha,
      CN_PROPOSER: nodeCommand(proposer),
    });

    const result = await runAutoloop(1, env, root);

    expect.soft(result.exitCode).toBe(0);
    expect.soft(result.stdout).toContain("line\nbreak.ts");
    expect.soft(result.stdout).toContain('quote "module".ts');
    expect.soft(result.stdout).toContain("space name.ts");
    expect.soft(result.stdout).not.toContain("skip.test.ts");
    expect.soft(result.stdout).not.toContain("types.d.ts");
    expect.soft(result.stdout).not.toContain("readme.md");
  });
});
