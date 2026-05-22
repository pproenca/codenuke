import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cli = fileURLToPath(new URL("../bin/codenuke.mjs", import.meta.url));

function fixtureRoot(name) {
  return mkdtempSync(join(tmpdir(), name));
}

function write(root, path, contents) {
  const absolute = join(root, path);
  mkdirSync(absolute.split("/").slice(0, -1).join("/"), { recursive: true });
  writeFileSync(absolute, contents);
}

function git(root, args) {
  execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

function initRepo(root) {
  git(root, ["init"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test User"]);
  git(root, ["config", "commit.gpgsign", "false"]);
}

function commit(root, message) {
  git(root, ["add", "."]);
  git(root, ["commit", "-m", message]);
}

function gitOutput(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

describe("codenuke run", () => {
  it("aborts before initializing when the fence artifact is missing", () => {
    const root = fixtureRoot("codenuke-run-no-fence-");
    const tag = `no-fence-${Date.now()}`;
    const worktree = join(tmpdir(), `codenuke-run-no-fence-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-run-no-fence-state-${Date.now()}.json`);
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "run-no-fence" }));
    write(root, "src/index.ts", "export const value = 1;\n");
    commit(root, "initial");

    const result = spawnSync("node", [cli, "run", "1"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CN_TEST: 'node -e "process.exit(0)"',
        CN_TYPECHECK: "",
        CN_PROPOSER: "true",
        CN_TAG: tag,
        CN_WORKTREE: worktree,
        CN_STATE: state,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("run `codenuke fence` first");
    expect(result.stdout).toContain("codenuke doctor");
    expect(existsSync(worktree)).toBe(false);
    expect(existsSync(join(root, ".codenuke/results.tsv"))).toBe(false);
  });

  it("aborts before initializing when calibration is missing", () => {
    const root = fixtureRoot("codenuke-run-no-calibration-");
    const tag = `no-calibration-${Date.now()}`;
    const worktree = join(tmpdir(), `codenuke-run-no-calibration-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-run-no-calibration-state-${Date.now()}.json`);
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "run-no-calibration" }));
    write(root, "src/index.ts", "export const value = 1;\n");
    commit(root, "initial");
    write(
      root,
      ".codenuke/fence-fidelity.json",
      JSON.stringify({
        baseline: "HEAD",
        generatedAt: "2026-05-22T00:00:00.000Z",
        method: "ast-aware",
        threshold: 0.9,
        capPerRegion: 60,
        seed: 1337,
        regions: {
          src: {
            caught: 35,
            total: 35,
            p: 1,
            lo: 0.901,
            hi: 1,
            admissible: true,
            survivorSpecs: [],
          },
        },
      }),
    );

    const result = spawnSync("node", [cli, "run", "1"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CN_TEST: 'node -e "process.exit(0)"',
        CN_TYPECHECK: "",
        CN_PROPOSER: "true",
        CN_TAG: tag,
        CN_WORKTREE: worktree,
        CN_STATE: state,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("run `codenuke calibrate` first");
    expect(result.stdout).toContain("codenuke doctor");
    expect(existsSync(worktree)).toBe(false);
    expect(existsSync(join(root, ".codenuke/results.tsv"))).toBe(false);
  });

  it("halts when a blocked region has no survivor specs to raise", () => {
    const root = fixtureRoot("codenuke-run-raise-skip-terminal-");
    const tag = `raise-skip-${Date.now()}`;
    const worktree = join(tmpdir(), `codenuke-run-raise-skip-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-run-raise-skip-state-${Date.now()}.json`);
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "run-raise-skip" }));
    write(root, "src/index.ts", "export const value = 1;\n");
    commit(root, "initial");
    write(
      root,
      ".codenuke/fence-fidelity.json",
      JSON.stringify({
        baseline: "HEAD",
        generatedAt: "2026-05-22T00:00:00.000Z",
        method: "ast-aware",
        threshold: 0.9,
        capPerRegion: 60,
        seed: 1337,
        regions: {
          src: {
            caught: 0,
            total: 0,
            p: 0,
            lo: 0,
            hi: 1,
            admissible: false,
            survivorSpecs: [],
          },
        },
      }),
    );
    write(
      root,
      ".codenuke/calibration.json",
      JSON.stringify({
        baseline: "HEAD",
        generatedAt: "2026-05-22T00:00:00.000Z",
        commitsSampled: 3,
        scales: { sL: 1, sCx: 1, sDup: 1 },
      }),
    );

    const result = spawnSync("node", [cli, "run", "3"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CN_TEST: 'node -e "process.exit(0)"',
        CN_TYPECHECK: "",
        CN_PROPOSER: "true",
        CN_TAG: tag,
        CN_WORKTREE: worktree,
        CN_STATE: state,
      },
    });

    expect(result.status).toBe(0);
    const results = readFileSync(join(root, ".codenuke/results.tsv"), "utf8").trim().split("\n");
    expect(results).toHaveLength(2);
    expect(results[1]).toContain("\traise-skip\t");
    expect(result.stdout).not.toContain("--- iter 2/3");
  });

  it("iterates detected fence regions instead of the default target slug", () => {
    const root = fixtureRoot("codenuke-run-regions-");
    const tag = `regions-${Date.now()}`;
    const worktree = join(tmpdir(), `codenuke-run-regions-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-run-regions-state-${Date.now()}.json`);
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "run-regions" }));
    write(
      root,
      "src/a/index.ts",
      `
export function value(input) {
  const first = input + 1;
  const second = first + 1;
  const third = second + 1;
  return third;
}
`,
    );
    write(root, "src/b/index.ts", "export const untouched = true;\n");
    commit(root, "initial");
    const branchBefore = gitOutput(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const headBefore = gitOutput(root, ["rev-parse", "HEAD"]);
    write(
      root,
      ".codenuke/fence-fidelity.json",
      JSON.stringify({
        baseline: "HEAD",
        generatedAt: "2026-05-22T00:00:00.000Z",
        method: "ast-aware",
        threshold: 0.9,
        capPerRegion: 60,
        seed: 1337,
        regions: {
          a: { caught: 35, total: 35, p: 1, lo: 0.901, hi: 1, admissible: true, survivorSpecs: [] },
          b: { caught: 35, total: 35, p: 1, lo: 0.901, hi: 1, admissible: true, survivorSpecs: [] },
        },
      }),
    );
    write(
      root,
      ".codenuke/calibration.json",
      JSON.stringify({
        baseline: "HEAD",
        generatedAt: "2026-05-22T00:00:00.000Z",
        commitsSampled: 3,
        scales: { sL: 1, sCx: 1, sDup: 1 },
      }),
    );
    const proposer = join(root, "proposer.mjs");
    write(
      root,
      "proposer.mjs",
      `
import { writeFileSync } from "node:fs";
writeFileSync("src/a/index.ts", "export const value = (input) => input + 3;\\n");
`,
    );

    const result = spawnSync("node", [cli, "run", "1"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CN_TEST: 'node -e "process.exit(0)"',
        CN_TYPECHECK: "",
        CN_PROPOSER: `node ${JSON.stringify(proposer)}`,
        CN_TAG: tag,
        CN_WORKTREE: worktree,
        CN_STATE: state,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("→ KEEP");
    const results = readFileSync(join(root, ".codenuke/results.tsv"), "utf8");
    expect(results).toContain("\tkeep\t");
    expect(results).not.toContain("\traise-skip\t");
    expect(gitOutput(root, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(branchBefore);
    expect(gitOutput(root, ["rev-parse", "HEAD"])).toBe(headBefore);
    expect(gitOutput(root, ["rev-parse", "--verify", `refs/heads/autoresearch/${tag}`])).not.toBe(
      headBefore,
    );
    expect(gitOutput(root, ["show", `autoresearch/${tag}:src/a/index.ts`])).toBe(
      "export const value = (input) => input + 3;",
    );
    expect(gitOutput(worktree, ["status", "--porcelain"])).toBe("");
    expect(
      spawnSync("node", ["-e", "process.exit(0)"], {
        cwd: worktree,
        encoding: "utf8",
      }).status,
    ).toBe(0);
  });

  it("respects a target filter when choosing the active region", () => {
    const root = fixtureRoot("codenuke-run-target-");
    const tag = `target-${Date.now()}`;
    const worktree = join(tmpdir(), `codenuke-run-target-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-run-target-state-${Date.now()}.json`);
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "run-target" }));
    write(root, "src/a/index.ts", "export const a = 1;\n");
    write(
      root,
      "src/b/index.ts",
      `
export function value(input) {
  const first = input + 1;
  const second = first + 1;
  return second;
}
`,
    );
    commit(root, "initial");
    write(
      root,
      ".codenuke/fence-fidelity.json",
      JSON.stringify({
        baseline: "HEAD",
        generatedAt: "2026-05-22T00:00:00.000Z",
        method: "ast-aware",
        threshold: 0.9,
        capPerRegion: 60,
        seed: 1337,
        regions: {
          a: { caught: 35, total: 35, p: 1, lo: 0.901, hi: 1, admissible: true, survivorSpecs: [] },
          b: { caught: 35, total: 35, p: 1, lo: 0.901, hi: 1, admissible: true, survivorSpecs: [] },
        },
      }),
    );
    write(
      root,
      ".codenuke/calibration.json",
      JSON.stringify({
        baseline: "HEAD",
        generatedAt: "2026-05-22T00:00:00.000Z",
        commitsSampled: 3,
        scales: { sL: 1, sCx: 1, sDup: 1 },
      }),
    );
    const proposer = join(root, "proposer.mjs");
    write(
      root,
      "proposer.mjs",
      `
import { writeFileSync } from "node:fs";
writeFileSync("src/b/index.ts", "export const value = (input) => input + 2;\\n");
`,
    );

    const result = spawnSync("node", [cli, "run", "1"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CN_TEST: 'node -e "process.exit(0)"',
        CN_TYPECHECK: "",
        CN_PROPOSER: `node ${JSON.stringify(proposer)}`,
        CN_TARGET: "src/b/",
        CN_TAG: tag,
        CN_WORKTREE: worktree,
        CN_STATE: state,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[reduce] b");
    const results = readFileSync(join(root, ".codenuke/results.tsv"), "utf8");
    expect(results).toContain("\tkeep\t");
  });

  it("rejects and cleans a reduce proposer edit outside the source surface", () => {
    const root = fixtureRoot("codenuke-run-outside-");
    const tag = `outside-${Date.now()}`;
    const worktree = join(tmpdir(), `codenuke-run-outside-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-run-outside-state-${Date.now()}.json`);
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "run-outside" }));
    write(
      root,
      "src/index.ts",
      `
export function value(input) {
  const first = input + 1;
  const second = first + 1;
  return second;
}
`,
    );
    commit(root, "initial");
    write(
      root,
      ".codenuke/fence-fidelity.json",
      JSON.stringify({
        baseline: "HEAD",
        generatedAt: "2026-05-22T00:00:00.000Z",
        method: "ast-aware",
        threshold: 0.9,
        capPerRegion: 60,
        seed: 1337,
        regions: {
          src: {
            caught: 35,
            total: 35,
            p: 1,
            lo: 0.901,
            hi: 1,
            admissible: true,
            survivorSpecs: [],
          },
        },
      }),
    );
    write(
      root,
      ".codenuke/calibration.json",
      JSON.stringify({
        baseline: "HEAD",
        generatedAt: "2026-05-22T00:00:00.000Z",
        commitsSampled: 3,
        scales: { sL: 1, sCx: 1, sDup: 1 },
      }),
    );
    const proposer = join(root, "proposer.mjs");
    write(
      root,
      "proposer.mjs",
      `
import { mkdirSync, writeFileSync } from "node:fs";
writeFileSync("src/index.ts", "export const value = (input) => input + 2;\\n");
mkdirSync("codenuke.benchmark/leak", { recursive: true });
writeFileSync("codenuke.benchmark/leak/meta.json", "{}\\n");
`,
    );

    const result = spawnSync("node", [cli, "run", "1"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CN_TEST: 'node -e "process.exit(0)"',
        CN_TYPECHECK: "",
        CN_PROPOSER: `node ${JSON.stringify(proposer)}`,
        CN_TAG: tag,
        CN_WORKTREE: worktree,
        CN_STATE: state,
      },
    });

    expect(result.status).toBe(0);
    const results = readFileSync(join(root, ".codenuke/results.tsv"), "utf8");
    expect(results).toContain("proposer touched outside reduce source surface");
    expect(results).not.toContain("\tkeep\t");
    expect(existsSync(join(worktree, "codenuke.benchmark/leak/meta.json"))).toBe(false);
  });

  it("does not keep characterization tests when fence replay makes no gain", () => {
    const root = fixtureRoot("codenuke-run-raise-nogain-");
    const tag = `raise-nogain-${Date.now()}`;
    const worktree = join(tmpdir(), `codenuke-run-raise-nogain-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-run-raise-nogain-state-${Date.now()}.json`);
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "run-raise-nogain" }));
    const source = "export const isLower = (left, right) => left < right;\n";
    write(root, "src/index.ts", source);
    commit(root, "initial");
    const baseline = gitOutput(root, ["rev-parse", "HEAD"]);
    const start = source.indexOf("<");
    write(
      root,
      ".codenuke/fence-fidelity.json",
      JSON.stringify({
        baseline: "HEAD",
        generatedAt: "2026-05-22T00:00:00.000Z",
        method: "ast-aware",
        threshold: 0.9,
        capPerRegion: 60,
        seed: 1337,
        regions: {
          src: {
            caught: 0,
            total: 1,
            p: 0,
            lo: 0,
            hi: 1,
            admissible: false,
            survivorSpecs: [{ rel: "src/index.ts", start, end: start + 1, repl: ">", op: "<→>" }],
          },
        },
      }),
    );
    write(
      root,
      ".codenuke/calibration.json",
      JSON.stringify({
        baseline: "HEAD",
        generatedAt: "2026-05-22T00:00:00.000Z",
        commitsSampled: 3,
        scales: { sL: 1, sCx: 1, sDup: 1 },
      }),
    );
    const proposer = join(root, "proposer.mjs");
    write(
      root,
      "proposer.mjs",
      `
import { writeFileSync } from "node:fs";
writeFileSync("src/index.test.js", "export const placeholder = true;\\n");
`,
    );

    const result = spawnSync("node", [cli, "run", "1"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CN_TEST: 'node -e "process.exit(0)"',
        CN_TYPECHECK: "",
        CN_PROPOSER: `node ${JSON.stringify(proposer)}`,
        CN_TAG: tag,
        CN_WORKTREE: worktree,
        CN_STATE: state,
      },
    });

    expect(result.status).toBe(0);
    const results = readFileSync(join(root, ".codenuke/results.tsv"), "utf8");
    expect(results).toContain("\traise-nogain\t");
    expect(gitOutput(root, ["rev-parse", `autoresearch/${tag}`])).toBe(baseline);
    expect(gitOutput(worktree, ["status", "--porcelain"])).toBe("");
    expect(existsSync(join(worktree, "src/index.test.js"))).toBe(false);
  });

  it("keeps reductions in the isolated worktree and preserves a dirty user tree", () => {
    const root = fixtureRoot("codenuke-run-isolation-");
    const tag = `isolation-${Date.now()}`;
    const worktree = join(tmpdir(), `codenuke-run-isolation-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-run-isolation-state-${Date.now()}.json`);
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "run-isolation" }));
    write(root, "notes.md", "committed\n");
    write(
      root,
      "src/index.ts",
      `
export function value(input) {
  const first = input + 1;
  const second = first + 1;
  return second;
}
`,
    );
    commit(root, "initial");
    const branchBefore = gitOutput(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const headBefore = gitOutput(root, ["rev-parse", "HEAD"]);
    write(root, "notes.md", "dirty user edit\n");
    const userSourceBefore = readFileSync(join(root, "src/index.ts"), "utf8");
    const proposer = join(root, "proposer.mjs");
    write(
      root,
      ".codenuke/fence-fidelity.json",
      JSON.stringify({
        baseline: "HEAD",
        generatedAt: "2026-05-22T00:00:00.000Z",
        method: "ast-aware",
        threshold: 0.9,
        capPerRegion: 60,
        seed: 1337,
        regions: {
          src: {
            caught: 35,
            total: 35,
            p: 1,
            lo: 0.901,
            hi: 1,
            admissible: true,
            survivorSpecs: [],
          },
        },
      }),
    );
    write(
      root,
      ".codenuke/calibration.json",
      JSON.stringify({
        baseline: "HEAD",
        generatedAt: "2026-05-22T00:00:00.000Z",
        commitsSampled: 3,
        scales: { sL: 1, sCx: 1, sDup: 1 },
      }),
    );
    write(
      root,
      "proposer.mjs",
      `
import { writeFileSync } from "node:fs";
writeFileSync("src/index.ts", "export const value = (input) => input + 2;\\n");
`,
    );

    const result = spawnSync("node", [cli, "run", "1"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CN_TEST: 'node -e "process.exit(0)"',
        CN_TYPECHECK: "",
        CN_PROPOSER: `node ${JSON.stringify(proposer)}`,
        CN_TAG: tag,
        CN_WORKTREE: worktree,
        CN_STATE: state,
      },
    });

    expect(result.status).toBe(0);
    expect(gitOutput(root, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(branchBefore);
    expect(gitOutput(root, ["rev-parse", "HEAD"])).toBe(headBefore);
    expect(readFileSync(join(root, "notes.md"), "utf8")).toBe("dirty user edit\n");
    expect(readFileSync(join(root, "src/index.ts"), "utf8")).toBe(userSourceBefore);
  });
});
