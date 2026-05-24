import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { runAutoloop } from "../main/runtime.js";

interface RuntimeResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr?: string;
}

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
  for (const path of created.toReversed()) rmSync(path, { recursive: true, force: true });
});

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "codenuke-autoloop-raise-"));
  created.push(root);
  return root;
}

function fixtureWorktree(): string {
  const parent = mkdtempSync(join(tmpdir(), "codenuke-autoloop-raise-wt-"));
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

function wilson(caught: number, total: number): { readonly p: number; readonly lo: number; readonly hi: number } {
  if (total === 0) return { p: 0, lo: 0, hi: 1 };
  const p = caught / total;
  const z2 = Z95 * Z95;
  const denom = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denom;
  const half = (Z95 * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / denom;
  return { p, lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

function writeRepoTestCommand(root: string): string {
  return write(
    root,
    "scripts/test-command.mjs",
    `
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function collect(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? collect(path) : [path];
  });
}

const source = readFileSync("src/api/rules.ts", "utf8");
const tests = collect("tests").map((path) => readFileSync(path, "utf8")).join("\\n");
if (tests.includes("FAIL_CURRENT")) process.exit(1);
if (existsSync("tests/api/rules.test.ts") && source.includes("return 11")) process.exit(1);
process.exit(0);
`.trimStart(),
  );
}

function proposer(root: string, name: string, body: string): string {
  return write(root, `scripts/${name}.mjs`, body.trimStart());
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

function writeFenceArtifact(
  root: string,
  baselineSha: string,
  survivor: { readonly rel: string; readonly start: number; readonly end: number; readonly repl: string; readonly op: string },
): void {
  const stats = wilson(0, 1);
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
            caught: 0,
            total: 1,
            p: stats.p,
            lo: stats.lo,
            hi: stats.hi,
            admissible: false,
            survivorSpecs: [survivor],
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
  const columns = header!.split("\t") as (keyof ResultRow)[];
  return rows.map((row) => {
    const values = row.split("\t");
    return Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ""])) as unknown as ResultRow;
  });
}

function readFence(root: string): {
  readonly regions: Record<string, { readonly caught: number; readonly total: number; readonly lo: number; readonly survivorSpecs: unknown[] }>;
} {
  return JSON.parse(readFileSync(join(root, ".codenuke/fence-fidelity.json"), "utf8")) as {
    regions: Record<string, { caught: number; total: number; lo: number; survivorSpecs: unknown[] }>;
  };
}

function setupRaiseFixture(extra: {
  readonly proposerScript: string;
  readonly survivorRel?: string;
}): {
  readonly root: string;
  readonly worktree: string;
  readonly env: Record<string, string | undefined>;
  readonly baselineSha: string;
  readonly source: string;
} {
  const root = fixtureRoot();
  const worktree = fixtureWorktree();
  initRepo(root);
  const source = "export function limit() {\n  return 10;\n}\n";
  write(root, "package.json", JSON.stringify({ name: "autoloop-raise-fixture" }, null, 2));
  write(root, "src/api/rules.ts", source);
  write(root, "tests/smoke.test.ts", "// existing discovered test root\n");
  write(root, "codenuke.benchmark/fixture/meta.json", JSON.stringify({ id: "fixture" }, null, 2));
  const baselineSha = commit(root, "baseline");
  const testCommand = writeRepoTestCommand(root);
  const proposerCommand = proposer(root, "proposer.mjs", extra.proposerScript);
  writeCalibration(root, baselineSha);
  const start = source.indexOf("10");
  writeFenceArtifact(root, baselineSha, {
    rel: extra.survivorRel ?? "src/api/rules.ts",
    start: extra.survivorRel ? 0 : start,
    end: extra.survivorRel ? 1 : start + 2,
    repl: extra.survivorRel ? "x" : "11",
    op: "replace",
  });

  return {
    root,
    worktree,
    env: {
      ...process.env,
      CN_REPO: root,
      CN_SRC: "src",
      CN_TARGET: "src/api",
      CN_REGIONS: "api",
      CN_BASE: "HEAD",
      CN_TAG: `raise-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      CN_WORKTREE: worktree,
      CN_STATE: join(root, ".codenuke/autoloop.state.json"),
      CN_FENCE: join(root, ".codenuke/fence-fidelity.json"),
      CN_RESULTS: join(root, ".codenuke/results.tsv"),
      CN_TEST: nodeCommand(testCommand),
      CN_TYPECHECK: "",
      CN_PROPOSER: nodeCommand(proposerCommand),
    },
    baselineSha,
    source,
  };
}

async function runRaise(extra: { readonly proposerScript: string; readonly survivorRel?: string }): Promise<
  RuntimeResult & {
    readonly root: string;
    readonly worktree: string;
    readonly baselineSha: string;
  }
> {
  const fixture = setupRaiseFixture(extra);
  const result = await runAutoloop(1, fixture.env, fixture.root);
  return { ...result, root: fixture.root, worktree: fixture.worktree, baselineSha: fixture.baselineSha };
}

const addKillingTest = `
import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync("tests/api", { recursive: true });
writeFileSync("tests/api/rules.test.ts", "// asserts limit remains 10\\n");
`;

describe("runAutoloop raise replay (RULE-042/RULE-043)", () => {
  it("keeps a raise test commit and updates the fence when replay improves the region lower bound", async () => {
    const result = await runRaise({ proposerScript: addKillingTest });

    expect(result.exitCode).toBe(0);
    const [row] = readRows(result.root);
    expect(row?.status).toBe("raise");
    expect(row?.commit).toMatch(/^[0-9a-f]{7,}$/u);
    expect(row?.description).toContain("api fence");
    expect(result.stdout).toContain("RAISE");

    const fence = readFence(result.root);
    expect(fence.regions.api?.caught).toBe(1);
    expect(fence.regions.api?.total).toBe(1);
    expect(fence.regions.api?.survivorSpecs).toHaveLength(0);
    expect(git(result.worktree, ["rev-parse", "--verify", "HEAD"]).trim()).not.toBe(result.baselineSha);
    expect(git(result.worktree, ["show", "--name-only", "--format=", "HEAD"]).split(/\r?\n/u)).toContain("tests/api/rules.test.ts");
    expect(git(result.worktree, ["status", "--porcelain"])).toBe("");
  });

  it("rejects a no-op raise proposer before replay and keeps the worktree at the baseline", async () => {
    const result = await runRaise({ proposerScript: "process.exit(0);\n" });

    const [row] = readRows(result.root);
    expect(row?.status).toBe("raise-noop");
    expect(row?.description).toContain("no tests added");
    expect(git(result.worktree, ["rev-parse", "--verify", "HEAD"]).trim()).toBe(result.baselineSha);
    expect(git(result.worktree, ["status", "--porcelain"])).toBe("");
  });

  it("rejects raise edits outside the discovered test surface", async () => {
    const result = await runRaise({
      proposerScript: `
import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync("src/api", { recursive: true });
writeFileSync("src/api/rules.test.ts", "// co-located test is outside discovered tests/ surface\\n");
`,
    });

    const [row] = readRows(result.root);
    expect(row?.status).toBe("raise-badtest");
    expect(row?.description).toContain("outside discovered test surface");
    expect(git(result.worktree, ["rev-parse", "--verify", "HEAD"]).trim()).toBe(result.baselineSha);
    expect(git(result.worktree, ["status", "--porcelain"])).toBe("");
  });

  it("rejects staged renames from non-test paths into the discovered test surface", async () => {
    const result = await runRaise({
      proposerScript: `
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
mkdirSync("tests", { recursive: true });
execFileSync("git", ["mv", "package.json", "tests/package.test.ts"]);
`,
    });

    const [row] = readRows(result.root);
    expect(row?.status).toBe("raise-badtest");
    expect(row?.description).toContain("package.json");
    expect(git(result.worktree, ["rev-parse", "--verify", "HEAD"]).trim()).toBe(result.baselineSha);
    expect(git(result.worktree, ["status", "--porcelain"])).toBe("");
  });

  it("rejects tests that fail against the unmutated current code", async () => {
    const result = await runRaise({
      proposerScript: `
import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync("tests/api", { recursive: true });
writeFileSync("tests/api/rules.test.ts", "FAIL_CURRENT\\n");
`,
    });

    const [row] = readRows(result.root);
    expect(row?.status).toBe("raise-badtest");
    expect(row?.description).toContain("added tests fail on current code");
    expect(git(result.worktree, ["rev-parse", "--verify", "HEAD"]).trim()).toBe(result.baselineSha);
    expect(git(result.worktree, ["status", "--porcelain"])).toBe("");
  });

  it("discards a valid raise test commit when replay gives no lower-bound improvement", async () => {
    const result = await runRaise({
      proposerScript: `
import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync("tests/api", { recursive: true });
writeFileSync("tests/api/harmless.test.ts", "// does not kill the survivor\\n");
`,
    });

    const [row] = readRows(result.root);
    expect(row?.status).toBe("raise-nogain");
    expect(row?.commit).toBe("-");
    expect(row?.description).toContain("api fence");
    expect(readFence(result.root).regions.api?.caught).toBe(0);
    expect(git(result.worktree, ["rev-parse", "--verify", "HEAD"]).trim()).toBe(result.baselineSha);
    expect(git(result.worktree, ["status", "--porcelain"])).toBe("");
  });

  it("restores staged benchmark deletion before committing a successful raise", async () => {
    const result = await runRaise({
      proposerScript: `
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
execFileSync("git", ["add", "-A", "codenuke.benchmark"]);
mkdirSync("tests/api", { recursive: true });
writeFileSync("tests/api/rules.test.ts", "// asserts limit remains 10\\n");
`,
    });

    const [row] = readRows(result.root);
    expect(row?.status).toBe("raise");
    const committedFiles = git(result.worktree, ["show", "--name-only", "--format=", "HEAD"])
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
    expect(committedFiles).toEqual(["tests/api/rules.test.ts"]);
    expect(existsSync(join(result.worktree, "codenuke.benchmark/fixture/meta.json"))).toBe(true);
    expect(git(result.worktree, ["status", "--porcelain"])).toBe("");
  });

  it("discards a valid raise test commit and logs raise-error when modern fence replay fails", async () => {
    const result = await runRaise({
      proposerScript: addKillingTest,
      survivorRel: "src/api/missing.ts",
    });

    const [row] = readRows(result.root);
    expect(row?.status).toBe("raise-error");
    expect(row?.commit).toBe("-");
    expect(row?.description).toContain("replay failed:");
    expect(git(result.worktree, ["rev-parse", "--verify", "HEAD"]).trim()).toBe(result.baselineSha);
    expect(git(result.worktree, ["status", "--porcelain"])).toBe("");
  });
});
