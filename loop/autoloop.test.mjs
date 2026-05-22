import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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

function sourceWithMutationSites(count) {
  return (
    Array.from(
      { length: count },
      (_, index) => `export const isAbove${index} = (value) => value > ${index};`,
    ).join("\n") + "\n"
  );
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
            lo: 0.9010957324106112,
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

  it("aborts long unattended runs before initializing when proxy validation is missing", () => {
    const root = fixtureRoot("codenuke-run-no-proxy-validation-");
    const tag = `no-proxy-validation-${Date.now()}`;
    const worktree = join(tmpdir(), `codenuke-run-no-proxy-validation-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-run-no-proxy-validation-state-${Date.now()}.json`);
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "run-no-proxy-validation" }));
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
            lo: 0.9010957324106112,
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

    const result = spawnSync("node", [cli, "run", "6"], {
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
    expect(result.stdout).toContain("value proxy validation missing");
    expect(result.stdout).toContain("codenuke changecost");
    expect(result.stdout).toContain("codenuke validate-proxy");
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

  it("logs a distinct status when the proposer times out", () => {
    const root = fixtureRoot("codenuke-run-proposer-timeout-");
    const tag = `proposer-timeout-${Date.now()}`;
    const worktree = join(tmpdir(), `codenuke-run-proposer-timeout-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-run-proposer-timeout-state-${Date.now()}.json`);
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "run-proposer-timeout" }));
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
            lo: 0.9010957324106112,
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

    const result = spawnSync("node", [cli, "run", "1"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CN_TEST: 'node -e "process.exit(0)"',
        CN_TYPECHECK: "",
        CN_PROPOSER: 'node -e "setTimeout(() => {}, 1000)"',
        CN_TIMEOUT: "50",
        CN_TAG: tag,
        CN_WORKTREE: worktree,
        CN_STATE: state,
      },
    });
    const results = readFileSync(join(root, ".codenuke/results.tsv"), "utf8");

    expect(result.status).toBe(0);
    expect(results).toContain("\tcrash-timeout\t");
    expect(results).toContain("proposer timeout");
  });

  it("reaps proposer child processes on timeout", () => {
    const root = fixtureRoot("codenuke-run-proposer-reap-");
    const tag = `proposer-reap-${Date.now()}`;
    const worktree = join(tmpdir(), `codenuke-run-proposer-reap-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-run-proposer-reap-state-${Date.now()}.json`);
    const marker = join(root, "orphan-marker.txt");
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "run-proposer-reap" }));
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
            lo: 0.9010957324106112,
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
import { spawn } from "node:child_process";
spawn(process.execPath, [
  "-e",
  ${JSON.stringify(`setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "alive\\n"), 600); setTimeout(() => {}, 5000);`)},
], { stdio: "ignore" });
setTimeout(() => {}, 5000);
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
        CN_TIMEOUT: "100",
        CN_TAG: tag,
        CN_WORKTREE: worktree,
        CN_STATE: state,
      },
    });
    spawnSync("node", ["-e", "setTimeout(() => {}, 900)"]);
    const results = readFileSync(join(root, ".codenuke/results.tsv"), "utf8");

    expect(result.status).toBe(0);
    expect(results).toContain("\tcrash-timeout\t");
    expect(existsSync(marker)).toBe(false);
  });

  it("logs a distinct status when the proposer exhausts its budget", () => {
    const root = fixtureRoot("codenuke-run-proposer-budget-");
    const tag = `proposer-budget-${Date.now()}`;
    const worktree = join(tmpdir(), `codenuke-run-proposer-budget-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-run-proposer-budget-state-${Date.now()}.json`);
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "run-proposer-budget" }));
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
            lo: 0.9010957324106112,
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
console.error("Reached maximum budget ($1.5)");
process.exit(1);
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
    const results = readFileSync(join(root, ".codenuke/results.tsv"), "utf8");

    expect(result.status).toBe(0);
    expect(results).toContain("\tcrash-budget\t");
    expect(results).toContain("proposer budget exhausted");
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
          a: {
            caught: 35,
            total: 35,
            p: 1,
            lo: 0.9010957324106112,
            hi: 1,
            admissible: true,
            survivorSpecs: [],
          },
          b: {
            caught: 35,
            total: 35,
            p: 1,
            lo: 0.9010957324106112,
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
          a: {
            caught: 35,
            total: 35,
            p: 1,
            lo: 0.9010957324106112,
            hi: 1,
            admissible: true,
            survivorSpecs: [],
          },
          b: {
            caught: 35,
            total: 35,
            p: 1,
            lo: 0.9010957324106112,
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

  it.each([
    ["src subdir", "src/a/index.ts", "a"],
    ["flat src", "src/index.ts", "src"],
    ["lib", "lib/index.ts", "lib"],
    ["root", "index.ts", "."],
  ])("aligns fence keys and run regions for %s layout", (_name, sourcePath, regionKey) => {
    const root = fixtureRoot("codenuke-run-layout-");
    const tag = `layout-${regionKey.replace(/\W+/gu, "root")}-${Date.now()}`;
    const worktree = join(tmpdir(), `codenuke-run-layout-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-run-layout-state-${Date.now()}.json`);
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "run-layout" }));
    write(root, sourcePath, sourceWithMutationSites(35));
    commit(root, "initial");
    const sourceBeforeRun = readFileSync(join(root, sourcePath), "utf8");
    const proposer = join(root, "proposer.mjs");
    write(
      root,
      "proposer.mjs",
      `
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(sourcePath)}, "export const isAbove0 = (value) => value > 0;\\n");
`,
    );
    const env = {
      ...process.env,
      CN_TEST: `node -e "const fs=require('fs');process.exit(fs.readFileSync('${sourcePath}','utf8').includes(' < ')?1:0)"`,
      CN_TYPECHECK: "",
      CN_PROPOSER: `node ${JSON.stringify(proposer)}`,
      CN_TAG: tag,
      CN_WORKTREE: worktree,
      CN_STATE: state,
    };

    const fenced = spawnSync("node", [cli, "fence", "35", "1337"], {
      cwd: root,
      encoding: "utf8",
      env,
    });
    expect(fenced.status).toBe(0);
    const fence = JSON.parse(readFileSync(join(root, ".codenuke/fence-fidelity.json"), "utf8"));
    expect(Object.keys(fence.regions)).toEqual([regionKey]);
    expect(fence.regions[regionKey]).toMatchObject({ total: 35, admissible: true });

    const calibrated = spawnSync("node", [cli, "calibrate"], {
      cwd: root,
      encoding: "utf8",
      env,
    });
    expect(calibrated.status).toBe(0);

    const result = spawnSync("node", [cli, "run", "1"], {
      cwd: root,
      encoding: "utf8",
      env,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`[reduce] ${regionKey}`);
    const results = readFileSync(join(root, ".codenuke/results.tsv"), "utf8");
    expect(results).toContain("\tkeep\t");
    expect(results).not.toContain("\traise-skip\t");
    expect(readFileSync(join(root, sourcePath), "utf8")).toBe(sourceBeforeRun);
    expect(gitOutput(worktree, ["status", "--porcelain"])).toBe("");
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
            lo: 0.9010957324106112,
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

  it("rejects and cleans a root-layout reduce proposer edit under node_modules", () => {
    const root = fixtureRoot("codenuke-run-node-modules-");
    const tag = `node-modules-${Date.now()}`;
    const worktree = join(tmpdir(), `codenuke-run-node-modules-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-run-node-modules-state-${Date.now()}.json`);
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "run-node-modules" }));
    write(root, ".gitignore", "node_modules/\n");
    write(root, "node_modules/.bin/.keep", "");
    write(
      root,
      "core/index.ts",
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
          core: {
            caught: 35,
            total: 35,
            p: 1,
            lo: 0.9010957324106112,
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
writeFileSync("core/index.ts", "export const value = (input) => input + 2;\\n");
mkdirSync("node_modules/pkg", { recursive: true });
writeFileSync("node_modules/pkg/index.js", "export const leak = true;\\n");
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
    const results = readFileSync(join(root, ".codenuke/results.tsv"), "utf8");

    expect(result.status).toBe(0);
    expect(results).toContain("proposer touched outside reduce source surface");
    expect(results).toContain("node_modules");
    expect(results).not.toContain("\tkeep\t");
    expect(existsSync(join(worktree, "node_modules/pkg/index.js"))).toBe(false);
    expect(existsSync(join(root, "node_modules/pkg/index.js"))).toBe(false);
  });

  it("does not expose the held-out benchmark to the reduce proposer worktree", () => {
    const root = fixtureRoot("codenuke-run-hidden-benchmark-");
    const tag = `hidden-benchmark-${Date.now()}`;
    const worktree = join(tmpdir(), `codenuke-run-hidden-benchmark-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-run-hidden-benchmark-state-${Date.now()}.json`);
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "run-hidden-benchmark" }));
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
    write(root, "codenuke.benchmark/value/meta.json", JSON.stringify({ id: "value" }));
    write(root, "codenuke.benchmark/value/accept.test.ts", "export const accepted = true;\n");
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
            lo: 0.9010957324106112,
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
import { existsSync, writeFileSync } from "node:fs";
if (existsSync("codenuke.benchmark/value/accept.test.ts")) {
  writeFileSync("src/index.ts", "export const value = (input) => input + 2;\\n");
}
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
    const results = readFileSync(join(root, ".codenuke/results.tsv"), "utf8");

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("→ KEEP");
    expect(results).toContain("\tnoop\t");
    expect(gitOutput(worktree, ["status", "--porcelain"])).toBe("");
    expect(existsSync(join(worktree, "codenuke.benchmark/value/accept.test.ts"))).toBe(true);
  });

  it("runs the default proposer adapter without shell or git tools", () => {
    const root = fixtureRoot("codenuke-run-default-proposer-");
    const tag = `default-proposer-${Date.now()}`;
    const worktree = join(tmpdir(), `codenuke-run-default-proposer-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-run-default-proposer-state-${Date.now()}.json`);
    const fakeBin = join(root, "fake-bin");
    const capture = join(root, "claude-args.json");
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "run-default-proposer" }));
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
            lo: 0.9010957324106112,
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
      "fake-bin/claude",
      `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
writeFileSync(process.env.CN_FAKE_CLAUDE_ARGS, JSON.stringify(process.argv.slice(2)));
writeFileSync("src/index.ts", "export const value = (input) => input + 2;\\n");
`,
    );
    chmodSync(join(fakeBin, "claude"), 0o755);

    const result = spawnSync("node", [cli, "run", "1"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        CN_FAKE_CLAUDE_ARGS: capture,
        CN_TEST: 'node -e "process.exit(0)"',
        CN_TYPECHECK: "",
        CN_TAG: tag,
        CN_WORKTREE: worktree,
        CN_STATE: state,
      },
    });
    const args = JSON.parse(readFileSync(capture, "utf8"));
    const allowedTools = args[args.indexOf("--allowedTools") + 1];

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("proposer=claude -p");
    expect(result.stdout).toContain("→ KEEP");
    expect(allowedTools).toBe("Edit Write Read Grep Glob");
    expect(allowedTools).not.toMatch(/\b(?:Bash|Shell|Git)\b/u);
  });

  it("reaps default proposer adapter child processes on timeout", () => {
    const root = fixtureRoot("codenuke-run-default-proposer-reap-");
    const tag = `default-proposer-reap-${Date.now()}`;
    const worktree = join(tmpdir(), `codenuke-run-default-proposer-reap-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-run-default-proposer-reap-state-${Date.now()}.json`);
    const fakeBin = join(root, "fake-bin");
    const marker = join(root, "default-orphan-marker.txt");
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "run-default-proposer-reap" }));
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
            lo: 0.9010957324106112,
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
      "fake-bin/claude",
      `#!/usr/bin/env node
import { spawn } from "node:child_process";
spawn(process.execPath, [
  "-e",
  ${JSON.stringify(`setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "alive\\n"), 600); setTimeout(() => {}, 5000);`)},
], { stdio: "ignore" });
setTimeout(() => {}, 5000);
`,
    );
    chmodSync(join(fakeBin, "claude"), 0o755);

    const result = spawnSync("node", [cli, "run", "1"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        CN_TEST: 'node -e "process.exit(0)"',
        CN_TYPECHECK: "",
        CN_TIMEOUT: "100",
        CN_TAG: tag,
        CN_WORKTREE: worktree,
        CN_STATE: state,
      },
    });
    spawnSync("node", ["-e", "setTimeout(() => {}, 900)"]);
    const results = readFileSync(join(root, ".codenuke/results.tsv"), "utf8");

    expect(result.status).toBe(0);
    expect(results).toContain("\tcrash-timeout\t");
    expect(existsSync(marker)).toBe(false);
  });

  it("does not expose the held-out benchmark to the raise proposer worktree", () => {
    const root = fixtureRoot("codenuke-run-hidden-benchmark-raise-");
    const tag = `hidden-benchmark-raise-${Date.now()}`;
    const worktree = join(tmpdir(), `codenuke-run-hidden-benchmark-raise-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-run-hidden-benchmark-raise-state-${Date.now()}.json`);
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "run-hidden-benchmark-raise" }));
    const source = "export const isLower = (left, right) => left < right;\n";
    write(root, "src/index.ts", source);
    write(root, "codenuke.benchmark/value/meta.json", JSON.stringify({ id: "value" }));
    write(root, "codenuke.benchmark/value/accept.test.ts", "export const accepted = true;\n");
    commit(root, "initial");
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
            hi: 0.7934567085261071,
            admissible: false,
            survivorSpecs: [
              {
                rel: "src/index.ts",
                start,
                end: start + 1,
                repl: ">",
                op: "<",
              },
            ],
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
import { existsSync, writeFileSync } from "node:fs";
if (existsSync("codenuke.benchmark/value/accept.test.ts")) {
  writeFileSync("src/index.test.js", "export const pinned = true;\\n");
}
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
    const results = readFileSync(join(root, ".codenuke/results.tsv"), "utf8");

    expect(result.status).toBe(0);
    expect(results).toContain("\traise-noop\t");
    expect(gitOutput(worktree, ["status", "--porcelain"])).toBe("");
    expect(existsSync(join(worktree, "src/index.test.js"))).toBe(false);
    expect(existsSync(join(worktree, "codenuke.benchmark/value/accept.test.ts"))).toBe(true);
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
            hi: 0.7934567085261071,
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

  it("rejects and cleans a raise proposer edit outside the test surface", () => {
    const root = fixtureRoot("codenuke-run-raise-bad-source-");
    const tag = `raise-bad-source-${Date.now()}`;
    const worktree = join(tmpdir(), `codenuke-run-raise-bad-source-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-run-raise-bad-source-state-${Date.now()}.json`);
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "run-raise-bad-source" }));
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
            hi: 0.7934567085261071,
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
writeFileSync("src/index.ts", "export const isLower = () => true;\\n");
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
    expect(results).toContain("\traise-badtest\t");
    expect(results).toContain("touched outside raise test surface");
    expect(gitOutput(root, ["rev-parse", `autoresearch/${tag}`])).toBe(baseline);
    expect(gitOutput(worktree, ["status", "--porcelain"])).toBe("");
    expect(readFileSync(join(worktree, "src/index.ts"), "utf8")).toBe(source);
    expect(existsSync(join(worktree, "src/index.test.js"))).toBe(false);
  });

  it("rejects raise tests written outside the discovered test directory", () => {
    const root = fixtureRoot("codenuke-run-raise-wrong-test-dir-");
    const tag = `raise-wrong-test-dir-${Date.now()}`;
    const worktree = join(tmpdir(), `codenuke-run-raise-wrong-test-dir-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-run-raise-wrong-test-dir-state-${Date.now()}.json`);
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "run-raise-wrong-test-dir" }));
    const source = "export const isLower = (left, right) => left < right;\n";
    write(root, "src/index.ts", source);
    write(root, "test/existing.test.ts", "export const existing = true;\n");
    commit(root, "initial");
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
            hi: 0.7934567085261071,
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
writeFileSync("src/index.test.ts", "export const misplaced = true;\\n");
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
    const results = readFileSync(join(root, ".codenuke/results.tsv"), "utf8");

    expect(result.status).toBe(0);
    expect(results).toContain("\traise-badtest\t");
    expect(results).toContain("outside discovered test surface");
    expect(results).toContain("test/");
    expect(existsSync(join(worktree, "src/index.test.ts"))).toBe(false);
  });

  it("tells the raise proposer the discovered test directory and commits tests there", () => {
    const root = fixtureRoot("codenuke-run-raise-test-dir-");
    const tag = `raise-test-dir-${Date.now()}`;
    const worktree = join(tmpdir(), `codenuke-run-raise-test-dir-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-run-raise-test-dir-state-${Date.now()}.json`);
    const fakeBin = join(root, "fake-bin");
    const promptCapture = join(root, "raise-prompt.txt");
    initRepo(root);
    write(root, "package.json", JSON.stringify({ name: "run-raise-test-dir" }));
    const source = "export const isLower = (left, right) => left < right;\n";
    write(root, "src/index.ts", source);
    write(root, "test/existing.test.ts", "export const existing = true;\n");
    commit(root, "initial");
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
            hi: 0.7934567085261071,
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
    write(
      root,
      "fake-bin/claude",
      `#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(promptCapture)}, readFileSync(0, "utf8"));
mkdirSync("test", { recursive: true });
writeFileSync("test/pinned.test.ts", "export const pinned = true;\\n");
`,
    );
    chmodSync(join(fakeBin, "claude"), 0o755);

    const result = spawnSync("node", [cli, "run", "1"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        CN_TEST:
          "node -e \"const fs=require('fs');const src=fs.readFileSync('src/index.ts','utf8');const pinned=fs.existsSync('test/pinned.test.ts');process.exit(pinned&&src.includes('left > right')?1:0)\"",
        CN_TYPECHECK: "",
        CN_TAG: tag,
        CN_WORKTREE: worktree,
        CN_STATE: state,
      },
    });
    const results = readFileSync(join(root, ".codenuke/results.tsv"), "utf8");

    expect(result.status).toBe(0);
    expect(readFileSync(promptCapture, "utf8")).toContain("test/**/*");
    expect(results).toContain("\traise\t");
    expect(gitOutput(root, ["show", `autoresearch/${tag}:test/pinned.test.ts`])).toBe(
      "export const pinned = true;",
    );
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
            lo: 0.9010957324106112,
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
