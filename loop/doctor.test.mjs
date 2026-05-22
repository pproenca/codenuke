import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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

function initGreenRepo(root) {
  write(root, "package.json", JSON.stringify({ name: "doctor-fixture" }));
  write(root, "src/index.ts", "export const ready = true;\n");
  git(root, ["init"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test User"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "initial"]);
}

describe("codenuke doctor", () => {
  it("reports precise readiness gaps for a fresh repo", () => {
    const root = fixtureRoot("codenuke-doctor-");
    initGreenRepo(root);

    const result = spawnSync("node", [cli, "doctor"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CN_PROPOSER: "true",
        CN_TEST: 'node -e "process.exit(0)"',
      },
    });

    expect(result.status).toBe(2);
    expect(result.stdout).toContain("srcDir: src");
    expect(result.stdout).toContain("regions: src");
    expect(result.stdout).toContain("baseline: green");
    expect(result.stdout).toContain("fence: missing");
    expect(result.stdout).toContain("calibration: missing");
  });

  it("exits zero when readiness prerequisites are present", () => {
    const root = fixtureRoot("codenuke-doctor-ready-");
    initGreenRepo(root);
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
        regions: { src: { caught: 35, total: 35, p: 1, lo: 0.901, hi: 1, admissible: true } },
      }),
    );
    write(
      root,
      ".codenuke/calibration.json",
      JSON.stringify({
        baseline: "HEAD",
        generatedAt: "2026-05-22T00:00:00.000Z",
        commitsSampled: 1,
        scales: { sL: 1, sCx: 1, sDup: 1 },
      }),
    );

    const result = spawnSync("node", [cli, "doctor"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CN_PROPOSER: "true",
        CN_TEST: 'node -e "process.exit(0)"',
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("fence: present");
    expect(result.stdout).toContain("calibration: present");
    expect(result.stdout).toContain("ready");
  });

  it("runs readiness commands in an isolated worktree without dirtying the user repo", () => {
    const root = fixtureRoot("codenuke-doctor-isolation-");
    initGreenRepo(root);
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
        regions: { src: { caught: 35, total: 35, p: 1, lo: 0.901, hi: 1, admissible: true } },
      }),
    );
    write(
      root,
      ".codenuke/calibration.json",
      JSON.stringify({
        baseline: "HEAD",
        generatedAt: "2026-05-22T00:00:00.000Z",
        commitsSampled: 1,
        scales: { sL: 1, sCx: 1, sDup: 1 },
      }),
    );
    const branchBefore = gitOutput(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const headBefore = gitOutput(root, ["rev-parse", "HEAD"]);

    const result = spawnSync("node", [cli, "doctor"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        CN_PROPOSER: "true",
        CN_TAG: `doctor-isolation-${Date.now()}`,
        CN_TEST:
          "node -e \"require('fs').writeFileSync('src/generated.ts', 'export const generated = true;\\\\n')\"",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ready");
    expect(existsSync(join(root, "src/generated.ts"))).toBe(false);
    expect(gitOutput(root, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(branchBefore);
    expect(gitOutput(root, ["rev-parse", "HEAD"])).toBe(headBefore);
    expect(gitOutput(root, ["status", "--porcelain", "--", "src"])).toBe("");
  });
});
