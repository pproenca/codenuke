import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { pathExists } from "../platform/fs.js";
import { FeatureRecord, TrustBoundary } from "../platform/types.js";
import { globSegmentRegExp, pathGlobSegmentsMatch } from "./path-globs.js";

export type TestRef = {
  path: string;
  command: string | null;
};

type WalkStart = {
  canonicalStart: string;
  info: Awaited<ReturnType<typeof lstat>>;
  index: number;
  rel: string;
};

type GitignoreRule = {
  pattern: string;
  negated: boolean;
  directoryOnly: boolean;
  hasSlash: boolean;
  segments: string[];
};

type GitignoreSkipPath = (path: string, isDirectory: boolean) => boolean;
type WalkSkipPath = (path: string, isDirectory?: boolean) => boolean;

export async function nearbyTests(
  root: string,
  entryPath: string,
  testCommand: string | null,
  seedTestPrefixes: string[],
  seedTestNames: string[] = [],
  candidateFiles?: readonly string[],
): Promise<TestRef[]> {
  const dir = dirname(entryPath);
  const base = entryPath.replace(/\.[^.]+$/u, "");
  const rustTestPrefixes = rustTestPrefixesForEntry(entryPath);
  const isRustEntry = entryPath.endsWith(".rs");
  const isSwiftEntry = entryPath.endsWith(".swift");
  const isCOrCppEntry = isCOrCppPath(entryPath);
  const prefixes = [
    dir === "." ? "" : dir,
    "test",
    "Tests",
    "tests",
    "__tests__",
    "src",
    ...rustTestPrefixes,
    ...seedTestPrefixes,
  ];
  const skipPath = isCOrCppEntry ? shouldSkipCOrCppNearbyPath : shouldSkip;
  const all =
    candidateFiles === undefined
      ? await walk(root, prefixes, skipPath)
      : candidateFiles.filter(
          (path) =>
            !skipPath(path) &&
            prefixes.some((prefix) => {
              const normalized = normalize(prefix).replace(/\/$/u, "");
              return (
                normalized.length === 0 || path === normalized || path.startsWith(`${normalized}/`)
              );
            }),
        );
  const stem =
    entryPath
      .split("/")
      .at(-1)
      ?.replace(/\.[^.]+$/u, "") ?? "";
  const stemTestName = testNameToken(stem);
  const swiftTestPrefixes = seedTestPrefixes.length > 0 ? [] : swiftTestPrefixesForEntry(entryPath);
  const cOrCppTestNames = seedTestNames.map(testNameToken).filter((name) => name.length > 0);
  const tests = all
    .filter((path) => path !== entryPath)
    .filter(
      (path) =>
        (isRustEntry && path.endsWith(".rs") && isTestPath(path)) ||
        (isCOrCppEntry && isCOrCppPath(path) && isCOrCppTestPath(path)) ||
        (isSwiftEntry &&
          path.endsWith(".swift") &&
          (isTestPath(path) ||
            seedTestPrefixes.some((prefix) => pathMatchesPrefix(path, prefix)))) ||
        (!isRustEntry && !isSwiftEntry && !isCOrCppEntry && isJsTestPath(path)),
    )
    .filter(
      (path) =>
        path.startsWith(base) ||
        (!isCOrCppEntry && path.includes(stem)) ||
        (isCOrCppEntry &&
          stemTestName !== "main" &&
          stemTestName.length > 0 &&
          pathMatchesTestName(path, stemTestName)) ||
        (path.endsWith(".rs") &&
          rustTestPrefixes.some((prefix) => pathMatchesPrefix(path, prefix))) ||
        (isCOrCppPath(path) &&
          seedTestPrefixes.some((prefix) => pathMatchesPrefix(path, prefix))) ||
        (isCOrCppPath(path) && cOrCppTestNames.some((name) => pathMatchesTestName(path, name))) ||
        (path.endsWith(".swift") &&
          seedTestPrefixes.some((prefix) => pathMatchesPrefix(path, prefix))) ||
        (path.endsWith(".swift") &&
          swiftTestPrefixes.some((prefix) => pathMatchesPrefix(path, prefix))),
    )
    .slice(0, 5);
  return tests.map((path) => ({ path, command: testCommand }));
}

export async function walk(
  root: string,
  prefixes: string[],
  skipPath: (path: string) => boolean = shouldSkip,
): Promise<string[]> {
  const gitignoreSkipPath = await gitignoreSkip(root);
  const effectiveSkipPath: WalkSkipPath = (path, isDirectory = false) =>
    skipPath(path) || gitignoreSkipPath(path, isDirectory);
  const files: string[] = [];
  const seen = new Set<string>();
  const seenRoots = new Set<string>();
  const realRoot = await realpath(root).then(
    (value) => value,
    () => root,
  );
  const starts: WalkStart[] = [];
  for (const [index, prefix] of prefixes.entries()) {
    const start = join(root, prefix);
    if (!(await pathExists(start))) {
      continue;
    }
    const initial = await lstat(start);
    const canonicalStart = await realpath(start).then(
      (value) => value,
      () => start,
    );
    if (initial.isSymbolicLink() && prefix !== "") {
      continue;
    }
    const info = initial.isSymbolicLink()
      ? await lstat(canonicalStart).then(
          (value) => value,
          () => initial,
        )
      : initial;
    if (!pathInsideRoot(realRoot, canonicalStart)) {
      continue;
    }
    const rel = normalize(relative(realRoot, canonicalStart));
    starts.push({ canonicalStart, info, index, rel });
  }
  for (const { canonicalStart, info, rel } of uncoveredWalkStarts(starts, effectiveSkipPath)) {
    if (info.isFile()) {
      if (!seen.has(rel) && !effectiveSkipPath(rel, false)) {
        seen.add(rel);
        files.push(rel);
      }
      continue;
    }
    if (!info.isDirectory() || seenRoots.has(canonicalStart)) {
      continue;
    }
    seenRoots.add(canonicalStart);
    await walkDir(realRoot, canonicalStart, files, seen, effectiveSkipPath);
  }
  return files.toSorted();
}

async function gitignoreSkip(root: string): Promise<GitignoreSkipPath> {
  const gitignorePath = join(root, ".gitignore");
  if (!(await pathExists(gitignorePath))) {
    return () => false;
  }
  const rules = gitignoreRules(await readFile(gitignorePath, "utf8"));
  if (rules.length === 0) {
    return () => false;
  }
  return (path, isDirectory) => {
    let ignored = false;
    for (const rule of rules) {
      if (gitignoreRuleMatches(rule, path, isDirectory)) {
        ignored = !rule.negated;
      }
    }
    return ignored;
  };
}

function gitignoreRules(source: string): GitignoreRule[] {
  return source
    .split(/\r?\n/u)
    .map(gitignoreRule)
    .filter((rule): rule is GitignoreRule => rule !== null);
}

function gitignoreRule(line: string): GitignoreRule | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith("#")) {
    return null;
  }
  const unescaped =
    trimmed.startsWith("\\#") || trimmed.startsWith("\\!") ? trimmed.slice(1) : trimmed;
  const negated = unescaped.startsWith("!");
  const rawPattern = negated ? unescaped.slice(1) : unescaped;
  const directoryOnly = rawPattern.endsWith("/");
  const pattern = rawPattern.replace(/^\/+/u, "").replace(/\/+$/u, "");
  if (pattern.length === 0) {
    return null;
  }
  return {
    pattern,
    negated,
    directoryOnly,
    hasSlash: pattern.includes("/"),
    segments: pattern.split("/"),
  };
}

function gitignoreRuleMatches(rule: GitignoreRule, path: string, isDirectory: boolean): boolean {
  if (path.length === 0) {
    return false;
  }
  const parts = path.split("/");
  if (!rule.hasSlash) {
    return parts.some(
      (part, index) =>
        globSegmentRegExp(rule.pattern).test(part) &&
        (!rule.directoryOnly || index < parts.length - 1 || isDirectory),
    );
  }
  return pathMatchesGitignoreSegments(parts, rule.segments, rule.directoryOnly, isDirectory);
}

function pathMatchesGitignoreSegments(
  pathSegments: string[],
  patternSegments: string[],
  directoryOnly: boolean,
  isDirectory: boolean,
): boolean {
  for (let length = 1; length <= pathSegments.length; length += 1) {
    if (
      pathGlobSegmentsMatch(patternSegments, pathSegments.slice(0, length)) &&
      (!directoryOnly || length < pathSegments.length || isDirectory)
    ) {
      return true;
    }
  }
  return false;
}

function uncoveredWalkStarts(starts: WalkStart[], skipPath: WalkSkipPath): WalkStart[] {
  return starts.filter(
    (start) =>
      !start.info.isDirectory() ||
      !starts.some(
        (candidate) =>
          candidate.info.isDirectory() &&
          candidate.index !== start.index &&
          (candidate.canonicalStart !== start.canonicalStart || candidate.index < start.index) &&
          directoryStartCovers(candidate, start, skipPath),
      ),
  );
}

function directoryStartCovers(
  candidate: WalkStart,
  start: WalkStart,
  skipPath: WalkSkipPath,
): boolean {
  if (candidate.canonicalStart === start.canonicalStart) {
    return true;
  }
  if (
    !pathInsideRoot(candidate.canonicalStart, start.canonicalStart) ||
    skipPath(candidate.rel, true)
  ) {
    return false;
  }
  const relativePath = normalize(relative(candidate.canonicalStart, start.canonicalStart));
  const parts = relativePath.split("/").filter((part) => part.length > 0);
  let path = candidate.rel;
  for (const part of parts.slice(0, -1)) {
    path = path.length === 0 ? part : `${path}/${part}`;
    if (skipPath(path, true)) {
      return false;
    }
  }
  return true;
}

async function walkDir(
  root: string,
  dir: string,
  files: string[],
  seen: Set<string>,
  skipPath: WalkSkipPath,
): Promise<void> {
  const dirInfo = await lstat(dir);
  if (dirInfo.isSymbolicLink()) {
    return;
  }
  const realDir = await realpath(dir).then(
    (value) => value,
    () => dir,
  );
  if (!pathInsideRoot(root, realDir)) {
    return;
  }
  const relDir = normalize(relative(root, dir));
  if (skipPath(relDir, true)) {
    return;
  }
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = normalize(relative(root, full));
    if (seen.has(rel) || skipPath(rel, entry.isDirectory())) {
      continue;
    }
    seen.add(rel);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      await walkDir(root, full, files, seen, skipPath);
      continue;
    }
    if (entry.isFile()) {
      files.push(rel);
    }
  }
}

export async function isSafeDirectory(root: string, path: string): Promise<boolean> {
  if (!(await pathExists(path))) {
    return false;
  }
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    return false;
  }
  const [realRoot, realDir] = await Promise.all([realpath(root), realpath(path)]);
  return pathInsideRoot(realRoot, realDir);
}

export async function isSafeFile(root: string, path: string): Promise<boolean> {
  if (!(await pathExists(path))) {
    return false;
  }
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    return false;
  }
  const [realRoot, realFile] = await Promise.all([realpath(root), realpath(path)]);
  return pathInsideRoot(realRoot, realFile);
}

export function pathInsideRoot(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function shouldSkip(path: string): boolean {
  if (path === "") {
    return false;
  }
  return (
    /(^|\/)(node_modules|dist|build|coverage|\.build|\.git|\.codenuke|\.worktrees|\.turbo|\.next|\.vercel|\.venv(?:-[^/]+)?|venv|Pods|Carthage|SourcePackages|DerivedData|__pycache__)(\/|$)/u.test(
      path,
    ) ||
    path === "target" ||
    path.startsWith("target/") ||
    path === ".build" ||
    path.startsWith(".build/")
  );
}

export function isSampleProjectPath(path: string): boolean {
  return /(^|\/)(fixtures|__fixtures__|testdata)(\/|$)/u.test(path);
}

export function packageKind(name: string): FeatureRecord["kind"] {
  if (/config|store|db|github|openai|sync/iu.test(name)) {
    return "service";
  }
  if (/cli/iu.test(name)) {
    return "cli-command";
  }
  return "library";
}

export function packageTrustBoundaries(name: string): TrustBoundary[] {
  const boundaries: TrustBoundary[] = [];
  if (/config|store|db/iu.test(name)) {
    boundaries.push("filesystem", "database");
  }
  if (/github|openai|sync/iu.test(name)) {
    boundaries.push("network", "external-api", "serialization");
  }
  if (/cli/iu.test(name)) {
    boundaries.push("user-input", "process-exec");
  }
  return boundaries;
}

export function normalize(path: string): string {
  return path.split(sep).join("/");
}

export function stripLineComments(source: string, marker: "#" | "//"): string {
  return source
    .split("\n")
    .map((line) => stripLineComment(line, marker))
    .join("\n");
}

export function stripSwiftComments(source: string): string {
  return stripLineComments(stripBlockComments(source), "//");
}

export function pathMatchesPrefix(path: string, prefix: string): boolean {
  const normalized = normalize(prefix).replace(/\/$/u, "");
  return normalized === "" || path === normalized || path.startsWith(`${normalized}/`);
}

function pathMatchesTestName(path: string, name: string): boolean {
  const normalized = testNameToken(path.replace(/\.[^.]+$/u, ""));
  return (
    normalized === name ||
    normalized.startsWith(`${name}_`) ||
    normalized.endsWith(`_${name}`) ||
    normalized.includes(`_${name}_`)
  );
}

function testNameToken(name: string): string {
  return name
    .replace(/\.[^.]+$/u, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}

export async function detectNodePackageManager(root: string): Promise<string> {
  if (
    (await pathExists(join(root, "pnpm-lock.yaml"))) ||
    (await pathExists(join(root, "pnpm-workspace.yaml")))
  ) {
    return "pnpm";
  }
  if (await pathExists(join(root, "yarn.lock"))) {
    return "yarn";
  }
  if (await pathExists(join(root, "bun.lockb"))) {
    return "bun";
  }
  return "npm";
}

export function nodeScriptCommand(
  packageManager: string,
  packageRoot: string,
  script: string,
): string {
  if (packageRoot === ".") {
    if (packageManager === "bun") {
      return `bun run ${script}`;
    }
    return packageManager === "npm" ? `npm run ${script}` : `${packageManager} ${script}`;
  }
  if (packageManager === "pnpm") {
    return `pnpm --dir ${packageRoot} ${script}`;
  }
  if (packageManager === "yarn") {
    return `yarn --cwd ${packageRoot} ${script}`;
  }
  if (packageManager === "bun") {
    return `bun --cwd ${packageRoot} run ${script}`;
  }
  return `npm --prefix ${packageRoot} run ${script}`;
}

function isTestPath(path: string): boolean {
  return (
    isJsTestPath(path) ||
    /^tests\/[^/]+\.rs$/u.test(path) ||
    /\/tests\/[^/]+\.rs$/u.test(path) ||
    /^Tests\/.+\.swift$/u.test(path) ||
    /(^|\/)[^/]+Tests\/[^/]+Tests\/.+\.swift$/u.test(path)
  );
}

function isJsTestPath(path: string): boolean {
  return /\.(test|spec)\.(ts|tsx|js|jsx)$/u.test(path);
}

export function isCOrCppPath(path: string): boolean {
  return /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/iu.test(path);
}

export function isCOrCppTestPath(path: string): boolean {
  const base = path.split("/").at(-1) ?? path;
  return (
    /(^|\/)(test|tests|__tests__)\//iu.test(path) ||
    /^test[_-]/iu.test(base) ||
    /(?:^|[_-])tests?\./iu.test(base) ||
    /Tests?\.[^.]+$/u.test(base)
  );
}

function shouldSkipCOrCppNearbyPath(path: string): boolean {
  return shouldSkip(path) || isCOrCppDependencyPath(path) || isSampleProjectPath(path);
}

function isCOrCppDependencyPath(path: string): boolean {
  return /(^|\/)(vendor|CMakeFiles|cmake-build-[^/]+)(\/|$)/u.test(path);
}

function swiftTestPrefixesForEntry(entryPath: string): string[] {
  if (!entryPath.endsWith(".swift")) {
    return [];
  }
  const parts = entryPath.split("/");
  if (parts.at(0) !== "Sources") {
    return [];
  }
  const target = parts.length === 2 ? parts.at(1)?.replace(/\.swift$/u, "") : parts.at(1);
  if (target === undefined || target.length === 0) {
    return [];
  }
  return [`Tests/${target}Tests/`, `Tests/${target}/`];
}

function rustTestPrefixesForEntry(entryPath: string): string[] {
  if (!entryPath.endsWith(".rs")) {
    return [];
  }
  const parts = entryPath.split("/");
  const srcIndex = parts.indexOf("src");
  if (srcIndex > 0) {
    return [`${parts.slice(0, srcIndex).join("/")}/tests/`];
  }
  return ["tests/"];
}

function stripBlockComments(source: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
    } else if (char === "/" && next === "*") {
      let depth = 1;
      output += "  ";
      index += 2;
      while (index < source.length && depth > 0) {
        if (source[index] === "/" && source[index + 1] === "*") {
          output += "  ";
          depth += 1;
          index += 2;
          continue;
        }
        if (source[index] === "*" && source[index + 1] === "/") {
          output += "  ";
          depth -= 1;
          index += 2;
          continue;
        }
        output += source[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      index -= 1;
    } else {
      output += char;
    }
  }
  return output;
}

function stripLineComment(line: string, marker: "#" | "//"): string {
  let inString = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (line.startsWith(marker, index)) {
      return line.slice(0, index);
    }
  }
  return line;
}
