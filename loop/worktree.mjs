import { appendFileSync, readFileSync, rmSync } from "node:fs";
import { quoteShellArg, runCommand } from "./shell.mjs";

export function excludeWorktreeHelper(worktree, path) {
  const exclude = runCommand("git rev-parse --git-path info/exclude", { cwd: worktree }).trim();
  let current = "";
  try {
    current = readFileSync(exclude, "utf8");
  } catch {}
  if (!current.split(/\r?\n/u).includes(path)) appendFileSync(exclude, `${path}\n`);
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
