import { extname } from "node:path";
import { walk } from "./shared.js";

export type RepoIndex = {
  files: string[];
  fileSet: ReadonlySet<string>;
  basenames: ReadonlySet<string>;
  directories: ReadonlySet<string>;
  extensions: ReadonlySet<string>;
};

export async function buildRepoIndex(root: string): Promise<RepoIndex> {
  return repoIndexFromFiles(await walk(root, [""]));
}

export function repoIndexFromFiles(files: string[]): RepoIndex {
  const sortedFiles = files.toSorted();
  const basenames = new Set<string>();
  const directories = new Set<string>();
  const extensions = new Set<string>();
  for (const file of sortedFiles) {
    const parts = file.split("/");
    const basename = parts.at(-1);
    if (basename !== undefined) {
      basenames.add(basename);
      const extension = extname(basename);
      if (extension.length > 0) {
        extensions.add(extension.toLowerCase());
      }
    }
    let directory = "";
    for (const part of parts.slice(0, -1)) {
      directory = directory.length === 0 ? part : `${directory}/${part}`;
      directories.add(directory);
    }
  }
  return {
    files: sortedFiles,
    fileSet: new Set(sortedFiles),
    basenames,
    directories,
    extensions,
  };
}

export function repoHasAnyPath(index: RepoIndex, paths: readonly string[]): boolean {
  return paths.some((path) => index.fileSet.has(path));
}

export function repoHasAnyBasename(index: RepoIndex, names: readonly string[]): boolean {
  return names.some((name) => index.basenames.has(name));
}

export function repoHasBasenameEnding(index: RepoIndex, suffix: string): boolean {
  return [...index.basenames].some((basename) => basename.endsWith(suffix));
}

export function repoHasAnyExtension(index: RepoIndex, extensions: readonly string[]): boolean {
  return extensions.some((extension) => index.extensions.has(extension.toLowerCase()));
}

export function repoHasDirectory(index: RepoIndex, path: string): boolean {
  const normalized = path.replace(/\/$/u, "");
  return (
    normalized.length === 0 || index.directories.has(normalized) || index.fileSet.has(normalized)
  );
}

export function repoHasDirectoryEnding(index: RepoIndex, suffix: string): boolean {
  return [...index.directories].some((directory) => directory.endsWith(suffix));
}

export function repoFilesUnderAny(index: RepoIndex, prefixes: readonly string[]): string[] {
  const normalizedPrefixes = prefixes.map(normalizePrefix);
  return index.files.filter((file) =>
    normalizedPrefixes.some(
      (prefix) => prefix.length === 0 || file === prefix || file.startsWith(`${prefix}/`),
    ),
  );
}

export function repoFilesWithAnyExtension(
  index: RepoIndex,
  extensions: readonly string[],
): string[] {
  const extensionSet = new Set(extensions.map((extension) => extension.toLowerCase()));
  return index.files.filter((file) => extensionSet.has(extname(file).toLowerCase()));
}

function normalizePrefix(prefix: string): string {
  return prefix.replace(/\\/gu, "/").replace(/\/$/u, "");
}
