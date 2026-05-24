import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runAutoloop } from "../main/runtime.js";
import { nodeCommandEnv, scriptedProposerAdapter } from "./proposer-fixture.js";

const created: string[] = [];
const Z95 = 1.96;

afterAll(() => {
  for (const path of created.toReversed()) {
    rmSync(path, { recursive: true, force: true });
  }
});

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "codenuke-autoloop-program-"));
  created.push(root);
  return root;
}

function fixtureWorktree(): string {
  const parent = mkdtempSync(join(tmpdir(), "codenuke-autoloop-program-wt-"));
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
        },
      },
      null,
      2,
    ),
  );
}

function setupReduceFixture(): {
  readonly root: string;
  readonly env: Record<string, string | undefined>;
  readonly proposerMarker: string;
  readonly proposerAdapter: ReturnType<typeof scriptedProposerAdapter>;
} {
  const root = fixtureRoot();
  const worktree = fixtureWorktree();
  initRepo(root);
  write(root, "package.json", JSON.stringify({ name: "autoloop-program-fixture" }, null, 2));
  write(root, "src/api/rules.ts", "export function limit() {\n  return 10;\n}\n");
  write(root, "scripts/test-command.mjs", "process.exit(0);\n");
  const proposerMarker = join(root, ".codenuke/proposer-called");
  const proposerCommand = write(
    root,
    "scripts/proposer.mjs",
    `
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const marker = join(process.env.CN_REPO, ".codenuke/proposer-called");
mkdirSync(dirname(marker), { recursive: true });
writeFileSync(marker, "called\\n");
`.trimStart(),
  );
  const baselineSha = commit(root, "baseline");
  writeCalibration(root, baselineSha);
  writeAdmissibleFence(root, baselineSha);

  return {
    root,
    proposerMarker,
    env: {
      ...process.env,
      CN_REPO: root,
      CN_SRC: "src",
      CN_TARGET: "src/api",
      CN_REGIONS: "api",
      CN_BASE: "HEAD",
      CN_TAG: "program-missing",
      CN_WORKTREE: worktree,
      CN_STATE: join(root, ".codenuke/autoloop.state.json"),
      CN_FENCE: join(root, ".codenuke/fence-fidelity.json"),
      CN_RESULTS: join(root, ".codenuke/results.tsv"),
      ...nodeCommandEnv("CN_TEST", join(root, "scripts/test-command.mjs")),
      CN_PROGRAM: join(root, "missing-program.md"),
    },
    proposerAdapter: scriptedProposerAdapter(proposerCommand),
  };
}

describe("runAutoloop reduce program contract", () => {
  it("fails closed before invoking the proposer when the reducer program file is missing", async () => {
    const fixture = setupReduceFixture();

    const result = await runAutoloop(1, fixture.env, fixture.root, {
      proposerAdapter: fixture.proposerAdapter,
    });

    expect.soft(result.exitCode).toBe(1);
    expect.soft(result.stdout).toMatch(/program\.md.*missing|missing.*program\.md/u);
    expect.soft(existsSync(fixture.proposerMarker)).toBe(false);
  });

  it("fails closed before invoking the proposer when the reducer program file is empty", async () => {
    const fixture = setupReduceFixture();
    writeFileSync(fixture.env.CN_PROGRAM!, "");

    const result = await runAutoloop(1, fixture.env, fixture.root, {
      proposerAdapter: fixture.proposerAdapter,
    });

    expect.soft(result.exitCode).toBe(1);
    expect.soft(result.stdout).toMatch(/program\.md.*empty|empty.*program\.md/u);
    expect.soft(existsSync(fixture.proposerMarker)).toBe(false);
  });
});
