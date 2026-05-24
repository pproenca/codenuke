/**
 * Git worktree lifecycle + dirty-path classification. Migrated from
 * `legacy/codenuke/loop/worktree.mjs`. All git invocations now go through
 * `@codenuke/exec` arg-arrays (no shell strings, no `quoteShellArg`).
 *
 * @see analysis/codenuke/BUSINESS_RULES.md — RULE-045 (worktree lifecycle)
 */
import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname } from "node:path";
import { run } from "@codenuke/exec";

/** Append `path` to the worktree's git `info/exclude` (idempotent). */
export function excludeWorktreeHelper(worktree: string, path: string): void {
  const exclude = run("git", ["rev-parse", "--git-path", "info/exclude"], { cwd: worktree }).trim();
  let current = "";
  try {
    current = readFileSync(exclude, "utf8");
  } catch {
    /* no exclude file yet */
  }
  if (!current.split(/\r?\n/u).includes(path)) appendFileSync(exclude, `${path}\n`);
}

/** Bounded directory walk for non-hoisted workspace `node_modules` dirs. */
function nestedNodeModules(repo: string, maxDepth = 4): string[] {
  const found: string[] = [];
  const walk = (rel: string, depth: number): void => {
    if (depth > maxDepth) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(rel ? `${repo}/${rel}` : repo, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ".git") continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.name === "node_modules") {
        if (child !== "node_modules") found.push(child);
      } else {
        walk(child, depth + 1);
      }
    }
  };
  walk("", 0);
  return found;
}

const worktreeNodeModulesPaths = (repo: string): string[] => ["node_modules", ...nestedNodeModules(repo)];

/** Symlink the repo's node_modules (root + non-hoisted workspace) into a worktree. */
export function linkWorktreeNodeModules(repo: string, worktree: string): void {
  for (const rel of worktreeNodeModulesPaths(repo)) {
    try {
      mkdirSync(dirname(`${worktree}/${rel}`), { recursive: true });
      symlinkSync(`${repo}/${rel}`, `${worktree}/${rel}`);
    } catch {
      /* link best-effort */
    }
  }
  try {
    excludeWorktreeHelper(worktree, "node_modules");
  } catch {
    /* exclude best-effort */
  }
}

/** Remove the node_modules symlinks (root + workspace) from a worktree (hides deps from the proposer). */
export function unlinkWorktreeNodeModules(repo: string, worktree: string): void {
  for (const rel of worktreeNodeModulesPaths(repo)) {
    try {
      rmSync(`${worktree}/${rel}`, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

/** Remove a worktree and prune git's bookkeeping. */
export function removeWorktree(repo: string, worktree: string): void {
  try {
    rmSync(`${worktree}/node_modules`, { force: true });
  } catch {
    /* best-effort */
  }
  try {
    run("git", ["worktree", "remove", "--force", worktree], { cwd: repo });
    run("git", ["worktree", "prune"], { cwd: repo });
  } catch {
    /* best-effort */
  }
}

/** Reset a worktree to `ref` and optionally clean paths. Uses `@codenuke/exec` directly. */
export function resetAndCleanWorktree(
  worktree: string,
  options: { ref?: string; paths?: readonly string[]; all?: boolean } = {},
): void {
  run("git", ["-C", worktree, "reset", "--hard", options.ref ?? "HEAD"]);
  for (const path of options.paths ?? []) run("git", ["-C", worktree, "clean", "-fdq", "--", path]);
  if (options.all) run("git", ["-C", worktree, "clean", "-fdq"]);
}

/** Extract the path from a `git status --porcelain` line (handles rename `->`). */
export const gitStatusPath = (line: string): string =>
  line.slice(3).trim().replace(/^.* -> /u, "");

/** True iff `path` is the root node_modules or sits under it. */
export const isNodeModulesPath = (path: string): boolean =>
  path === "node_modules" || path.startsWith("node_modules/");

/** True iff a porcelain entry is the deliberate deletion of the hidden benchmark dir. */
export function isHiddenBenchmarkDeletion(input: {
  benchmarkInsideRepo: boolean;
  benchmarkRel: string;
  path: string;
  status: string;
}): boolean {
  const { benchmarkInsideRepo, benchmarkRel, path, status } = input;
  return (
    benchmarkInsideRepo && path.startsWith(`${benchmarkRel}/`) && status.includes("D") && !status.includes("?")
  );
}

/** Parse `git status --porcelain` output into dirty paths, filtering ignored entries. */
export function dirtyPathsFromPorcelain(
  output: string,
  { ignoreEntry = () => false }: { ignoreEntry?: (e: { line: string; path: string; status: string }) => boolean } = {},
): string[] {
  return output.split("\n").flatMap((line) => {
    const path = gitStatusPath(line);
    const status = line.slice(0, 2);
    return path && !ignoreEntry({ line, path, status }) ? [path] : [];
  });
}
