// Pure helpers: dual-execution vs legacy. Side-effectful lifecycle: git-fixture integration.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dirtyPathsFromPorcelain,
  gitStatusPath,
  isHiddenBenchmarkDeletion,
  isNodeModulesPath,
  linkWorktreeNodeModules,
  removeWorktree,
  resetAndCleanWorktree,
} from "@codenuke/substrate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  dirtyPathsFromPorcelain as lDirty,
  gitStatusPath as lPath,
  isHiddenBenchmarkDeletion as lHidden,
  isNodeModulesPath as lNM,
} from "../../../../test-fixtures/legacy-loop/worktree.mjs";

const cleanup: string[] = [];
afterAll(() => {
  for (const d of cleanup) {
    rmSync(d, { recursive: true, force: true });
  }
});

const ignoreNodeModulesEntry = ({
  path,
}: {
  line: string;
  path: string;
  status: string;
}): boolean => isNodeModulesPath(path);

const git = (cwd: string, args: string[]): string =>
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "cn-wt-repo-"));
  cleanup.push(dir);
  git(dir, ["init", "-q"]);
  writeFileSync(join(dir, "a.txt"), "x");
  git(dir, ["add", "-A"]);
  git(dir, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"]);
  mkdirSync(join(dir, "node_modules"));
  writeFileSync(join(dir, "node_modules", "marker"), "dep");
  mkdirSync(join(dir, "packages", "foo", "node_modules"), { recursive: true });
  writeFileSync(join(dir, "packages", "foo", "node_modules", "marker"), "nested-dep");
  return dir;
}

describe("pure helpers — dual-execution vs legacy", () => {
  it("gitStatusPath matches legacy", () => {
    for (const l of [
      " M src/a.ts",
      "?? new.ts",
      "A  added.ts",
      "R  old.ts -> new.ts",
      " D del.ts",
    ]) {
      expect(gitStatusPath(l)).toBe(lPath(l));
    }
  });
  it("isNodeModulesPath matches legacy", () => {
    for (const p of ["node_modules", "node_modules/x", "src/node_modules", "a.ts"]) {
      expect(isNodeModulesPath(p)).toBe(lNM(p));
    }
  });
  it("isHiddenBenchmarkDeletion matches legacy", () => {
    const inputs = [
      { benchmarkInsideRepo: true, benchmarkRel: "bench", path: "bench/x.ts", status: " D" },
      { benchmarkInsideRepo: true, benchmarkRel: "bench", path: "bench/x.ts", status: "??" },
      { benchmarkInsideRepo: false, benchmarkRel: "bench", path: "bench/x.ts", status: " D" },
      { benchmarkInsideRepo: true, benchmarkRel: "bench", path: "src/x.ts", status: " D" },
    ];
    for (const i of inputs) {
      expect(isHiddenBenchmarkDeletion(i)).toBe(lHidden(i));
    }
  });
  it("dirtyPathsFromPorcelain matches legacy (with and without ignoreEntry)", () => {
    const out = " M a.ts\n?? b.ts\nR  c.ts -> d.ts\n D node_modules/x\n";
    expect(dirtyPathsFromPorcelain(out)).toEqual(lDirty(out));
    const legacyDirtyPaths = lDirty as (
      output: string,
      options?: { ignoreEntry?: typeof ignoreNodeModulesEntry },
    ) => string[];
    expect(dirtyPathsFromPorcelain(out, { ignoreEntry: ignoreNodeModulesEntry })).toEqual(
      legacyDirtyPaths(out, { ignoreEntry: ignoreNodeModulesEntry }),
    );
  });
});

describe("worktree lifecycle — integration (git fixture)", () => {
  let repo: string;
  beforeAll(() => {
    repo = makeRepo();
  });

  it("links node_modules into a worktree (symlink resolves to the repo's deps)", () => {
    const wt = join(tmpdir(), `cn-wt-link-${Date.now()}`);
    cleanup.push(wt);
    git(repo, ["worktree", "add", "-q", wt, "HEAD"]);
    linkWorktreeNodeModules(repo, wt);
    expect(lstatSync(join(wt, "node_modules")).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(wt, "packages", "foo", "node_modules")).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(wt, "node_modules", "marker"), "utf8")).toBe("dep");
    expect(readFileSync(join(wt, "packages", "foo", "node_modules", "marker"), "utf8")).toBe(
      "nested-dep",
    );
  });

  it("resets and cleans a dirty worktree", () => {
    const wt = join(tmpdir(), `cn-wt-reset-${Date.now()}`);
    cleanup.push(wt);
    git(repo, ["worktree", "add", "-q", wt, "HEAD"]);
    writeFileSync(join(wt, "junk.txt"), "garbage");
    writeFileSync(join(wt, "a.txt"), "modified");
    resetAndCleanWorktree(wt, { all: true });
    expect(existsSync(join(wt, "junk.txt"))).toBe(false);
    expect(readFileSync(join(wt, "a.txt"), "utf8")).toBe("x");
  });

  it("removes a worktree", () => {
    const wt = join(tmpdir(), `cn-wt-remove-${Date.now()}`);
    git(repo, ["worktree", "add", "-q", wt, "HEAD"]);
    expect(existsSync(wt)).toBe(true);
    removeWorktree(repo, wt);
    expect(existsSync(wt)).toBe(false);
  });
});
