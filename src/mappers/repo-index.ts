import { extname } from "node:path";
import { walk } from "./shared.js";

export type RepoIndex = {
  files: string[];
  fileSet: ReadonlySet<string>;
  basenames: ReadonlySet<string>;
  directories: ReadonlySet<string>;
  extensions: ReadonlySet<string>;
  filesByExtension: ReadonlyMap<string, readonly string[]>;
};

export async function buildRepoIndex(root: string): Promise<RepoIndex> {
  return repoIndexFromFiles(await walk(root, [""]));
}

export function repoIndexFromFiles(files: string[]): RepoIndex {
  const sortedFiles = files.toSorted();
  const basenames = new Set<string>();
  const directories = new Set<string>();
  const extensions = new Set<string>();
  const filesByExtension = new Map<string, string[]>();
  for (const file of sortedFiles) {
    const parts = file.split("/");
    const basename = parts.at(-1);
    if (basename !== undefined) {
      basenames.add(basename);
      const extension = extname(basename);
      if (extension.length > 0) {
        const normalizedExtension = extension.toLowerCase();
        extensions.add(normalizedExtension);
        const extensionFiles = filesByExtension.get(normalizedExtension) ?? [];
        extensionFiles.push(file);
        filesByExtension.set(normalizedExtension, extensionFiles);
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
    filesByExtension,
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
  if (normalizedPrefixes.some((prefix) => prefix.length === 0)) {
    return index.files;
  }
  const matched = new Set<string>();
  for (const prefix of normalizedPrefixes) {
    if (index.fileSet.has(prefix)) {
      matched.add(prefix);
    }
    const directoryPrefix = `${prefix}/`;
    const start = lowerBound(index.files, directoryPrefix);
    for (let indexOffset = start; indexOffset < index.files.length; indexOffset += 1) {
      const file = index.files[indexOffset];
      if (file === undefined) {
        break;
      }
      if (file.startsWith(directoryPrefix)) {
        matched.add(file);
        continue;
      }
      break;
    }
  }
  return index.files.filter((file) => matched.has(file));
}

export function repoFilesWithAnyExtension(
  index: RepoIndex,
  extensions: readonly string[],
): string[] {
  const extensionSet = new Set(extensions.map((extension) => extension.toLowerCase()));
  const matched = new Set<string>();
  for (const extension of extensionSet) {
    for (const file of index.filesByExtension.get(extension) ?? []) {
      matched.add(file);
    }
  }
  return index.files.filter((file) => matched.has(file));
}

function normalizePrefix(prefix: string): string {
  return prefix.replace(/\\/gu, "/").replace(/\/$/u, "");
}

function lowerBound(values: readonly string[], target: string): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const value = values[middle];
    if (value !== undefined && value < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}
