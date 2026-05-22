#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const codeExtensions = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".go",
  ".h",
  ".hpp",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".mjs",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".swift",
  ".ts",
  ".tsx",
  ".vue",
]);

const textOnlyExtensions = new Set([".css", ".html", ".md", ".scss"]);
const defaultExtensions = new Set([...codeExtensions, ...textOnlyExtensions]);

const ignoredPathParts = new Set([
  ".agents",
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
    ludicrousMode: false,
    brief: false,
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
    } else if (arg === "--ludicrous-mode") {
      options.ludicrousMode = true;
    } else if (arg === "--brief") {
      options.brief = true;
      options.ludicrousMode = true;
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
  node scripts/text-pocket-poc.mjs --ludicrous-mode --top 8
  node scripts/text-pocket-poc.mjs --brief --top 3

What it does:
  - builds small rolling text windows for refactor pockets
  - builds large rolling text windows for feature/topic traces
  - ranks windows with identifier splitting, TF-IDF cosine, SimHash-ish locality,
    lexical cohesion, and regex-only structure density
  - with --ludicrous-mode, builds cross-file opportunity candidates from a
    weighted multi-signal graph over large pockets

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

function topWeightedPhrases(doc, idf, limit = 8) {
  return [...phraseCounts(doc.tokens)]
    .map(([phrase, count]) => [
      phrase,
      (1 + Math.log(count)) * average(phrase.split(" ").map((token) => idf.get(token) ?? 1)),
    ])
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([phrase]) => phrase);
}

function phraseCounts(tokens) {
  const counts = new Map();
  for (const size of [2, 3]) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      const parts = tokens.slice(index, index + size);
      if (new Set(parts).size < parts.length) continue;
      const phrase = parts.join(" ");
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  }
  return counts;
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
        topPhrases: topWeightedPhrases(window, idf),
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

function buildLudicrousOpportunities(windows, idf) {
  const candidates = windows
    .filter((window) => isCodePath(window.file))
    .slice(0, Math.min(windows.length, 520));
  const vectors = candidates.map((window) => vectorFor(window, idf));
  const edgeBuckets = candidates.map(() => []);

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      if (candidates[i].file === candidates[j].file && rangesOverlap(candidates[i], candidates[j]))
        continue;
      const edge = relationEdge(candidates[i], candidates[j], vectors[i], vectors[j]);
      if (edge.score < 0.3) continue;
      if (edge.concept < 0.16 && edge.cosine < 0.34 && edge.clone < 0.42) continue;
      edgeBuckets[i].push({ ...edge, from: i, to: j });
      edgeBuckets[j].push({ ...edge, from: j, to: i });
    }
  }

  const parent = candidates.map((_, index) => index);
  const selectedEdges = [];
  for (const bucket of edgeBuckets) {
    for (const edge of bucket.toSorted((a, b) => b.score - a.score).slice(0, 6)) {
      selectedEdges.push(edge);
      union(parent, edge.from, edge.to);
    }
  }

  const groups = new Map();
  for (let index = 0; index < candidates.length; index += 1) {
    const root = find(parent, index);
    const group = groups.get(root) ?? { indexes: [], edges: [] };
    group.indexes.push(index);
    groups.set(root, group);
  }

  for (const edge of selectedEdges) {
    const root = find(parent, edge.from);
    groups.get(root)?.edges.push(edge);
  }

  return [...groups.values()]
    .map((group) => opportunityFromGroup(group, candidates))
    .filter((opportunity) => opportunity.files.length >= 2 && opportunity.windows.length >= 3)
    .toSorted((a, b) => b.score - a.score);
}

function relationEdge(left, right, leftVector, rightVector) {
  const concept = weightedSignalOverlap(left, right);
  const cosineScore = cosine(leftVector, rightVector);
  const distance = hamming(left.simhash, right.simhash);
  const clone = Math.max(0, (18 - distance) / 18);
  const shape = structuralSimilarity(left, right);
  const path = pathSimilarity(left.file, right.file);
  return {
    score: concept * 0.48 + cosineScore * 0.28 + clone * 0.16 + shape * 0.06 + path * 0.02,
    concept,
    cosine: cosineScore,
    clone,
    shape,
    path,
  };
}

function isCodePath(path) {
  const dot = path.lastIndexOf(".");
  return dot !== -1 && codeExtensions.has(path.slice(dot));
}

function weightedSignalOverlap(left, right) {
  const leftSignals = signalWeights(left);
  const rightSignals = signalWeights(right);
  let shared = 0;
  let leftTotal = 0;
  let rightTotal = 0;
  for (const weight of leftSignals.values()) leftTotal += weight;
  for (const weight of rightSignals.values()) rightTotal += weight;
  for (const [signal, weight] of leftSignals) {
    shared += Math.min(weight, rightSignals.get(signal) ?? 0);
  }
  return shared / Math.sqrt(Math.max(1, leftTotal * rightTotal));
}

function signalWeights(window) {
  const weights = new Map();
  for (const term of window.topTerms) weights.set(term, 1);
  for (const phrase of window.topPhrases ?? []) weights.set(phrase, 1.7);
  for (const token of pathTokens(window.file)) weights.set(`path:${token}`, 0.35);
  return weights;
}

function structuralSimilarity(left, right) {
  const decl = ratioSimilarity(left.declarations, right.declarations);
  const calls = ratioSimilarity(
    left.calls / Math.max(1, left.lines),
    right.calls / Math.max(1, right.lines),
  );
  const hooks =
    left.useEffects > 0 || right.useEffects > 0
      ? ratioSimilarity(left.useEffects, right.useEffects)
      : 0;
  return decl * 0.55 + calls * 0.35 + hooks * 0.1;
}

function ratioSimilarity(left, right) {
  const max = Math.max(left, right);
  if (max === 0) return 0;
  return Math.min(left, right) / max;
}

function pathSimilarity(left, right) {
  const leftTokens = new Set(pathTokens(left));
  const rightTokens = new Set(pathTokens(right));
  const allTokens = new Set([...leftTokens, ...rightTokens]);
  if (allTokens.size === 0) return 0;
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  return shared / allTokens.size;
}

function pathTokens(path) {
  return path
    .split(/[/. _-]+/u)
    .flatMap(splitIdentifier)
    .filter((token) => token.length > 2 && !["src", "test", "tests"].includes(token));
}

function opportunityFromGroup(group, candidates) {
  const windows = group.indexes.map((index) => candidates[index]);
  const files = [...new Set(windows.map((window) => window.file))];
  const dirs = [...new Set(files.map((file) => file.split("/").slice(0, 2).join("/")))];
  const relation = edgeAverages(group.edges);
  const topSignals = topGroupSignals(windows);
  const totalLines = windows.reduce((sum, window) => sum + window.lines, 0);
  const repeatedShape = average(
    windows.map((window) => window.declarations + Math.min(20, window.calls / 4)),
  );
  const score =
    Math.log2(totalLines + 1) * 0.85 +
    files.length * 1.15 +
    Math.log2(windows.length + 1) * 1.2 +
    dirs.length * 0.5 +
    relation.score * 8 +
    repeatedShape * 0.08;

  return {
    score,
    type: inferOpportunityType(files, topSignals),
    files,
    windows,
    topSignals,
    relation,
    totalLines,
  };
}

function edgeAverages(edges) {
  if (edges.length === 0) {
    return { score: 0, concept: 0, cosine: 0, clone: 0, shape: 0, path: 0 };
  }
  return {
    score: average(edges.map((edge) => edge.score)),
    concept: average(edges.map((edge) => edge.concept)),
    cosine: average(edges.map((edge) => edge.cosine)),
    clone: average(edges.map((edge) => edge.clone)),
    shape: average(edges.map((edge) => edge.shape)),
    path: average(edges.map((edge) => edge.path)),
  };
}

function topGroupSignals(windows) {
  const counts = new Map();
  for (const window of windows) {
    for (const term of window.topTerms) counts.set(term, (counts.get(term) ?? 0) + 1);
    for (const phrase of window.topPhrases ?? [])
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1.4);
  }
  return [...counts]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([signal]) => signal);
}

function inferOpportunityType(files, signals) {
  const joined = `${files.join(" ")} ${signals.join(" ")}`;
  if (/\bmapper|mappers|react|rust|ruby|python|laravel|gradle|swift|cargo\b/u.test(joined)) {
    return "cross-mapper-pattern";
  }
  if (/\bprovider|schema|json|command|prompt|output\b/u.test(joined)) return "provider-contract";
  if (/\bworkflow|patch|finding|state|validation\b/u.test(joined)) return "workflow-state";
  if (/\bflag|flags|help|arg|cli\b/u.test(joined)) return "cli-model";
  if (/\bchar|cursor|brace|quote|escaped|expression|props\b/u.test(joined))
    return "repeated-parser";
  if (/\btest|expect|fixture|assert\b/u.test(joined)) return "test-scaffold";
  return "cross-file-refactor";
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
    topPhrases: window.topPhrases ?? [],
  };
}

function toJsonOpportunity(opportunity) {
  const brief = opportunityBrief(opportunity);
  return {
    type: opportunity.type,
    score: Number(opportunity.score.toFixed(3)),
    files: opportunity.files,
    totalLines: opportunity.totalLines,
    relation: Object.fromEntries(
      Object.entries(opportunity.relation).map(([key, value]) => [key, Number(value.toFixed(3))]),
    ),
    topSignals: opportunity.topSignals,
    brief,
    windows: opportunity.windows.slice(0, 10).map(toJsonPocket),
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

function printLudicrousText(result, options) {
  console.log(
    `Ludicrous refactoring opportunity candidates: ${result.files.length} files, ${result.large.length} large pockets, ${result.opportunities.length} candidates`,
  );

  for (const [index, opportunity] of result.opportunities.slice(0, options.top).entries()) {
    console.log(
      `\n${index + 1}. ${opportunity.type} score=${opportunity.score.toFixed(2)} files=${opportunity.files.length} windows=${opportunity.windows.length} lines=${opportunity.totalLines}`,
    );
    console.log(`   signals=${opportunity.topSignals.slice(0, 8).join(", ")}`);
    console.log(
      `   evidence=concept:${opportunity.relation.concept.toFixed(2)} tfidf:${opportunity.relation.cosine.toFixed(2)} clone:${opportunity.relation.clone.toFixed(2)} shape:${opportunity.relation.shape.toFixed(2)} path:${opportunity.relation.path.toFixed(2)}`,
    );
    for (const file of opportunity.files.slice(0, 8)) {
      console.log(`   file=${file}`);
    }
    for (const window of opportunity.windows.slice(0, 5)) {
      console.log(`   pocket=${window.id} terms=${window.topTerms.slice(0, 5).join(", ")}`);
    }
  }
}

function printBriefText(result, options) {
  console.log(
    `Ludicrous campaign briefs: ${result.files.length} files, ${result.large.length} large pockets, ${result.opportunities.length} candidates`,
  );

  for (const [index, opportunity] of result.opportunities.slice(0, options.top).entries()) {
    const brief = opportunityBrief(opportunity);
    console.log(
      `\n${index + 1}. ${brief.title}\n   type=${opportunity.type} score=${opportunity.score.toFixed(2)} files=${opportunity.files.length} lines=${opportunity.totalLines}`,
    );
    console.log(`\n   Current shape\n   ${brief.currentShape}`);
    console.log(`\n   Shy refactor\n   ${brief.shyRefactor}`);
    console.log(`\n   Ludicrous campaign\n   ${brief.ludicrousCampaign}`);
    console.log(`\n   First patch\n   ${brief.firstPatch}`);
    console.log(`\n   Measurement\n   ${brief.measurement}`);
    console.log("\n   Files");
    for (const file of opportunity.files.slice(0, 10)) {
      console.log(`   - ${file}`);
    }
  }
}

function opportunityBrief(opportunity) {
  const signals = opportunity.topSignals.slice(0, 6).join(", ");
  const files = opportunity.files.slice(0, 4).join(", ");
  if (
    opportunity.type === "repeated-parser" ||
    signalsMatch(opportunity, ["char", "quote", "toml", "header", "brace"])
  ) {
    return {
      title: "Shared text-scanning primitives",
      currentShape: `Several pockets repeat quote-aware, escape-aware, delimiter/header scanning across ${files}. Signals: ${signals}.`,
      shyRefactor:
        "Extract one local helper inside one mapper and leave the other scanners untouched.",
      ludicrousCampaign:
        "Create shared source-text scanning primitives, migrate one parser family at a time, and remove local scanner loops when tests prove behavior is preserved.",
      firstPatch:
        "Extract the smallest duplicated scanner primitive with focused tests, then migrate the two most similar call sites.",
      measurement:
        "Rerun --ludicrous-mode and expect this candidate's file count, line count, duplicate phrases, and score to drop.",
    };
  }
  if (opportunity.type === "cli-model") {
    return {
      title: "CLI command metadata as the single source of truth",
      currentShape: `Parsing, help rendering, validation, and tests orbit the same flag vocabulary. Signals: ${signals}.`,
      shyRefactor: "Clean up one parsing helper or one assertion block in the CLI tests.",
      ludicrousCampaign:
        "Turn CommandSpec into a stricter declarative command model used by parsing, help rendering, validation, and metadata tests.",
      firstPatch:
        "Add a normalized command metadata projection and migrate help tests to assert against that projection instead of reparsing prose.",
      measurement:
        "The CLI candidate should shrink because fewer pockets need to restate flag/help/alias semantics.",
    };
  }
  if (opportunity.type === "workflow-state") {
    return {
      title: "Workflow orchestration boundary cleanup",
      currentShape: `Workflow code repeats loaded-path, flag, progress, and patch-attempt vocabulary. Signals: ${signals}.`,
      shyRefactor: "Move one small block out of app.ts or rename a local helper.",
      ludicrousCampaign:
        "Separate workflow policy from CLI flag plumbing, progress emission, and durable state loading.",
      firstPatch:
        "Extract a small workflow input/result model around the repeated loaded-path and flag handling, then migrate one command path.",
      measurement:
        "The workflow candidate should split into smaller, more coherent candidates with less app.ts dominance.",
    };
  }
  if (opportunity.type === "cross-mapper-pattern") {
    return {
      title: "Mapper discovery model consolidation",
      currentShape: `Mapper modules repeat source-root, package-root, grouping, path-safety, and test-association logic. Signals: ${signals}.`,
      shyRefactor: "Tidy one mapper-local helper while preserving the larger repetition.",
      ludicrousCampaign:
        "Extract mapper discovery concepts into shared primitives so new mappers compose source roots, grouping, tests, and trust boundaries consistently.",
      firstPatch:
        "Pick the tightest repeated subproblem in the cluster, extract it with tests, and migrate two mapper families.",
      measurement:
        "The mapper candidate should reduce in related lines and break into narrower domain-specific candidates.",
    };
  }
  return {
    title: "Cross-file refactoring opportunity",
    currentShape: `Related pockets span ${files}. Signals: ${signals}.`,
    shyRefactor: "Apply a local cleanup in one file.",
    ludicrousCampaign:
      "Name the shared concept, introduce a behavior-preserving abstraction boundary, and migrate related pockets in a patch sequence.",
    firstPatch:
      "Add characterization tests around the two most similar pockets and extract the smallest shared primitive.",
    measurement:
      "Rerun --ludicrous-mode and compare score, file count, line count, and duplicate signal terms before and after.",
  };
}

function signalsMatch(opportunity, tokens) {
  const text = opportunity.topSignals.join(" ");
  return tokens.some((token) => text.includes(token));
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
  const opportunities = options.ludicrousMode ? buildLudicrousOpportunities(scoredLarge, idf) : [];
  const result = { root, files, small: scoredSmall, large: scoredLarge, groups, opportunities };

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
          ludicrousOpportunities: opportunities
            .slice(0, options.top)
            .map((opportunity) => toJsonOpportunity(opportunity)),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (options.brief) {
    printBriefText(result, options);
    return;
  }

  if (options.ludicrousMode) {
    printLudicrousText(result, options);
    return;
  }

  printText(result, options);
}

main();
