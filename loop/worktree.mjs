import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname } from "node:path";
import { quoteShellArg, runCommand } from "./shell.mjs";

export function excludeWorktreeHelper(worktree, path) {
  const exclude = runCommand("git rev-parse --git-path info/exclude", { cwd: worktree }).trim();
  let current = "";
  try {
    current = readFileSync(exclude, "utf8");
  } catch {}
  if (!current.split(/\r?\n/u).includes(path)) appendFileSync(exclude, `${path}\n`);
}

// Find `node_modules` dirs under repo (skipping .git and never descending into node_modules),
// so monorepo workspace packages that bun/pnpm install non-hoisted (e.g. packages/x/node_modules)
// are discoverable. Bounded depth keeps it to a fast directory-only walk.
function nestedNodeModules(repo, maxDepth = 4) {
  const found = [];
  const walk = (rel, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(rel ? `${repo}/${rel}` : repo, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === ".git") continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.name === "node_modules") {
        if (child !== "node_modules") found.push(child); // root handled by the caller
      } else walk(child, depth + 1);
    }
  };
  walk("", 0);
  return found;
}

const worktreeNodeModulesPaths = (repo) => ["node_modules", ...nestedNodeModules(repo)];

// Provision a worktree's dependencies by symlinking the repo's node_modules into it — the root one
// plus any non-hoisted workspace ones (a single bare `node_modules` git-exclude covers them all).
// Source isolation is unaffected: only deps are shared, exactly as the root-only link always did.
export function linkWorktreeNodeModules(repo, worktree) {
  for (const rel of worktreeNodeModulesPaths(repo)) {
    try {
      mkdirSync(dirname(`${worktree}/${rel}`), { recursive: true });
      symlinkSync(`${repo}/${rel}`, `${worktree}/${rel}`);
    } catch {}
  }
  try {
    excludeWorktreeHelper(worktree, "node_modules");
  } catch {}
}

// Remove the node_modules symlinks (root + workspace) from a worktree — used to hide runtime deps
// from the proposer (INV-3). Removes only the links, never the repo's real node_modules.
export function unlinkWorktreeNodeModules(repo, worktree) {
  for (const rel of worktreeNodeModulesPaths(repo)) {
    try {
      rmSync(`${worktree}/${rel}`, { recursive: true, force: true });
    } catch {}
  }
}

export function removeWorktree(repo, worktree) {
  try {
    rmSync(`${worktree}/node_modules`, { force: true });
  } catch {}
  try {
    runCommand(`git worktree remove --force ${quoteShellArg(worktree)}`, { cwd: repo });
    runCommand("git worktree prune", { cwd: repo });
  } catch {}
}

export function resetAndCleanWorktree(run, worktree, options = {}) {
  run(`git -C ${worktree} reset --hard ${options.ref ?? "HEAD"}`);
  for (const path of options.paths ?? [])
    run(`git -C ${worktree} clean -fdq -- ${quoteShellArg(path)}`);
  if (options.all) run(`git -C ${worktree} clean -fdq`);
}

export const gitStatusPath = (line) =>
  line
    .slice(3)
    .trim()
    .replace(/^.* -> /u, "");

export const isNodeModulesPath = (path) =>
  path === "node_modules" || path.startsWith("node_modules/");

export function isHiddenBenchmarkDeletion({ benchmarkInsideRepo, benchmarkRel, path, status }) {
  return (
    benchmarkInsideRepo &&
    path.startsWith(`${benchmarkRel}/`) &&
    status.includes("D") &&
    !status.includes("?")
  );
}

export function dirtyPathsFromPorcelain(output, { ignoreEntry = () => false } = {}) {
  return output.split("\n").flatMap((line) => {
    const path = gitStatusPath(line);
    const status = line.slice(0, 2);
    return path && !ignoreEntry({ line, path, status }) ? [path] : [];
  });
}
