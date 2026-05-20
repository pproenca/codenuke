import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { FeatureRecord, FeatureSemanticEvidence } from "../platform/types.js";
import { isSafeFile } from "../mappers/shared.js";

type FeatureDocument = {
  feature: FeatureRecord;
  tokens: Map<string, number>;
};

type WeightedDocument = FeatureDocument & {
  weights: Map<string, number>;
  magnitude: number;
};

const maxFilesPerFeature = 24;
const maxBytesPerFile = 80_000;
const maxEvidencePerFeature = 3;
const minSharedSignals = 2;
const minSimilarityScore = 0.08;

const sourceExtensions = new Set([
  ".c",
  ".cc",
  ".cjs",
  ".cpp",
  ".cs",
  ".cts",
  ".cxx",
  ".go",
  ".h",
  ".hh",
  ".hpp",
  ".hxx",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".m",
  ".mjs",
  ".mm",
  ".mts",
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
  "about",
  "after",
  "all",
  "also",
  "and",
  "any",
  "are",
  "args",
  "array",
  "async",
  "await",
  "boolean",
  "can",
  "catch",
  "class",
  "code",
  "const",
  "current",
  "default",
  "define",
  "does",
  "each",
  "else",
  "enum",
  "error",
  "export",
  "false",
  "file",
  "files",
  "for",
  "from",
  "func",
  "function",
  "has",
  "have",
  "how",
  "import",
  "interface",
  "into",
  "its",
  "let",
  "may",
  "must",
  "new",
  "not",
  "null",
  "number",
  "object",
  "only",
  "path",
  "paths",
  "repo",
  "repository",
  "return",
  "set",
  "should",
  "src",
  "string",
  "that",
  "the",
  "then",
  "this",
  "test",
  "true",
  "type",
  "undefined",
  "use",
  "used",
  "uses",
  "value",
  "void",
  "when",
  "where",
  "why",
  "will",
  "with",
  "without",
  "your",
]);

export async function attachSemanticEvidence(
  root: string,
  features: FeatureRecord[],
): Promise<FeatureRecord[]> {
  if (features.length < 2) {
    return features.map((feature) => ({ ...feature, semanticEvidence: [] }));
  }

  const documents = (
    await Promise.all(features.map((feature) => featureDocument(root, feature)))
  ).filter((document): document is FeatureDocument => document.tokens.size > 0);
  const byFeatureId = new Map(documents.map((document) => [document.feature.featureId, document]));
  const weighted = weightDocuments(documents);
  const evidenceByFeatureId = new Map<string, FeatureSemanticEvidence[]>();

  for (let leftIndex = 0; leftIndex < weighted.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < weighted.length; rightIndex += 1) {
      const left = weighted[leftIndex];
      const right = weighted[rightIndex];
      if (left === undefined || right === undefined) {
        continue;
      }
      const comparison = compareDocuments(left, right);
      if (comparison.score < minSimilarityScore || comparison.signals.length < minSharedSignals) {
        continue;
      }
      pushEvidence(evidenceByFeatureId, left.feature, right.feature, comparison);
      pushEvidence(evidenceByFeatureId, right.feature, left.feature, comparison);
    }
  }

  return features.map((feature) => {
    const evidence = (evidenceByFeatureId.get(feature.featureId) ?? [])
      .toSorted(evidenceRank)
      .slice(0, maxEvidencePerFeature);
    return {
      ...feature,
      semanticEvidence: byFeatureId.has(feature.featureId) ? evidence : [],
    };
  });
}

async function featureDocument(root: string, feature: FeatureRecord): Promise<FeatureDocument> {
  const counts = new Map<string, number>();
  let hasReadableSource = false;
  for (const ref of feature.ownedFiles.slice(0, maxFilesPerFeature)) {
    if (!isSourcePath(ref.path) || !(await isReadableOwnedFile(root, ref.path))) {
      continue;
    }
    hasReadableSource = true;
    addTokens(counts, ref.path);
    const text = await readFile(join(root, ref.path), "utf8").then(
      (contents) => contents.slice(0, maxBytesPerFile),
      () => "",
    );
    addTokens(counts, text);
  }
  if (!hasReadableSource) {
    return { feature, tokens: new Map() };
  }
  addTokens(counts, `${feature.title} ${feature.summary} ${feature.tags.join(" ")}`);
  return { feature, tokens: counts };
}

function weightDocuments(documents: FeatureDocument[]): WeightedDocument[] {
  const documentFrequency = new Map<string, number>();
  for (const document of documents) {
    for (const token of document.tokens.keys()) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  const totalDocuments = documents.length;
  return documents.map((document) => {
    const weights = new Map<string, number>();
    let magnitudeSquared = 0;
    for (const [token, count] of document.tokens) {
      const frequency = documentFrequency.get(token) ?? 0;
      if (totalDocuments >= 4 && frequency / totalDocuments > 0.8) {
        continue;
      }
      const tf = 1 + Math.log(count);
      const idf = Math.log((totalDocuments + 1) / (frequency + 1)) + 1;
      const weight = tf * idf;
      weights.set(token, weight);
      magnitudeSquared += weight * weight;
    }
    return { ...document, weights, magnitude: Math.sqrt(magnitudeSquared) };
  });
}

function compareDocuments(
  left: WeightedDocument,
  right: WeightedDocument,
): { score: number; signals: string[] } {
  if (left.magnitude === 0 || right.magnitude === 0) {
    return { score: 0, signals: [] };
  }
  let dot = 0;
  const shared: Array<{ token: string; weight: number }> = [];
  for (const [token, leftWeight] of left.weights) {
    const rightWeight = right.weights.get(token);
    if (rightWeight === undefined) {
      continue;
    }
    dot += leftWeight * rightWeight;
    shared.push({ token, weight: Math.min(leftWeight, rightWeight) });
  }
  return {
    score: Number((dot / (left.magnitude * right.magnitude)).toFixed(3)),
    signals: shared
      .toSorted((leftSignal, rightSignal) =>
        rightSignal.weight === leftSignal.weight
          ? leftSignal.token.localeCompare(rightSignal.token)
          : rightSignal.weight - leftSignal.weight,
      )
      .slice(0, 8)
      .map((signal) => signal.token),
  };
}

function pushEvidence(
  evidenceByFeatureId: Map<string, FeatureSemanticEvidence[]>,
  feature: FeatureRecord,
  target: FeatureRecord,
  comparison: { score: number; signals: string[] },
): void {
  const evidence = evidenceByFeatureId.get(feature.featureId) ?? [];
  evidence.push({
    kind: "semantic-neighbor",
    source: "identifier-tfidf",
    targetFeatureId: target.featureId,
    targetTitle: target.title,
    score: comparison.score,
    signals: comparison.signals,
    paths: semanticEvidencePaths(feature, target),
    reason: `Shares identifier vocabulary with ${target.title}: ${comparison.signals.join(", ")}`,
  });
  evidenceByFeatureId.set(feature.featureId, evidence);
}

function semanticEvidencePaths(feature: FeatureRecord, target: FeatureRecord): string[] {
  return [
    ...feature.ownedFiles.slice(0, 3).map((file) => file.path),
    ...target.ownedFiles.slice(0, 3).map((file) => file.path),
  ].filter((path, index, paths) => paths.indexOf(path) === index);
}

function evidenceRank(left: FeatureSemanticEvidence, right: FeatureSemanticEvidence): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }
  const title = left.targetTitle.localeCompare(right.targetTitle);
  return title === 0 ? left.targetFeatureId.localeCompare(right.targetFeatureId) : title;
}

function addTokens(counts: Map<string, number>, text: string): void {
  for (const token of identifierTokens(text)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
}

function identifierTokens(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .split(/[^A-Za-z0-9]+/u)
    .map((token) => token.toLowerCase())
    .map(normalizeIdentifierToken)
    .filter((token) => token.length >= 3 && !/^\d+$/u.test(token) && !stopWords.has(token));
}

function normalizeIdentifierToken(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }
  if (
    token.length > 4 &&
    token.endsWith("s") &&
    !token.endsWith("ss") &&
    !token.endsWith("us") &&
    !token.endsWith("is")
  ) {
    return token.slice(0, -1);
  }
  return token;
}

async function isReadableOwnedFile(root: string, path: string): Promise<boolean> {
  if (path.length === 0 || path.includes("\0") || isAbsolute(path)) {
    return false;
  }
  const full = resolve(root, path);
  const relativePath = relative(root, full);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return false;
  }
  return isSafeFile(root, full);
}

function isSourcePath(path: string): boolean {
  return sourceExtensions.has(extname(path).toLowerCase());
}
