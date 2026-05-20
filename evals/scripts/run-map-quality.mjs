#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  cpSync,
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
const mapQualityFixturesRoot = join(repoRoot, "evals", "map-quality");
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
const startedAt = new Date().toISOString();

try {
  const primary = runMapQualityTarget({
    name: "repository",
    root: targetRoot,
    stateDir: join(tmp, "state-repository"),
  });
  const fixtureResults =
    args.root === undefined ? runMapQualityFixtures(tmp, primary.featureSummary) : [];
  const fixtureQuality = fixtureQualityScore(fixtureResults);
  const score = {
    ...primary.score,
    fixtureQuality,
  };
  const decision = mapQualityDecision({
    map: primary.map,
    metrics: primary.metrics,
    fixtureResults,
  });
  const result = {
    ...primary,
    fixtureResults,
    score,
    decision,
  };

  mkdirSync(resolve(resultsPath, ".."), { recursive: true });
  writeFileSync(resultsPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    `map-quality score=${result.score.total.toFixed(1)} features=${result.map.features} sourceCoverage=${(
      result.metrics.sourceCoverageRatio * 100
    ).toFixed(1)}% stable=${
      result.metrics.featureIdStabilityRatio === 1 ? "yes" : "no"
    } fixtureQuality=${result.score.fixtureQuality.toFixed(1)}`,
  );
  console.log(`result: ${resultsPath}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

function runMapQualityTarget({ name, root, stateDir }) {
  runCli(root, ["--state-dir", stateDir, "init", "--force", "--json"]);
  const firstMap = parseJson(runCli(root, ["--state-dir", stateDir, "map", "--json"]));
  const firstFeatures = readFeatures(stateDir);
  const secondMap = parseJson(runCli(root, ["--state-dir", stateDir, "map", "--json"]));
  const secondFeatures = readFeatures(stateDir);
  const reviewableSourceFiles = collectReviewableSourceFiles(root);
  return mapQualityResult({
    name,
    root,
    firstMap,
    firstFeatures,
    secondMap,
    secondFeatures,
    reviewableSourceFiles,
  });
}

function mapQualityResult({
  name,
  root,
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
      name,
      root,
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
      ownedFilePaths: feature.ownedFiles.map((file) => file.path),
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

function runMapQualityFixtures(tmpRoot, repositoryFeatureSummary) {
  if (!existsSync(mapQualityFixturesRoot)) {
    return [];
  }
  return readdirSync(mapQualityFixturesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .toSorted((left, right) => left.name.localeCompare(right.name))
    .map((entry) => runMapQualityFixture(tmpRoot, entry.name, repositoryFeatureSummary));
}

function runMapQualityFixture(tmpRoot, fixtureName, repositoryFeatureSummary) {
  const fixtureRoot = join(mapQualityFixturesRoot, fixtureName);
  const definition = parseJson(readFileSync(join(fixtureRoot, "eval.json"), "utf8"));
  const worktree = join(tmpRoot, `fixture-${fixtureName}`);
  cpSync(join(fixtureRoot, "files"), worktree, { recursive: true });
  const target = runMapQualityTarget({
    name: fixtureName,
    root: worktree,
    stateDir: join(tmpRoot, `state-${fixtureName}`),
  });
  const neighborQuality = semanticNeighborQuality(
    target.featureSummary,
    definition.expectedLinks ?? [],
    definition.forbiddenLinks ?? [],
  );
  return {
    slug: fixtureName,
    name: definition.name ?? fixtureName,
    description: definition.description ?? "",
    ok: neighborQuality.ok,
    map: target.map,
    metrics: {
      featureIdStabilityRatio: target.metrics.featureIdStabilityRatio,
      semanticEvidenceRatio: target.metrics.semanticEvidenceRatio,
      semanticEvidenceLinks: target.metrics.semanticEvidenceLinks,
    },
    neighborQuality,
    repositoryReference: {
      features: repositoryFeatureSummary.length,
    },
  };
}

function semanticNeighborQuality(features, expectedLinks, forbiddenLinks) {
  const expected = expectedLinks.map((link) => evaluateExpectedLink(features, link));
  const forbidden = forbiddenLinks.map((link) => evaluateForbiddenLink(features, link));
  const foundExpected = expected.filter((link) => link.found).length;
  const foundForbidden = forbidden.filter((link) => link.found).length;
  const recall = expected.length === 0 ? 1 : foundExpected / expected.length;
  const falsePositiveRate = forbidden.length === 0 ? 0 : foundForbidden / forbidden.length;
  return {
    ok: expected.every((link) => link.found) && forbidden.every((link) => !link.found),
    recall,
    falsePositiveRate,
    expected,
    forbidden,
  };
}

function evaluateExpectedLink(features, link) {
  const result = featureLink(features, link.leftPath, link.rightPath);
  const signals = result.evidence?.signals ?? [];
  const missingSignals = (link.signals ?? []).filter((signal) => !signals.includes(signal));
  return {
    ...result,
    expectedSignals: link.signals ?? [],
    missingSignals,
    found: result.found && missingSignals.length === 0,
  };
}

function evaluateForbiddenLink(features, link) {
  return featureLink(features, link.leftPath, link.rightPath);
}

function featureLink(features, leftPath, rightPath) {
  const left = featureOwningPath(features, leftPath);
  const right = featureOwningPath(features, rightPath);
  if (left === undefined || right === undefined) {
    return {
      leftPath,
      rightPath,
      leftFeature: left?.title ?? null,
      rightFeature: right?.title ?? null,
      found: false,
      evidence: null,
    };
  }
  const evidence =
    left.semanticEvidence.find((candidate) => candidate.targetFeatureId === right.featureId) ??
    right.semanticEvidence.find((candidate) => candidate.targetFeatureId === left.featureId) ??
    null;
  return {
    leftPath,
    rightPath,
    leftFeature: left.title,
    rightFeature: right.title,
    found: evidence !== null,
    evidence,
  };
}

function featureOwningPath(features, path) {
  return features.find((feature) => feature.ownedFilePaths.includes(path));
}

function fixtureQualityScore(fixtureResults) {
  if (fixtureResults.length === 0) {
    return 0;
  }
  const recall =
    fixtureResults.reduce((sum, result) => sum + result.neighborQuality.recall, 0) /
    fixtureResults.length;
  const falsePositiveRate =
    fixtureResults.reduce((sum, result) => sum + result.neighborQuality.falsePositiveRate, 0) /
    fixtureResults.length;
  return 10 * recall * (1 - falsePositiveRate);
}

function mapQualityDecision({ map, metrics, fixtureResults }) {
  const failedFixtures = fixtureResults.filter((result) => !result.ok);
  const idempotentSecondMap =
    map.second.new === 0 && map.second.changed === 0 && map.second.stale === 0;
  const checks = {
    stableFeatureIds: metrics.featureIdStabilityRatio === 1,
    idempotentSecondMap,
    safeOwnership: metrics.forbiddenOwnedFiles.length === 0,
    fixturesPassed: failedFixtures.length === 0,
  };
  const failures = [];
  if (!checks.stableFeatureIds) {
    failures.push("feature IDs changed between repeated map runs");
  }
  if (!checks.idempotentSecondMap) {
    failures.push("second map run was not idempotent");
  }
  if (!checks.safeOwnership) {
    failures.push(`forbidden files were owned: ${metrics.forbiddenOwnedFiles.join(", ")}`);
  }
  if (!checks.fixturesPassed) {
    failures.push(`fixture failures: ${failedFixtures.map((result) => result.slug).join(", ")}`);
  }

  if (failures.length > 0) {
    return {
      status: "discard",
      reason: failures.join("; "),
      checks,
    };
  }

  return {
    status: "keep",
    reason:
      fixtureResults.length === 0
        ? "stable, idempotent, and safe; no map-quality fixtures were in scope"
        : "stable, idempotent, safe, and all map-quality fixtures passed",
    checks,
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

function runCli(root, commandArgs) {
  return execFileSync(process.execPath, [cli, "--root", root, ...commandArgs], {
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
