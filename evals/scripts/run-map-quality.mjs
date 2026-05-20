#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(new URL("../..", import.meta.url).pathname);
const cli = join(repoRoot, "dist", "cli.js");
const args = parseArgs(process.argv.slice(2));
const targetRoot = resolve(args.root ?? repoRoot);
const resultsPath = resolve(
  args.results ??
    process.env["CODENUKE_MAP_QUALITY_RESULTS"] ??
    join(repoRoot, "evals", "results", "map-quality-latest.json"),
);
const codeExtensions = [
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
];

if (!existsSync(cli)) {
  throw new Error("dist/cli.js is missing. Run pnpm build before map-quality eval.");
}

const tmp = mkdtempSync(join(tmpdir(), "codenuke-map-quality-"));
const stateDir = join(tmp, "state");
const startedAt = new Date().toISOString();

try {
  runCli(["--state-dir", stateDir, "init", "--force", "--json"]);
  const firstMap = parseJson(runCli(["--state-dir", stateDir, "map", "--json"]));
  const firstFeatures = readFeatures(stateDir);
  const secondMap = parseJson(runCli(["--state-dir", stateDir, "map", "--json"]));
  const secondFeatures = readFeatures(stateDir);
  const reviewableSourceFiles = collectReviewableSourceFiles(targetRoot);
  const result = mapQualityResult({
    firstMap,
    firstFeatures,
    secondMap,
    secondFeatures,
    reviewableSourceFiles,
  });

  mkdirSync(resolve(resultsPath, ".."), { recursive: true });
  writeFileSync(resultsPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    `map-quality score=${result.score.total.toFixed(1)} features=${result.map.features} sourceCoverage=${(
      result.metrics.sourceCoverageRatio * 100
    ).toFixed(1)}% stable=${result.metrics.featureIdStabilityRatio === 1 ? "yes" : "no"}`,
  );
  console.log(`result: ${resultsPath}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

function mapQualityResult({
  firstMap,
  firstFeatures,
  secondMap,
  secondFeatures,
  reviewableSourceFiles,
}) {
  const firstIds = firstFeatures.map((feature) => feature.featureId).toSorted();
  const secondIds = secondFeatures.map((feature) => feature.featureId).toSorted();
  const stableIds = firstIds.filter((id, index) => secondIds[index] === id).length;
  const featureIdStabilityRatio =
    Math.max(firstIds.length, secondIds.length) === 0
      ? 1
      : stableIds / Math.max(firstIds.length, secondIds.length);
  const ownedPaths = new Set(
    secondFeatures.flatMap((feature) => feature.ownedFiles.map((file) => file.path)),
  );
  const ownedReviewableSourceFiles = reviewableSourceFiles.filter((path) => ownedPaths.has(path));
  const sourceCoverageRatio =
    reviewableSourceFiles.length === 0
      ? 1
      : ownedReviewableSourceFiles.length / reviewableSourceFiles.length;
  const forbiddenOwnedFiles = [...ownedPaths].filter(isForbiddenOwnedPath).toSorted();
  const oversizedFeatures = secondFeatures
    .filter((feature) => feature.ownedFiles.length > 12)
    .map((feature) => ({
      featureId: feature.featureId,
      title: feature.title,
      ownedFiles: feature.ownedFiles.length,
    }));
  const linkedTestRatio =
    secondFeatures.length === 0
      ? 1
      : secondFeatures.filter((feature) => feature.tests.length > 0).length / secondFeatures.length;
  const semanticEvidenceRatio =
    secondFeatures.length === 0
      ? 1
      : secondFeatures.filter((feature) => (feature.semanticEvidence ?? []).length > 0).length /
        secondFeatures.length;
  const semanticEvidenceLinks = secondFeatures.reduce(
    (sum, feature) => sum + (feature.semanticEvidence ?? []).length,
    0,
  );
  const components = {
    featureIdStability: 25 * featureIdStabilityRatio,
    idempotence: secondMap.new === 0 && secondMap.changed === 0 && secondMap.stale === 0 ? 15 : 0,
    sourceCoverage: 25 * Math.min(sourceCoverageRatio / 0.7, 1),
    safeOwnership: forbiddenOwnedFiles.length === 0 ? 15 : 0,
    boundedness:
      10 * Math.max(0, 1 - oversizedFeatures.length / Math.max(secondFeatures.length, 1)),
    linkedTests: 5 * linkedTestRatio,
    semanticEvidence: 5 * Math.min(semanticEvidenceRatio / 0.5, 1),
  };
  const total = Object.values(components).reduce((sum, value) => sum + value, 0);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    startedAt,
    target: {
      root: targetRoot,
    },
    map: {
      features: secondFeatures.length,
      first: pickMapStats(firstMap),
      second: pickMapStats(secondMap),
    },
    score: {
      total,
      components,
    },
    metrics: {
      featureIdStabilityRatio,
      sourceCoverageRatio,
      reviewableSourceFiles: reviewableSourceFiles.length,
      ownedReviewableSourceFiles: ownedReviewableSourceFiles.length,
      forbiddenOwnedFiles,
      oversizedFeatures,
      linkedTestRatio,
      semanticEvidenceRatio,
      semanticEvidenceLinks,
    },
    featureSummary: secondFeatures.map((feature) => ({
      featureId: feature.featureId,
      title: feature.title,
      kind: feature.kind,
      source: feature.source,
      ownedFiles: feature.ownedFiles.length,
      contextFiles: feature.contextFiles.length,
      tests: feature.tests.length,
      tags: feature.tags,
      trustBoundaries: feature.trustBoundaries,
      semanticEvidence: (feature.semanticEvidence ?? []).map((evidence) => ({
        targetFeatureId: evidence.targetFeatureId,
        targetTitle: evidence.targetTitle,
        score: evidence.score,
        signals: evidence.signals,
      })),
    })),
    notes: [
      "This is a v0 map-quality baseline. It intentionally scores durable Feature Slice structure, not provider review output.",
      "Future semantic mapper iterations should improve this score without weakening Feature Slice ID stability or safe ownership.",
    ],
  };
}

function pickMapStats(map) {
  return {
    features: map.features,
    new: map.new,
    changed: map.changed,
    stale: map.stale,
    source: map.source,
    usedAgent: map.usedAgent,
  };
}

function readFeatures(featuresStateDir) {
  const featureDir = join(featuresStateDir, "features");
  if (!existsSync(featureDir)) {
    return [];
  }
  return readdirSync(featureDir)
    .filter((file) => file.endsWith(".json"))
    .toSorted()
    .map((file) => parseJson(readFileSync(join(featureDir, file), "utf8")));
}

function collectReviewableSourceFiles(root) {
  const files = [];
  walk(root, "", files);
  return files.toSorted();
}

function walk(root, prefix, files) {
  const full = join(root, prefix);
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      if (shouldSkipDirectory(relativePath)) {
        continue;
      }
      walk(root, relativePath, files);
      continue;
    }
    if (
      entry.isFile() &&
      isReviewableSourcePath(relativePath) &&
      statSync(join(root, relativePath)).size > 0
    ) {
      files.push(relativePath);
    }
  }
}

function isReviewableSourcePath(path) {
  return (
    (path.startsWith("src/") || path.startsWith("scripts/") || path.startsWith("evals/scripts/")) &&
    codeExtensions.some((extension) => path.endsWith(extension))
  );
}

function shouldSkipDirectory(path) {
  return (
    path === ".git" ||
    path === ".codenuke" ||
    path === "node_modules" ||
    path === "dist" ||
    path === "build" ||
    path === "coverage" ||
    path === ".next" ||
    path === "evals/results" ||
    path.includes("/node_modules/") ||
    path.includes("/dist/") ||
    path.includes("/build/")
  );
}

function isForbiddenOwnedPath(path) {
  return (
    path === ".git" ||
    path === ".codenuke" ||
    path.startsWith(".git/") ||
    path.startsWith(".codenuke/") ||
    path.startsWith("node_modules/") ||
    path.startsWith("dist/") ||
    path.startsWith("build/") ||
    path.startsWith("coverage/") ||
    path.startsWith(".next/")
  );
}

function runCli(commandArgs) {
  return execFileSync(process.execPath, [cli, "--root", targetRoot, ...commandArgs], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CODENUKE_PROVIDER: "mock",
      CODENUKE_CODEX_SKIP_GIT_REPO_CHECK: "1",
      NO_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function parseJson(value) {
  return JSON.parse(value);
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--root") {
      parsed.root = requiredValue(values, index, "--root");
      index += 1;
    } else if (value === "--results") {
      parsed.results = requiredValue(values, index, "--results");
      index += 1;
    } else {
      throw new Error(`unknown argument: ${value}`);
    }
  }
  return parsed;
}

function requiredValue(values, index, flag) {
  const value = values[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`missing value for ${flag}`);
  }
  return value;
}
