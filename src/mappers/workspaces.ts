import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { pathExists } from "../platform/fs.js";
import { expandPathGlob, pathGlobMatches, pathHasGlob } from "./path-globs.js";
import { isSafeDirectory, normalize, pathMatchesPrefix, shouldSkip } from "./shared.js";

export type WorkspacePackageJson = {
  workspaces?: unknown;
};

export async function declaredWorkspacePatterns(
  root: string,
  pkg: WorkspacePackageJson | null,
): Promise<string[]> {
  const patterns = new Set<string>();
  if (pkg !== null) {
    for (const pattern of packageWorkspacePatterns(pkg)) {
      patterns.add(pattern);
    }
  }
  if (await pathExists(join(root, "pnpm-workspace.yaml"))) {
    for (const pattern of parsePnpmWorkspace(
      await readFile(join(root, "pnpm-workspace.yaml"), "utf8"),
    )) {
      patterns.add(pattern);
    }
  }
  return [...patterns];
}

export function packageWorkspacePatterns(pkg: WorkspacePackageJson): string[] {
  const workspaces = pkg.workspaces;
  if (Array.isArray(workspaces)) {
    return workspaces.filter((entry): entry is string => typeof entry === "string");
  }
  if (
    typeof workspaces !== "object" ||
    workspaces === null ||
    !("packages" in workspaces) ||
    !Array.isArray(workspaces.packages)
  ) {
    return [];
  }
  return workspaces.packages.filter((entry): entry is string => typeof entry === "string");
}

export function parsePnpmWorkspace(source: string): string[] {
  const patterns: string[] = [];
  let inPackages = false;
  for (const rawLine of source.split("\n")) {
    const line = rawLine.replace(/#.*/u, "");
    if (/^\S/u.test(line)) {
      inPackages = /^packages\s*:/u.test(line);
    }
    if (!inPackages) {
      continue;
    }
    const match = /^\s*-\s*["']?([^"'\s]+)["']?\s*$/u.exec(line);
    if (match?.[1] !== undefined) {
      patterns.push(match[1]);
    }
  }
  return patterns;
}

export async function packageRootsForWorkspacePatterns(
  root: string,
  patterns: string[],
): Promise<string[]> {
  const excludes = workspacePatternExcludes(patterns);
  const roots = new Set<string>();
  for (const pattern of patterns.filter((entry) => !entry.startsWith("!"))) {
    for (const path of await expandWorkspacePattern(root, pattern)) {
      roots.add(path);
    }
  }
  return [...roots].filter((path) => !isExcludedWorkspace(path, excludes)).toSorted();
}

export function workspacePatternExcludes(patterns: string[]): string[] {
  return patterns
    .filter((pattern) => pattern.startsWith("!"))
    .flatMap((pattern) => {
      const normalized = normalizeWorkspacePattern(pattern.slice(1));
      return normalized === null ? [] : [normalized];
    });
}

export function isExcludedWorkspace(packageRoot: string, excludes: string[]): boolean {
  return excludes.some((pattern) => workspacePatternMatches(pattern, packageRoot));
}

async function expandWorkspacePattern(root: string, pattern: string): Promise<string[]> {
  const normalized = normalizeWorkspacePattern(pattern);
  if (normalized === null) {
    return [];
  }
  if (normalized === "." || normalized === "") {
    return ["."];
  }
  if (normalized.endsWith("/**") && !pathHasGlob(normalized.slice(0, -3))) {
    return discoverPackageRootsUnder(root, normalized.slice(0, -3), 4);
  }
  const singleSegmentParent = normalized.endsWith("/*") ? normalized.slice(0, -2) : null;
  if (singleSegmentParent !== null && !pathHasGlob(singleSegmentParent)) {
    const packageRoots: string[] = [];
    for (const entry of await safeDirectoryEntries(root, singleSegmentParent)) {
      const candidate = `${singleSegmentParent}/${entry}`;
      if (await pathExists(join(root, candidate, "package.json"))) {
        packageRoots.push(candidate);
      }
    }
    return packageRoots;
  }
  if (pathHasGlob(normalized)) {
    return expandWorkspaceGlob(root, normalized);
  }
  return (await isSafeDirectory(root, join(root, normalized))) &&
    (await pathExists(join(root, normalized, "package.json")))
    ? [normalized]
    : [];
}

function normalizeWorkspacePattern(pattern: string): string | null {
  const normalized = normalize(pattern)
    .replace(/^\.\//u, "")
    .replace(/\/package\.json$/u, "")
    .replace(/\/$/u, "");
  if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
    return null;
  }
  return normalized;
}

function workspacePatternMatches(pattern: string, packageRoot: string): boolean {
  if (pattern === packageRoot) {
    return true;
  }
  if (pathHasGlob(pattern)) {
    return workspaceGlobMatches(pattern, packageRoot);
  }
  if (pattern.endsWith("/**")) {
    return pathMatchesPrefix(packageRoot, pattern.slice(0, -3));
  }
  if (pattern.endsWith("/*")) {
    const parent = pattern.slice(0, -2);
    if (!pathMatchesPrefix(packageRoot, parent)) {
      return false;
    }
    return packageRoot.slice(parent.length + 1).split("/").length === 1;
  }
  return false;
}

function workspaceGlobMatches(pattern: string, packageRoot: string): boolean {
  return pathGlobMatches(pattern, packageRoot);
}

async function expandWorkspaceGlob(root: string, pattern: string): Promise<string[]> {
  return expandPathGlob({
    pattern,
    entries: async (base) => safeDirectoryEntries(root, base),
    accepts: async (path) =>
      (await isSafeDirectory(root, join(root, path))) &&
      (await pathExists(join(root, path, "package.json"))),
  });
}

async function discoverPackageRootsUnder(
  root: string,
  prefix: string,
  maxDepth: number,
): Promise<string[]> {
  const output: string[] = [];
  await discoverPackageRootsInto(root, prefix, maxDepth, output);
  return output.toSorted();
}

async function discoverPackageRootsInto(
  root: string,
  prefix: string,
  remainingDepth: number,
  output: string[],
): Promise<void> {
  if (remainingDepth < 0 || shouldSkip(prefix)) {
    return;
  }
  if (await pathExists(join(root, prefix, "package.json"))) {
    output.push(prefix);
  }
  for (const entry of await safeDirectoryEntries(root, prefix)) {
    await discoverPackageRootsInto(root, `${prefix}/${entry}`, remainingDepth - 1, output);
  }
}

async function safeDirectoryEntries(root: string, prefix: string): Promise<string[]> {
  const dir = join(root, prefix);
  if (!(await isSafeDirectory(root, dir))) {
    return [];
  }
  const [realRoot, realDir] = await Promise.all([realpath(root), realpath(dir)]);
  if (!pathMatchesPrefix(normalize(realDir), normalize(realRoot))) {
    return [];
  }
  const entries = await readdir(dir);
  const output: string[] = [];
  for (const entry of entries) {
    const rel = normalize(join(prefix, entry));
    if (shouldSkip(rel)) {
      continue;
    }
    const childInfo = await lstat(join(dir, entry));
    if (childInfo.isDirectory() && !childInfo.isSymbolicLink()) {
      output.push(entry);
    }
  }
  return output.toSorted();
}
