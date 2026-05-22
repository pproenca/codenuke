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

function gitOutput(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
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

function runCodenuke(root, args, env = {}) {
  return spawnSync("node", [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function scoreJson(root, env) {
  const result = runCodenuke(root, ["score", "--json"], env);
  const line = result.stdout.split("\n").find((candidate) => candidate.startsWith("@@JSON@@"));
  if (!line)
    throw new Error(`missing score JSON:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return JSON.parse(line.slice("@@JSON@@".length));
}

describe("codenuke scorer operations", () => {
  it.each([
    ["score", ["score", "--json"]],
    ["accept", ["accept"]],
    ["revert", ["revert"]],
    ["status", ["status"]],
  ])("fails fast with guidance when %s runs before init", (_name, args) => {
    const root = fixtureRoot("codenuke-score-preflight-");
    initRepo(root);
    write(root, "src/index.ts", "export const value = 1;\n");
    commit(root, "initial");

    const result = runCodenuke(root, args, {
      CN_TEST: 'node -e "process.exit(0)"',
      CN_STATE: join(root, ".codenuke/missing-state.json"),
      CN_WORKTREE: join(tmpdir(), `codenuke-score-preflight-${Date.now()}`),
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("run `codenuke init` first");
    expect(result.stderr).not.toContain("ENOENT");
  });

  it("removes the scorer worktree when init finds a red baseline", () => {
    const root = fixtureRoot("codenuke-score-red-baseline-");
    const worktree = join(tmpdir(), `codenuke-score-red-wt-${Date.now()}`);
    initRepo(root);
    write(root, "src/index.ts", "export const value = 1;\n");
    commit(root, "initial");

    const result = runCodenuke(root, ["init"], {
      CN_TEST: 'node -e "process.exit(1)"',
      CN_WORKTREE: worktree,
      CN_STATE: join(tmpdir(), `codenuke-score-red-state-${Date.now()}.json`),
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("baseline tests RED");
    expect(existsSync(worktree)).toBe(false);
  });

  it("uses calibration scales when computing score gain", () => {
    const root = fixtureRoot("codenuke-score-calibration-");
    const worktree = join(tmpdir(), `codenuke-score-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-score-state-${Date.now()}.json`);
    const env = {
      CN_TEST: 'node -e "process.exit(0)"',
      CN_TYPECHECK: "",
      CN_WORKTREE: worktree,
      CN_STATE: state,
    };
    initRepo(root);
    write(
      root,
      "src/index.ts",
      `
export function value(input) {
  const doubled = input * 2;
  return doubled;
}
`,
    );
    commit(root, "initial");

    const initialized = runCodenuke(root, ["init"], env);
    expect(initialized.status).toBe(0);
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
      worktree,
      "src/index.ts",
      `
export const value = (input) => input * 2;
`,
    );
    write(
      root,
      ".codenuke/calibration.json",
      JSON.stringify({
        baseline: "HEAD",
        generatedAt: "2026-05-22T00:00:00.000Z",
        commitsSampled: 3,
        scales: { sL: 1000, sCx: 1000, sDup: 1000 },
      }),
    );
    const largeScale = scoreJson(root, env);

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
    const smallScale = scoreJson(root, env);

    expect(largeScale.gates).toMatchObject({ G1: true, G1prime: true, G3: true, G4: true });
    expect(smallScale.gain).toBeGreaterThan(largeScale.gain);
  });

  it("does not let invalid calibration scales create infinite gain", () => {
    const root = fixtureRoot("codenuke-score-invalid-calibration-");
    const worktree = join(tmpdir(), `codenuke-score-invalid-calibration-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-score-invalid-calibration-state-${Date.now()}.json`);
    const env = {
      CN_TEST: 'node -e "process.exit(0)"',
      CN_TYPECHECK: "",
      CN_WORKTREE: worktree,
      CN_STATE: state,
    };
    initRepo(root);
    write(
      root,
      "src/index.ts",
      `
export function value(input) {
  const doubled = input * 2;
  return doubled;
}
`,
    );
    commit(root, "initial");
    expect(runCodenuke(root, ["init"], env).status).toBe(0);
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
        scales: { sL: 0, sCx: 0, sDup: 0 },
      }),
    );
    write(
      worktree,
      "src/index.ts",
      `
export const value = (input) => input * 2;
`,
    );

    const score = scoreJson(root, env);

    expect(Number.isFinite(score.gain)).toBe(true);
    expect(score.gain).toBeLessThan(1);
  });

  it("does not use calibration scales from a different baseline", () => {
    const root = fixtureRoot("codenuke-score-stale-calibration-");
    const worktree = join(tmpdir(), `codenuke-score-stale-calibration-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-score-stale-calibration-state-${Date.now()}.json`);
    const env = {
      CN_TEST: 'node -e "process.exit(0)"',
      CN_TYPECHECK: "",
      CN_WORKTREE: worktree,
      CN_STATE: state,
    };
    initRepo(root);
    write(
      root,
      "src/index.ts",
      `
export function value(input) {
  const doubled = input * 2;
  return doubled;
}
`,
    );
    commit(root, "initial");
    expect(runCodenuke(root, ["init"], env).status).toBe(0);
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
        baselineSha: "0000000000000000000000000000000000000000",
        generatedAt: "2026-05-22T00:00:00.000Z",
        commitsSampled: 3,
        scales: { sL: 1, sCx: 1, sDup: 1 },
      }),
    );
    write(
      worktree,
      "src/index.ts",
      `
export const value = (input) => input * 2;
`,
    );

    const score = scoreJson(root, env);

    expect(score.gates).toMatchObject({ G1: true, G1prime: true, G3: true, G4: true });
    expect(score.gain).toBeLessThan(1);
  });

  it("increases proxy gain when the AST reduction is larger", () => {
    const root = fixtureRoot("codenuke-score-monotonic-");
    const worktree = join(tmpdir(), `codenuke-score-monotonic-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-score-monotonic-state-${Date.now()}.json`);
    const env = {
      CN_TEST: 'node -e "process.exit(0)"',
      CN_TYPECHECK: "",
      CN_WORKTREE: worktree,
      CN_STATE: state,
    };
    initRepo(root);
    write(
      root,
      "src/index.ts",
      `
export function value(input) {
  const first = input + 1;
  const second = first + 1;
  const third = second + 1;
  return third;
}
`,
    );
    commit(root, "initial");
    expect(runCodenuke(root, ["init"], env).status).toBe(0);
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
      worktree,
      "src/index.ts",
      `
export function value(input) {
  const first = input + 1;
  const second = first + 1;
  return second;
}
`,
    );
    const smallerReduction = scoreJson(root, env);

    write(
      worktree,
      "src/index.ts",
      `
export const value = (input) => input + 3;
`,
    );
    const largerReduction = scoreJson(root, env);

    expect(smallerReduction.gates).toMatchObject({
      G1: true,
      G1prime: true,
      G3: true,
      G4: true,
    });
    expect(largerReduction.dL).toBeGreaterThan(smallerReduction.dL);
    expect(largerReduction.gain).toBeGreaterThan(smallerReduction.gain);
  });

  it("does not keep a reformat-only candidate with no AST reduction", () => {
    const root = fixtureRoot("codenuke-score-reformat-");
    const worktree = join(tmpdir(), `codenuke-score-reformat-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-score-reformat-state-${Date.now()}.json`);
    const env = {
      CN_TEST: 'node -e "process.exit(0)"',
      CN_TYPECHECK: "",
      CN_WORKTREE: worktree,
      CN_STATE: state,
    };
    initRepo(root);
    write(
      root,
      "src/index.ts",
      `
export function value(input) {
  const doubled = input * 2;
  return doubled + 1;
}
`,
    );
    commit(root, "initial");
    expect(runCodenuke(root, ["init"], env).status).toBe(0);
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
      worktree,
      "src/index.ts",
      `
export function value( input ) {
const doubled=input*2
return doubled+1
}
`,
    );

    const score = scoreJson(root, env);

    expect(score.dL).toBe(0);
    expect(score.admissible).toBe(false);
    expect(score.keep).toBe(false);
    expect(score.loss).toBeNull();
    expect(score.gates).toMatchObject({ G1: true, G1prime: true, G3: true, G4: false });
  });

  it("accepts only scored source files in a root-layout repo", () => {
    const root = fixtureRoot("codenuke-score-root-accept-");
    const worktree = join(tmpdir(), `codenuke-score-root-accept-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-score-root-accept-state-${Date.now()}.json`);
    const env = {
      CN_TEST: 'node -e "process.exit(0)"',
      CN_TYPECHECK: "",
      CN_WORKTREE: worktree,
      CN_STATE: state,
      CN_TAG: `root-accept-${Date.now()}`,
    };
    initRepo(root);
    write(
      root,
      "index.ts",
      `
export function value(input) {
  const doubled = input * 2;
  return doubled;
}
`,
    );
    commit(root, "initial");
    expect(runCodenuke(root, ["init"], env).status).toBe(0);
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
          ".": {
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
      worktree,
      "index.ts",
      `
export const value = (input) => input * 2;
`,
    );
    write(worktree, ".codenuke/generated.json", JSON.stringify({ shouldNotCommit: true }));

    const score = scoreJson(root, env);
    expect(score.keep).toBe(true);
    const accepted = runCodenuke(root, ["accept"], env);
    const committedFiles = gitOutput(worktree, ["show", "--name-only", "--pretty=format:", "HEAD"])
      .split("\n")
      .filter(Boolean);

    expect(accepted.status).toBe(0);
    expect(committedFiles).toEqual(["index.ts"]);
    expect(existsSync(join(worktree, ".codenuke/generated.json"))).toBe(true);
  });

  it("fails closed when the fence artifact is missing", () => {
    const root = fixtureRoot("codenuke-score-no-fence-");
    const worktree = join(tmpdir(), `codenuke-score-no-fence-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-score-no-fence-state-${Date.now()}.json`);
    const env = {
      CN_TEST: 'node -e "process.exit(0)"',
      CN_TYPECHECK: "",
      CN_WORKTREE: worktree,
      CN_STATE: state,
    };
    initRepo(root);
    write(
      root,
      "src/index.ts",
      `
export function value(input) {
  const doubled = input * 2;
  return doubled;
}
`,
    );
    commit(root, "initial");
    expect(runCodenuke(root, ["init"], env).status).toBe(0);
    write(
      worktree,
      "src/index.ts",
      `
export const value = (input) => input * 2;
`,
    );

    const score = scoreJson(root, env);

    expect(score.admissible).toBe(false);
    expect(score.keep).toBe(false);
    expect(score.loss).toBeNull();
    expect(score.gates).toMatchObject({ G1: true, G1prime: false, G3: true, G4: true });
  });

  it("fails closed when the fence artifact was measured on a different baseline", () => {
    const root = fixtureRoot("codenuke-score-stale-fence-");
    const worktree = join(tmpdir(), `codenuke-score-stale-fence-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-score-stale-fence-state-${Date.now()}.json`);
    const env = {
      CN_TEST: 'node -e "process.exit(0)"',
      CN_TYPECHECK: "",
      CN_WORKTREE: worktree,
      CN_STATE: state,
    };
    initRepo(root);
    write(
      root,
      "src/index.ts",
      `
export function value(input) {
  const doubled = input * 2;
  return doubled;
}
`,
    );
    commit(root, "initial");
    expect(runCodenuke(root, ["init"], env).status).toBe(0);
    write(
      root,
      ".codenuke/fence-fidelity.json",
      JSON.stringify({
        baseline: "HEAD",
        baselineSha: "0000000000000000000000000000000000000000",
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
      worktree,
      "src/index.ts",
      `
export const value = (input) => input * 2;
`,
    );

    const result = runCodenuke(root, ["score", "--json"], env);
    const line = result.stdout.split("\n").find((candidate) => candidate.startsWith("@@JSON@@"));
    const score = JSON.parse(line.slice("@@JSON@@".length));

    expect(result.stdout).toContain("STALE AUDIT");
    expect(score.admissible).toBe(false);
    expect(score.keep).toBe(false);
    expect(score.loss).toBeNull();
    expect(score.gates).toMatchObject({ G1: true, G1prime: false, G3: true, G4: true });
  });

  it("fails closed when the fence admissibility flag contradicts its Wilson lower bound", () => {
    const root = fixtureRoot("codenuke-score-invalid-fence-");
    const worktree = join(tmpdir(), `codenuke-score-invalid-fence-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-score-invalid-fence-state-${Date.now()}.json`);
    const env = {
      CN_TEST: 'node -e "process.exit(0)"',
      CN_TYPECHECK: "",
      CN_WORKTREE: worktree,
      CN_STATE: state,
    };
    initRepo(root);
    write(
      root,
      "src/index.ts",
      `
export function value(input) {
  const doubled = input * 2;
  return doubled;
}
`,
    );
    commit(root, "initial");
    expect(runCodenuke(root, ["init"], env).status).toBe(0);
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
            total: 35,
            p: 0,
            lo: 0,
            hi: 1,
            admissible: true,
            survivorSpecs: [],
          },
        },
      }),
    );
    write(
      worktree,
      "src/index.ts",
      `
export const value = (input) => input * 2;
`,
    );

    const result = runCodenuke(root, ["score", "--json"], env);
    const line = result.stdout.split("\n").find((candidate) => candidate.startsWith("@@JSON@@"));
    const score = JSON.parse(line.slice("@@JSON@@".length));

    expect(result.stdout).toContain("INVALID AUDIT");
    expect(score.admissible).toBe(false);
    expect(score.keep).toBe(false);
    expect(score.loss).toBeNull();
    expect(score.gates).toMatchObject({ G1: true, G1prime: false, G3: true, G4: true });
  });

  it("fails closed when the fence artifact was admitted under a weaker threshold", () => {
    const root = fixtureRoot("codenuke-score-weak-fence-threshold-");
    const worktree = join(tmpdir(), `codenuke-score-weak-fence-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-score-weak-fence-state-${Date.now()}.json`);
    const env = {
      CN_TEST: 'node -e "process.exit(0)"',
      CN_TYPECHECK: "",
      CN_WORKTREE: worktree,
      CN_STATE: state,
      CN_FENCE_LB: "0.9",
    };
    initRepo(root);
    write(
      root,
      "src/index.ts",
      `
export function value(input) {
  const doubled = input * 2;
  return doubled;
}
`,
    );
    commit(root, "initial");
    expect(runCodenuke(root, ["init"], env).status).toBe(0);
    write(
      root,
      ".codenuke/fence-fidelity.json",
      JSON.stringify({
        baseline: "HEAD",
        generatedAt: "2026-05-22T00:00:00.000Z",
        method: "ast-aware",
        threshold: 0.5,
        capPerRegion: 60,
        seed: 1337,
        regions: {
          src: {
            caught: 21,
            total: 35,
            p: 0.6,
            lo: 0.6,
            hi: 0.8,
            admissible: true,
            survivorSpecs: [],
          },
        },
      }),
    );
    write(
      worktree,
      "src/index.ts",
      `
export const value = (input) => input * 2;
`,
    );

    const result = runCodenuke(root, ["score", "--json"], env);
    const line = result.stdout.split("\n").find((candidate) => candidate.startsWith("@@JSON@@"));
    const score = JSON.parse(line.slice("@@JSON@@".length));

    expect(result.stdout).toContain("INVALID AUDIT");
    expect(score.admissible).toBe(false);
    expect(score.keep).toBe(false);
    expect(score.loss).toBeNull();
    expect(score.gates).toMatchObject({ G1: true, G1prime: false, G3: true, G4: true });
  });

  it("does not keep a size reduction when behavior fails", () => {
    const root = fixtureRoot("codenuke-score-behavior-");
    const worktree = join(tmpdir(), `codenuke-score-behavior-wt-${Date.now()}`);
    const state = join(tmpdir(), `codenuke-score-behavior-state-${Date.now()}.json`);
    const env = {
      CN_TYPECHECK: "",
      CN_WORKTREE: worktree,
      CN_STATE: state,
    };
    initRepo(root);
    write(
      root,
      "src/index.ts",
      `
export function value(input) {
  const doubled = input * 2;
  return doubled;
}
`,
    );
    commit(root, "initial");
    expect(
      runCodenuke(root, ["init"], { ...env, CN_TEST: 'node -e "process.exit(0)"' }).status,
    ).toBe(0);
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
      worktree,
      "src/index.ts",
      `
export const value = (input) => input * 2;
`,
    );

    const score = scoreJson(root, { ...env, CN_TEST: 'node -e "process.exit(1)"' });

    expect(score.admissible).toBe(false);
    expect(score.keep).toBe(false);
    expect(score.loss).toBeNull();
    expect(score.gates).toMatchObject({ G1: false, G1prime: true, G3: true, G4: true });
  });
});
