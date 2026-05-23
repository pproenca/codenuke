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
