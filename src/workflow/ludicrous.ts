import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathExists } from "../platform/fs.js";
import { FeatureRecord } from "../platform/types.js";

export type RefactoringOpportunityCandidate = {
  title: string;
  summary: string;
  score: number;
  signals: string[];
  files: Array<{
    path: string;
    reason: string;
    lines: number;
  }>;
};

type FileProfile = {
  path: string;
  lines: number;
  counts: Map<string, number>;
  phrases: Map<string, number>;
};

const codeExtensions = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".m",
  ".mm",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".swift",
  ".ts",
  ".tsx",
  ".vue",
]);

const stopWords = new Set([
  "and",
  "are",
  "args",
  "async",
  "await",
  "case",
  "class",
  "const",
  "data",
  "default",
  "else",
  "false",
  "file",
  "from",
  "function",
  "import",
  "into",
  "null",
  "path",
  "return",
  "string",
  "true",
  "type",
  "undefined",
  "value",
  "with",
]);

const identifierPattern = /[A-Za-z][A-Za-z0-9_$-]*/gu;
const splitPattern = /[A-Z]?[a-z]+|[A-Z]+(?=[A-Z][a-z]|\d|$)|\d+/gu;

export async function refactoringOpportunityCandidates(
  root: string,
  features: FeatureRecord[],
  options: { limit?: number } = {},
): Promise<RefactoringOpportunityCandidate[]> {
  const profiles = await fileProfiles(root, features);
  if (profiles.length < 2) {
    return [];
  }
  const documentFrequency = tokenDocumentFrequency(profiles);
  const candidateBySignal = new Map<string, RefactoringOpportunityCandidate>();
  for (const [phrase, files] of phraseGroups(profiles)) {
    const scoredFiles = files
      .map((file) => ({
        file,
        count: file.phrases.get(phrase) ?? 0,
        tokenScore: phrase
          .split(" ")
          .reduce((sum, token) => sum + idf(token, documentFrequency, profiles.length), 0),
      }))
      .filter((entry) => entry.count > 0)
      .toSorted((a, b) => b.count * b.tokenScore - a.count * a.tokenScore)
      .slice(0, 8);
    if (scoredFiles.length < 2) {
      continue;
    }
    const score =
      scoredFiles.reduce((sum, entry) => sum + entry.count * entry.tokenScore, 0) +
      Math.log1p(scoredFiles.reduce((sum, entry) => sum + entry.file.lines, 0));
    const signals = [
      phrase,
      ...relatedSignals(
        scoredFiles.map((entry) => entry.file),
        phrase,
      ),
    ];
    candidateBySignal.set(phrase, {
      title: candidateTitle(signals),
      summary: `High-recall cross-file candidate around ${signals.slice(0, 3).join(", ")}.`,
      score,
      signals,
      files: scoredFiles.map((entry) => ({
        path: entry.file.path,
        reason: `${phrase} appears ${entry.count} time(s)`,
        lines: entry.file.lines,
      })),
    });
  }
  return [...candidateBySignal.values()]
    .filter((candidate) => candidate.files.length > 1)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, options.limit ?? 8);
}

export function candidatesForFeature(
  feature: FeatureRecord,
  candidates: RefactoringOpportunityCandidate[],
): RefactoringOpportunityCandidate[] {
  const featurePaths = new Set([
    ...feature.ownedFiles.map((file) => file.path),
    ...feature.contextFiles.map((file) => file.path),
    ...feature.tests.map((test) => test.path),
    ...feature.entrypoints.map((entrypoint) => entrypoint.path),
  ]);
  return candidates
    .filter((candidate) => candidate.files.some((file) => featurePaths.has(file.path)))
    .slice(0, 3);
}

async function fileProfiles(root: string, features: FeatureRecord[]): Promise<FileProfile[]> {
  const featureIdsByPath = new Map<string, Set<string>>();
  for (const feature of features) {
    for (const path of feature.ownedFiles.map((file) => file.path)) {
      if (!isCodePath(path)) {
        continue;
      }
      const featureIds = featureIdsByPath.get(path) ?? new Set<string>();
      featureIds.add(feature.featureId);
      featureIdsByPath.set(path, featureIds);
    }
  }
  const profiles = await Promise.all(
    [...featureIdsByPath.keys()].map(async (path) => {
      if (!(await pathExists(join(root, path)))) {
        return null;
      }
      const source = await readFile(join(root, path), "utf8");
      if (source.includes("\0")) {
        return null;
      }
      const tokens = tokenize(source);
      if (tokens.length < 12) {
        return null;
      }
      return {
        path,
        lines: source.split(/\r?\n/u).length,
        counts: countTokens(tokens),
        phrases: countPhrases(tokens),
      };
    }),
  );
  return profiles.filter((profile): profile is FileProfile => profile !== null);
}

function isCodePath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot !== -1 && codeExtensions.has(path.slice(dot));
}

function tokenize(source: string): string[] {
  const tokens: string[] = [];
  for (const match of source.matchAll(identifierPattern)) {
    tokens.push(...splitIdentifier(match[0]));
  }
  return tokens;
}

function splitIdentifier(raw: string): string[] {
  return raw
    .split(/[_$-]+/u)
    .flatMap((part) => part.match(splitPattern) ?? [])
    .map((part) => part.toLowerCase())
    .filter((part) => part.length > 2 && !/^\d+$/u.test(part) && !stopWords.has(part));
}

function countTokens(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

function countPhrases(tokens: string[]): Map<string, number> {
  const phrases = new Map<string, number>();
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const phrase = `${tokens[index]} ${tokens[index + 1]}`;
    phrases.set(phrase, (phrases.get(phrase) ?? 0) + 1);
  }
  return phrases;
}

function tokenDocumentFrequency(profiles: FileProfile[]): Map<string, number> {
  const frequency = new Map<string, number>();
  for (const profile of profiles) {
    for (const token of profile.counts.keys()) {
      frequency.set(token, (frequency.get(token) ?? 0) + 1);
    }
  }
  return frequency;
}

function phraseGroups(profiles: FileProfile[]): Map<string, FileProfile[]> {
  const groups = new Map<string, FileProfile[]>();
  for (const profile of profiles) {
    for (const [phrase, count] of profile.phrases) {
      if (count < 2) {
        continue;
      }
      const files = groups.get(phrase) ?? [];
      files.push(profile);
      groups.set(phrase, files);
    }
  }
  for (const [phrase, files] of groups) {
    if (files.length < 2) {
      groups.delete(phrase);
    }
  }
  return groups;
}

function idf(token: string, documentFrequency: Map<string, number>, documentCount: number): number {
  const total = Math.max(documentCount, 1);
  const frequency = documentFrequency.get(token) ?? 0;
  return Math.log((1 + total) / (1 + frequency)) + 1;
}

function relatedSignals(files: FileProfile[], primaryPhrase: string): string[] {
  const primaryTokens = new Set(primaryPhrase.split(" "));
  const scores = new Map<string, number>();
  for (const file of files) {
    for (const [token, count] of file.counts) {
      if (primaryTokens.has(token)) {
        continue;
      }
      scores.set(token, (scores.get(token) ?? 0) + Math.log1p(count));
    }
  }
  return [...scores]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([token]) => token);
}

function candidateTitle(signals: string[]): string {
  const label = signals[0] ?? "cross-file refactoring";
  return `Cross-file ${label} candidate`;
}
