import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runAutoloop } from "../main/runtime.js";
import { nodeCommandEnv, scriptedProposerAdapter } from "./proposer-fixture.js";

interface ResultRow {
  readonly iter: string;
  readonly commit: string;
  readonly dAST: string;
  readonly dCx: string;
  readonly behavior: string;
  readonly mfence: string;
  readonly loss: string;
  readonly status: string;
  readonly description: string;
}

const created: string[] = [];
const Z95 = 1.96;

afterAll(() => {
  for (const path of created.toReversed()) {
    rmSync(path, { recursive: true, force: true });
  }
});

function fixtureRoot(name = "codenuke-autoloop-reduce-"): string {
  const root = mkdtempSync(join(tmpdir(), name));
  created.push(root);
  return root;
}

function fixtureWorktree(name = "codenuke-autoloop-reduce-wt-"): string {
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

function writeAdmissibleFence(root: string, baselineSha: string): void {
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
          api: {
            caught: 99,
            total: 100,
            p: stats.p,
            lo: stats.lo,
            hi: stats.hi,
            admissible: true,
            survivorSpecs: [
              { rel: "src/api/rules.ts", start: 0, end: 1, repl: "x", op: "replace" },
            ],
          },
          cli: {
            caught: 99,
            total: 100,
            p: stats.p,
            lo: stats.lo,
            hi: stats.hi,
            admissible: true,
            survivorSpecs: [
              { rel: "src/cli/index.ts", start: 0, end: 1, repl: "x", op: "replace" },
            ],
          },
        },
      },
      null,
      2,
    ),
  );
}

function readRows(root: string): ResultRow[] {
  const text = readFileSync(join(root, ".codenuke/results.tsv"), "utf8").trim();
  const [header, ...rows] = text.split(/\r?\n/u);
  const columns = header.split("\t") as (keyof ResultRow)[];
  return rows.map((row) => {
    const values = row.split("\t");
    return Object.fromEntries(
      columns.map((column, index) => [column, values[index] ?? ""]),
    ) as unknown as ResultRow;
  });
}

function expectRows(root: string, stdout: string): ResultRow[] {
  if (!existsSync(join(root, ".codenuke/results.tsv"))) {
    throw new Error(stdout);
  }
  return readRows(root);
}

function setupReduceFixture(extra: {
  readonly proposerScript: string;
  readonly env?: Record<string, string | undefined>;
}): {
  readonly root: string;
  readonly worktree: string;
  readonly env: Record<string, string | undefined>;
  readonly baselineSha: string;
  readonly proposerAdapter: ReturnType<typeof scriptedProposerAdapter>;
} {
  const root = fixtureRoot();
  const worktree = fixtureWorktree();
  initRepo(root);
  write(root, "package.json", JSON.stringify({ name: "autoloop-reduce-fixture" }, null, 2));
  write(root, "src/api/rules.ts", "export function apiValue() {\n  return 10;\n}\n");
  write(root, "src/cli/index.ts", "export function cliValue() {\n  return 20;\n}\n");
  write(root, "scripts/test-command.mjs", "process.exit(0);\n");
  const proposerCommand = write(root, "scripts/proposer.mjs", extra.proposerScript.trimStart());
  const program = write(
    root,
    ".codenuke/program.md",
    "Make one behavior-preserving source reduction.\n",
  );
  const baselineSha = commit(root, "baseline");
  writeCalibration(root, baselineSha);
  writeAdmissibleFence(root, baselineSha);

  return {
    root,
    worktree,
    baselineSha,
    env: {
      ...process.env,
      CN_REPO: root,
      CN_SRC: "src",
      CN_TARGET: "src",
      CN_REGIONS: "api,cli",
      CN_BASE: "HEAD",
      CN_TAG: `reduce-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      CN_WORKTREE: worktree,
      CN_STATE: join(root, ".codenuke/autoloop.state.json"),
      CN_FENCE: join(root, ".codenuke/fence-fidelity.json"),
      CN_RESULTS: join(root, ".codenuke/results.tsv"),
      ...nodeCommandEnv("CN_TEST", join(root, "scripts/test-command.mjs")),
      CN_PROGRAM: program,
      ...extra.env,
    },
    proposerAdapter: scriptedProposerAdapter(proposerCommand),
  };
}

describe("runAutoloop reduce runtime follow-ups", () => {
  it("streams iteration, proposer, and result-row progress through the optional reporter", async () => {
    const fixture = setupReduceFixture({
      proposerScript: "process.exit(0);\n",
    });
    const progress: string[] = [];

    const result = await runAutoloop(1, fixture.env, fixture.root, {
      reporter: { emit: (line) => progress.push(line) },
      proposerAdapter: fixture.proposerAdapter,
    });

    expect.soft(result.exitCode).toBe(0);
    expect(progress).toEqual(
      expect.arrayContaining([
        "run: resolving startup state",
        expect.stringContaining("--- iter 1/1 [reduce] api fence"),
        "  proposer start: provider=codex-sdk mode=reduce region=api target=src/api/",
        expect.stringContaining("  proposer result: provider=codex-sdk status=ok"),
        "  -> NOOP  no scorable src change",
        "\n=== done: 0 kept, 0 fence-raises ===",
      ]),
    );
  });

  it("rejects reduce proposer edits outside the configured source surface and cleans the worktree", async () => {
    const fixture = setupReduceFixture({
      proposerScript: `
import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync("docs", { recursive: true });
writeFileSync("docs/notes.md", "not source\\n");
`,
    });

    const result = await runAutoloop(1, fixture.env, fixture.root, {
      proposerAdapter: fixture.proposerAdapter,
    });
    const [row] = expectRows(fixture.root, result.stdout);

    expect.soft(result.exitCode).toBe(0);
    expect.soft(result.stdout).toContain("proposer start: provider=codex-sdk mode=reduce");
    expect.soft(result.stdout).toContain("proposer result: provider=codex-sdk status=ok");
    expect.soft(row?.status).toBe("revert");
    expect.soft(row?.description).toContain("outside reduce source surface");
    expect.soft(row?.description).toContain("docs/notes.md");
    expect
      .soft(git(fixture.worktree, ["rev-parse", "--verify", "HEAD"]).trim())
      .toBe(fixture.baselineSha);
    expect.soft(git(fixture.worktree, ["status", "--porcelain"])).toBe("");
    expect.soft(existsSync(join(fixture.worktree, "docs/notes.md"))).toBe(false);
  });

  it("logs crash-budget when the reduce proposer reports maximum budget exhaustion", async () => {
    const fixture = setupReduceFixture({
      proposerScript: `
console.error("Reached maximum budget ($1.5)");
process.exit(1);
`,
    });

    const result = await runAutoloop(1, fixture.env, fixture.root, {
      proposerAdapter: fixture.proposerAdapter,
    });
    const [row] = expectRows(fixture.root, result.stdout);

    expect.soft(result.exitCode).toBe(0);
    expect.soft(row?.status).toBe("crash-budget");
    expect.soft(row?.description).toContain("proposer budget exhausted");
    expect.soft(row?.description).toContain("Reached maximum budget");
    expect.soft(git(fixture.worktree, ["status", "--porcelain"])).toBe("");
  });

  it("logs crash-timeout when the reduce proposer exceeds CN_TIMEOUT", async () => {
    const fixture = setupReduceFixture({
      proposerScript: "setTimeout(() => {}, 5000);\n",
      env: { CN_TIMEOUT: "50" },
    });

    const result = await runAutoloop(1, fixture.env, fixture.root, {
      proposerAdapter: fixture.proposerAdapter,
    });
    const [row] = expectRows(fixture.root, result.stdout);

    expect.soft(result.exitCode).toBe(0);
    expect.soft(row?.status).toBe("crash-timeout");
    expect.soft(row?.description).toBe("proposer timeout after 50ms");
    expect.soft(git(fixture.worktree, ["status", "--porcelain"])).toBe("");
  });

  it("uses the target-filtered region for real reduce proposer runs", async () => {
    const fixture = setupReduceFixture({
      proposerScript: `
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const marker = join(process.env.CN_REPO, ".codenuke/reduce-target-marker.txt");
mkdirSync(dirname(marker), { recursive: true });
writeFileSync(marker, JSON.stringify({ region: process.env.CN_REGION, target: process.env.CN_TARGET }));
`,
      env: { CN_TARGET: "src/api" },
    });

    const result = await runAutoloop(1, fixture.env, fixture.root, {
      proposerAdapter: fixture.proposerAdapter,
    });
    expectRows(fixture.root, result.stdout);
    const marker = JSON.parse(
      readFileSync(join(fixture.root, ".codenuke/reduce-target-marker.txt"), "utf8"),
    ) as {
      readonly region?: string;
      readonly target?: string;
    };
    const [row] = readRows(fixture.root);

    expect.soft(result.exitCode).toBe(0);
    expect.soft(result.stdout).toContain("[reduce] api");
    expect.soft(marker).toEqual({ region: "api", target: "src/api/" });
    expect.soft(row?.status).toBe("noop");
    expect.soft(git(fixture.worktree, ["status", "--porcelain"])).toBe("");
  });
});
