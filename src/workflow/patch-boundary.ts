import { FeatureRecord, FindingRecord } from "../platform/types.js";

export type PatchBoundary = {
  allowedFiles: string[];
  unexpectedFiles: string[];
};

export function patchBoundaryForFix(
  finding: FindingRecord,
  feature: FeatureRecord,
  plannedFiles: readonly string[],
  changedFiles: readonly string[],
): PatchBoundary {
  const allowed = new Set<string>();
  for (const path of [
    ...finding.evidence.map((evidence) => evidence.path),
    ...feature.ownedFiles.map((file) => file.path),
    ...feature.contextFiles.map((file) => file.path),
    ...feature.tests.map((test) => test.path),
    ...feature.entrypoints.map((entrypoint) => entrypoint.path),
  ]) {
    if (path.length > 0) {
      allowed.add(normalizePath(path));
    }
  }

  for (const path of plannedFiles) {
    const normalized = normalizePath(path);
    if (isSafePlannedPath(normalized)) {
      allowed.add(normalized);
    }
  }

  const unexpectedFiles = changedFiles
    .map(normalizePath)
    .filter((path) => !allowed.has(path))
    .toSorted();
  return {
    allowedFiles: [...allowed].toSorted(),
    unexpectedFiles,
  };
}

function isSafePlannedPath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("../") &&
    !path.startsWith("/") &&
    !isAlwaysOutOfBoundaryPath(path)
  );
}

function isAlwaysOutOfBoundaryPath(path: string): boolean {
  return (
    path === ".git" ||
    path.startsWith(".git/") ||
    path === ".codenuke" ||
    path.startsWith(".codenuke/") ||
    path === ".agents" ||
    path.startsWith(".agents/") ||
    path === "node_modules" ||
    path.startsWith("node_modules/") ||
    path === "dist" ||
    path.startsWith("dist/") ||
    path === "build" ||
    path.startsWith("build/") ||
    path === "target" ||
    path.startsWith("target/") ||
    isLockfile(path)
  );
}

function isLockfile(path: string): boolean {
  return /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|Cargo\.lock|poetry\.lock|uv\.lock)$/u.test(
    path,
  );
}

function normalizePath(path: string): string {
  return path.replace(/\\/gu, "/").replace(/\/$/u, "");
}
