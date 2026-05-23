import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  dirtyPathsFromPorcelain,
  excludeWorktreeHelper,
  gitStatusPath,
  isHiddenBenchmarkDeletion,
  isNodeModulesPath,
  removeWorktree,
  resetAndCleanWorktree,
} from "./worktree.mjs";

function fixtureRoot(name) {
  return mkdtempSync(join(tmpdir(), name));
}

function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function initRepo(root) {
  git(root, ["init"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test User"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  writeFileSync(join(root, "index.js"), "export const value = 1;\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "initial"]);
}

describe("worktree helpers", () => {
  it("parses dirty paths from git porcelain output including renames", () => {
    const output = [
      " M src/index.ts",
      "R  src/old.ts -> src/new.ts",
      "?? node_modules/pkg/index.js",
      "",
    ].join("\n");

    expect(gitStatusPath("R  src/old.ts -> src/new.ts")).toBe("src/new.ts");
    expect(dirtyPathsFromPorcelain(output)).toEqual([
      "src/index.ts",
      "src/new.ts",
      "node_modules/pkg/index.js",
    ]);
  });

  it("lets callers keep policy-specific dirty path filters local", () => {
    const output = [
      " D codenuke.benchmark/value/meta.json",
      "?? codenuke.benchmark/value/generated.txt",
      " M src/index.ts",
      "",
    ].join("\n");

    expect(
      dirtyPathsFromPorcelain(output, {
        ignoreEntry: ({ path, status }) =>
          isHiddenBenchmarkDeletion({
            benchmarkInsideRepo: true,
            benchmarkRel: "codenuke.benchmark",
            path,
            status,
          }),
      }),
    ).toEqual(["codenuke.benchmark/value/generated.txt", "src/index.ts"]);
  });

  it("recognizes node_modules helper paths", () => {
    expect(isNodeModulesPath("node_modules")).toBe(true);
    expect(isNodeModulesPath("node_modules/pkg/index.js")).toBe(true);
    expect(isNodeModulesPath("src/node_modules.ts")).toBe(false);
  });

  it("resets and cleans scoped paths before optionally cleaning the whole worktree", () => {
    const commands = [];
    resetAndCleanWorktree((command) => commands.push(command), "/tmp/wt", {
      ref: "HEAD~1",
      paths: ["src/a file.js"],
      all: true,
    });

    expect(commands).toEqual([
      "git -C /tmp/wt reset --hard HEAD~1",
      `git -C /tmp/wt clean -fdq -- ${JSON.stringify("src/a file.js")}`,
      "git -C /tmp/wt clean -fdq",
    ]);
  });

  it("adds helper paths to the worktree exclude file only once", () => {
    const root = fixtureRoot("codenuke-worktree-exclude-");
    const worktree = join(tmpdir(), `codenuke-worktree-exclude-wt-${Date.now()}`);
    initRepo(root);
    git(root, ["worktree", "add", "-f", worktree, "HEAD"]);

    excludeWorktreeHelper(worktree, "node_modules");
    excludeWorktreeHelper(worktree, "node_modules");

    const exclude = git(worktree, ["rev-parse", "--git-path", "info/exclude"]);
    const entries = readFileSync(exclude, "utf8")
      .split(/\r?\n/u)
      .filter((line) => line === "node_modules");
    expect(entries).toEqual(["node_modules"]);

    removeWorktree(root, worktree);
  });

  it("removes a git worktree and prunes it without throwing", () => {
    const root = fixtureRoot("codenuke-worktree-remove-");
    const worktree = join(tmpdir(), `codenuke-worktree-remove-wt-${Date.now()}`);
    initRepo(root);
    git(root, ["worktree", "add", "-f", worktree, "HEAD"]);

    removeWorktree(root, worktree);
    removeWorktree(root, worktree);

    expect(existsSync(worktree)).toBe(false);
  });
});
