#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const defaultExtensions = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".md",
  ".mjs",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".swift",
  ".ts",
  ".tsx",
  ".vue",
]);

const ignoredPathParts = new Set([
  ".codenuke",
  ".codex",
  ".git",
  ".next",
  ".scratch",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "target",
]);

const stopWords = new Set([
  "a",
  "about",
  "after",
  "all",
  "also",
  "an",
  "and",
  "any",
  "are",
  "args",
  "as",
  "async",
  "at",
  "await",
  "be",
  "because",
  "been",
  "boolean",
  "by",
  "case",
  "catch",
  "class",
  "const",
  "constructor",
  "default",
  "do",
  "each",
  "else",
  "enum",
  "export",
  "false",
  "for",
  "from",
  "function",
  "has",
  "if",
  "import",
  "in",
  "is",
  "it",
  "let",
  "map",
  "new",
  "not",
  "null",
  "number",
  "object",
  "of",
  "on",
  "or",
  "private",
  "public",
  "readonly",
  "return",
  "set",
  "string",
  "that",
  "the",
  "this",
  "to",
  "true",
  "type",
  "undefined",
  "use",
  "value",
  "values",
  "void",
  "when",
  "with",
]);

const identifierRe = /[A-Za-z_][A-Za-z0-9_]*|\d+/gu;
const splitRe = /[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|\d+/gu;
const useEffectRe = /\buseEffect\s*\(/gu;
const declarationRe =
  /\b(?:function|class|interface|type|enum)\s+[A-Za-z_][A-Za-z0-9_]*|\b(?:const|let|var)\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_][A-Za-z0-9_]*)\s*=>/gu;
const callishRe = /\b[A-Za-z_][A-Za-z0-9_]*\s*\(/gu;

const hashSeed = 0x811c9dc5;

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    query: "",
    top: 12,
    smallLines: 24,
    largeLines: 140,
    minTokens: 18,
    clusterThreshold: 0.48,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--query" || arg === "-q") {
      options.query = argv.at((i += 1)) ?? "";
    } else if (arg === "--top") {
      options.top = Number.parseInt(argv.at((i += 1)) ?? "", 10);
    } else if (arg === "--small-lines") {
      options.smallLines = Number.parseInt(argv.at((i += 1)) ?? "", 10);
    } else if (arg === "--large-lines") {
      options.largeLines = Number.parseInt(argv.at((i += 1)) ?? "", 10);
    } else if (arg === "--cluster-threshold") {
      options.clusterThreshold = Number.parseFloat(argv.at((i += 1)) ?? "");
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith("-")) {
      options.root = arg;
    }
  }

  if (!Number.isFinite(options.top) || options.top < 1) options.top = 12;
  if (!Number.isFinite(options.smallLines) || options.smallLines < 8) options.smallLines = 24;
  if (!Number.isFinite(options.largeLines) || options.largeLines < options.smallLines) {
    options.largeLines = Math.max(80, options.smallLines * 4);
  }
  if (!Number.isFinite(options.clusterThreshold) || options.clusterThreshold <= 0) {
    options.clusterThreshold = 0.34;
  }

  return options;
}

function printHelp() {
  console.log(`Text pocket POC

Usage:
  node scripts/text-pocket-poc.mjs [root] [--query "use effect"] [--top 12] [--json]

What it does:
  - builds small rolling text windows for refactor pockets
  - builds large rolling text windows for feature/topic traces
  - ranks windows with identifier splitting, TF-IDF cosine, SimHash-ish locality,
    lexical cohesion, and regex-only structure density

No AST, parser, dependencies, or provider calls are used.`);
}

function trackedFiles(root) {
  const output = execFileSync("git", ["-C", root, "ls-files"], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return output
    .split("\n")
    .filter(Boolean)
    .filter((file) => isCandidateFile(root, file));
}

function isCandidateFile(root, file) {
  if (file.split("/").some((part) => ignoredPathParts.has(part))) return false;
  if (/\.(lock|png|jpg|jpeg|gif|webp|svg|ico|pdf|zip|gz|tgz)$/iu.test(file)) return false;
  const dot = file.lastIndexOf(".");
  if (dot !== -1 && !defaultExtensions.has(file.slice(dot))) return false;
  const fullPath = resolve(root, file);
  if (!existsSync(fullPath)) return false;
  const stats = statSync(fullPath);
  return stats.isFile() && stats.size > 0 && stats.size <= 350_000;
}

function splitIdentifier(raw) {
  return raw
    .split(/[_\-.]+/u)
    .flatMap((part) => part.match(splitRe) ?? [])
    .map((token) => token.toLowerCase())
    .filter((token) => token.length > 1 && !stopWords.has(token) && !/^\d+$/u.test(token));
}

function tokenize(text) {
  const tokens = [];
  for (const match of text.matchAll(identifierRe)) {
    tokens.push(...splitIdentifier(match[0]));
  }
  return tokens;
}

function makeWindows(root, files, windowLines, label, minTokens) {
  const windows = [];
  const stride = Math.max(6, Math.floor(windowLines / 2));
  for (const file of files) {
    const fullPath = resolve(root, file);
    const source = readFileSync(fullPath, "utf8");
    if (source.includes("\0")) continue;
    const lines = source.split(/\r?\n/u);
    for (let start = 0; start < lines.length; start += stride) {
      const end = Math.min(lines.length, start + windowLines);
      const text = lines.slice(start, end).join("\n");
      const tokens = tokenize(text);
      if (tokens.length < minTokens) continue;
      const tokenCounts = countTokens(tokens);
      windows.push({
        id: `${file}:${start + 1}-${end}`,
        file,
        startLine: start + 1,
        endLine: end,
        kind: label,
        lines: end - start,
        text,
        tokens,
        tokenCounts,
        useEffects: countMatches(text, useEffectRe),
        declarations: countMatches(text, declarationRe),
        calls: countMatches(text, callishRe),
        simhash: simhash(tokens),
      });
    }
  }
  return windows;
}

function countMatches(text, re) {
  re.lastIndex = 0;
  return [...text.matchAll(re)].length;
}

function countTokens(tokens) {
  const counts = new Map();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

function buildIdf(documents) {
  const df = new Map();
  for (const doc of documents) {
    for (const token of doc.tokenCounts.keys()) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }
  const total = documents.length || 1;
  return new Map([...df].map(([token, count]) => [token, Math.log((1 + total) / (1 + count)) + 1]));
}

function topWeightedTerms(doc, idf, limit = 8) {
  return [...doc.tokenCounts]
    .map(([token, count]) => [token, (1 + Math.log(count)) * (idf.get(token) ?? 1)])
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([token]) => token);
}

function vectorFor(doc, idf) {
  const vector = new Map();
  let norm = 0;
  for (const [token, count] of doc.tokenCounts) {
    const weight = (1 + Math.log(count)) * (idf.get(token) ?? 1);
    vector.set(token, weight);
    norm += weight * weight;
  }
  return { vector, norm: Math.sqrt(norm) || 1 };
}

function cosine(a, b) {
  const [small, large] =
    a.vector.size < b.vector.size ? [a.vector, b.vector] : [b.vector, a.vector];
  let dot = 0;
  for (const [token, weight] of small) {
    dot += weight * (large.get(token) ?? 0);
  }
  return dot / (a.norm * b.norm);
}

function queryVector(query, idf) {
  const tokens = tokenize(query);
  return vectorFor({ tokenCounts: countTokens(tokens) }, idf);
}

function scoreWindows(windows, idf, query) {
  const vectors = new Map(windows.map((window) => [window.id, vectorFor(window, idf)]));
  const queryVec = query.trim().length > 0 ? queryVector(query, idf) : null;

  return windows
    .map((window) => {
      const concentration = lexicalConcentration(window.tokenCounts, window.tokens.length);
      const repeatedTerms = [...window.tokenCounts.values()].filter((count) => count >= 3).length;
      const hookDensity = window.useEffects / window.lines;
      const declarationDensity = window.declarations / window.lines;
      const callDensity = Math.min(1, window.calls / Math.max(1, window.lines * 2));
      const queryScore = queryVec === null ? 0 : cosine(vectors.get(window.id), queryVec);
      const structureScore = Math.min(1.5, window.useEffects * 0.42 + window.declarations * 0.1);
      const pocketScore =
        concentration * 1.8 +
        Math.min(1, repeatedTerms / 12) * 0.75 +
        hookDensity * 8 +
        declarationDensity * 2 +
        callDensity * 0.35 +
        structureScore +
        queryScore * 2.4;
      return {
        ...window,
        score: pocketScore,
        queryScore,
        concentration,
        topTerms: topWeightedTerms(window, idf),
      };
    })
    .toSorted((a, b) => b.score - a.score);
}

function lexicalConcentration(counts, total) {
  if (total === 0) return 0;
  let sum = 0;
  for (const count of counts.values()) {
    const p = count / total;
    sum += p * p;
  }
  return Math.sqrt(sum);
}

function simhash(tokens) {
  const weights = Array.from({ length: 64 }, () => 0);
  for (const token of tokens) {
    const hash = fnv1a64(token);
    for (let bit = 0; bit < 64; bit += 1) {
      weights[bit] += (hash >> BigInt(bit)) & 1n ? 1 : -1;
    }
  }
  let fingerprint = 0n;
  for (let bit = 0; bit < 64; bit += 1) {
    if (weights[bit] > 0) fingerprint |= 1n << BigInt(bit);
  }
  return fingerprint;
}

function fnv1a64(text) {
  let hash = BigInt(hashSeed);
  const prime = 0x100000001b3n;
  for (const char of text) {
    hash ^= BigInt(char.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash;
}

function hamming(a, b) {
  let value = a ^ b;
  let count = 0;
  while (value !== 0n) {
    value &= value - 1n;
    count += 1;
  }
  return count;
}

function clusterLargeWindows(windows, idf, threshold) {
  const candidates = windows.slice(0, Math.min(windows.length, 500));
  const vectors = candidates.map((window) => vectorFor(window, idf));
  const parent = candidates.map((_, index) => index);

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      if (candidates[i].file === candidates[j].file && rangesOverlap(candidates[i], candidates[j]))
        continue;
      const score = cosine(vectors[i], vectors[j]);
      const overlap = termOverlap(candidates[i].topTerms, candidates[j].topTerms);
      if (
        (score >= threshold && overlap >= 2) ||
        (overlap >= 3 && hamming(candidates[i].simhash, candidates[j].simhash) <= 7)
      ) {
        union(parent, i, j);
      }
    }
  }

  const groups = new Map();
  for (let i = 0; i < candidates.length; i += 1) {
    const root = find(parent, i);
    const group = groups.get(root) ?? [];
    group.push(candidates[i]);
    groups.set(root, group);
  }

  return [...groups.values()]
    .filter((group) => group.length >= 2)
    .map((group) => {
      const terms = group.flatMap((window) => window.topTerms);
      const topTerms = [...countTokens(terms)]
        .toSorted((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([token]) => token);
      return {
        score: average(group.map((window) => window.score)) + Math.log2(group.length + 1),
        files: [...new Set(group.map((window) => window.file))],
        windows: group,
        topTerms,
      };
    })
    .toSorted((a, b) => b.score - a.score);
}

function termOverlap(left, right) {
  const rightTerms = new Set(right);
  return left.filter((term) => rightTerms.has(term)).length;
}

function rangesOverlap(a, b) {
  return a.startLine <= b.endLine && b.startLine <= a.endLine;
}

function find(parent, index) {
  while (parent[index] !== index) {
    parent[index] = parent[parent[index]];
    index = parent[index];
  }
  return index;
}

function union(parent, a, b) {
  const rootA = find(parent, a);
  const rootB = find(parent, b);
  if (rootA !== rootB) parent[rootB] = rootA;
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function toJsonPocket(window) {
  return {
    id: window.id,
    kind: window.kind,
    score: Number(window.score.toFixed(3)),
    queryScore: Number(window.queryScore.toFixed(3)),
    concentration: Number(window.concentration.toFixed(3)),
    useEffects: window.useEffects,
    declarations: window.declarations,
    calls: window.calls,
    topTerms: window.topTerms,
  };
}

function printText(result, options) {
  console.log(
    `Text pocket POC: ${result.files.length} files, ${result.small.length} small windows, ${result.large.length} large windows`,
  );
  if (options.query) console.log(`Query: ${options.query}`);

  console.log("\nSmall refactor pockets");
  for (const pocket of result.small.slice(0, options.top)) {
    console.log(
      `- ${pocket.id} score=${pocket.score.toFixed(2)} hooks=${pocket.useEffects} decls=${pocket.declarations} terms=${pocket.topTerms.join(", ")}`,
    );
  }

  console.log("\nLarge feature/topic pockets");
  for (const pocket of result.large.slice(0, options.top)) {
    console.log(
      `- ${pocket.id} score=${pocket.score.toFixed(2)} hooks=${pocket.useEffects} decls=${pocket.declarations} terms=${pocket.topTerms.join(", ")}`,
    );
  }

  console.log("\nLarge feature/topic groups");
  for (const group of result.groups.slice(0, Math.min(options.top, 8))) {
    console.log(
      `- score=${group.score.toFixed(2)} files=${group.files.length} terms=${group.topTerms.join(", ")}`,
    );
    for (const window of group.windows.slice(0, 5)) {
      console.log(`  - ${window.id} score=${window.score.toFixed(2)}`);
    }
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = resolve(options.root);
  const files = trackedFiles(root);
  const small = makeWindows(root, files, options.smallLines, "small", options.minTokens);
  const large = makeWindows(root, files, options.largeLines, "large", options.minTokens * 2);
  const allWindows = [...small, ...large];
  const idf = buildIdf(allWindows);
  const scoredSmall = scoreWindows(small, idf, options.query);
  const scoredLarge = scoreWindows(large, idf, options.query);
  const groups = clusterLargeWindows(scoredLarge, idf, options.clusterThreshold);
  const result = { root, files, small: scoredSmall, large: scoredLarge, groups };

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          root,
          files: files.length,
          smallPockets: scoredSmall.slice(0, options.top).map(toJsonPocket),
          largePockets: scoredLarge.slice(0, options.top).map(toJsonPocket),
          largeGroups: groups.slice(0, Math.min(options.top, 8)).map((group) => ({
            score: Number(group.score.toFixed(3)),
            files: group.files,
            topTerms: group.topTerms,
            windows: group.windows.slice(0, 8).map(toJsonPocket),
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  printText(result, options);
}

main();
