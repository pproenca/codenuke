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
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join("/"));
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
