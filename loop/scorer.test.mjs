import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
            lo: 0.901,
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
            lo: 0.901,
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
