import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { excludeWorktreeHelper, removeWorktree } from "./worktree.mjs";

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
