#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(new URL("../..", import.meta.url).pathname);
const cli = join(repoRoot, "dist", "cli.js");
const fixturesRoot = join(repoRoot, "evals", "semantic-roi");
const resultsRoot = join(repoRoot, "evals", "results");
const resultsPath = resolve(
  process.env["CODENUKE_SEMANTIC_ROI_RESULTS"] ?? join(resultsRoot, "semantic-roi-latest.json"),
);
const auditPath = resolve(
  process.env["CODENUKE_SEMANTIC_ROI_AUDIT"] ?? join(resultsRoot, "semantic-roi-latest.md"),
);

if (!existsSync(cli)) {
  throw new Error("dist/cli.js is missing. Run pnpm build before semantic ROI eval.");
}

const startedAt = new Date().toISOString();
const tmp = mkdtempSync(join(tmpdir(), "codenuke-semantic-roi-"));
const fixtureNames = readdirSync(fixturesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .toSorted();
const fixtureDefinitions = fixtureNames.map((name) => readFixtureDefinition(name));
const protectedBefore = protectedSnapshot(fixtureDefinitions);

try {
  const results = fixtureDefinitions.map((fixture) => runRoiFixture(fixture));
  const protectedAfter = protectedSnapshot(fixtureDefinitions);
  const mutationFailures = protectedMutationFailures(protectedBefore, protectedAfter);
  const aggregate = aggregateResults(results);
  const hardConstraintFailures = [
    ...mutationFailures,
    ...results.flatMap((result) => result.hardConstraintFailures),
  ];
  const decision = semanticRoiDecision({
    aggregate,
    hardConstraintFailures,
    results,
  });
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    startedAt,
    cli: "node dist/cli.js",
    mode: {
      deterministic: true,
      modelBacked: false,
      provider: "mock",
    },
    sealedEvaluator: {
      protectedFiles: protectedBefore.size,
      mutationFailures,
    },
    aggregate,
    decision,
    audit: {
      provenBehavior: [
        "The deterministic harness runs the same fixture with semantic evidence disabled and enabled.",
        "The control run exposes no semantic-neighbor links and produces no finding.",
        "The treatment run exposes semantic-neighbor links and produces a traced Refactoring Finding.",
        "The run records hard constraint failures separately from quality metrics.",
      ],
      proxyEvidence: [],
      unprovenModelBackedRoi: [
        "Live model-backed ROI remains out of scope for this deterministic command.",
      ],
      blockers: decision.status === "keep" ? [] : decision.failures,
      nextInputs:
        decision.status === "keep"
          ? ["Add fix/revalidation ROI fixtures before claiming full fix-quality coverage."]
          : ["Inspect failed hard constraints or fixture deltas before changing implementation."],
    },
    results,
  };

  mkdirSync(dirname(resultsPath), { recursive: true });
  writeFileSync(resultsPath, `${JSON.stringify(output, null, 2)}\n`);
  writeFileSync(auditPath, semanticRoiMarkdown(output));
  console.log(
    `semantic-roi decision=${decision.status} scoreDelta=${aggregate.scoreDelta.toFixed(
      1,
    )} fixtures=${results.length}`,
  );
  console.log(`result: ${resultsPath}`);
  console.log(`audit: ${auditPath}`);
  if (decision.status !== "keep") {
    process.exitCode = 1;
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

function readFixtureDefinition(name) {
  const root = join(fixturesRoot, name);
  const definition = readJson(join(root, "eval.json"));
  const filesRoot = resolve(root, definition.files ?? "files");
  return {
    root,
    filesRoot,
    slug: definition.slug ?? name,
    name: definition.name ?? name,
    description: definition.description ?? "",
    review: definition.review ?? {},
    expect: definition.expect ?? {},
  };
}

function runRoiFixture(fixture) {
  const control = runObservation(fixture, "control", false);
  const treatment = runObservation(fixture, "treatment", true);
  const controlScore = scoreObservation(control, fixture.expect.control ?? {}, "control");
  const treatmentScore = scoreObservation(treatment, fixture.expect.treatment ?? {}, "treatment");
  const hardConstraintFailures = [
    ...controlScore.hardConstraintFailures,
    ...treatmentScore.hardConstraintFailures,
  ].map((failure) => `${fixture.slug}: ${failure}`);
  return {
    schemaVersion: 1,
    slug: fixture.slug,
    name: fixture.name,
    description: fixture.description,
    control,
    treatment,
    scores: {
      control: controlScore,
      treatment: treatmentScore,
      delta: treatmentScore.score - controlScore.score,
    },
    hardConstraintFailures,
    ok: hardConstraintFailures.length === 0 && treatmentScore.score > controlScore.score,
  };
}

function runObservation(fixture, label, semanticEvidence) {
  const worktree = join(tmp, `${fixture.slug}-${label}`);
  cpSync(fixture.filesRoot, worktree, { recursive: true });
  const provider = fixture.review.provider ?? "mock";
  const limit = String(fixture.review.limit ?? 1);
  runCli(worktree, ["init", "--force", "--json"], semanticEvidence);
  const map = parseJson(runCli(worktree, ["map", "--json"], semanticEvidence));
  const features = readStateRecords(worktree, "features");
  const semanticEvidenceLinks = features.reduce(
    (total, feature) => total + (feature.semanticEvidence ?? []).length,
    0,
  );
  const review = parseJson(
    runCli(
      worktree,
      ["review", "--provider", provider, "--limit", limit, "--json"],
      semanticEvidence,
    ),
  );
  const report = parseJson(runCli(worktree, ["report", "--status", "open", "--json"], true));
  return {
    label,
    semanticEvidence,
    map: {
      features: map.features,
      source: map.source,
      usedAgent: map.usedAgent,
      semanticEvidenceLinks,
    },
    review: {
      reviewed: review.reviewed,
      findings: review.findings,
    },
    report: {
      findings: report.findings,
      items: normalizeItems(report.items ?? []),
    },
  };
}

function scoreObservation(observation, expectation, label) {
  const errors = [];
  const hardConstraintFailures = [];
  if (
    typeof expectation.openFindings === "number" &&
    observation.report.findings !== expectation.openFindings
  ) {
    errors.push(
      `expected ${label} ${expectation.openFindings} open finding(s), got ${observation.report.findings}`,
    );
  }
  if (
    typeof expectation.semanticEvidenceLinks === "number" &&
    observation.map.semanticEvidenceLinks !== expectation.semanticEvidenceLinks
  ) {
    hardConstraintFailures.push(
      `expected ${label} ${expectation.semanticEvidenceLinks} semantic evidence link(s), got ${observation.map.semanticEvidenceLinks}`,
    );
  }
  if (
    typeof expectation.semanticEvidenceLinksMin === "number" &&
    observation.map.semanticEvidenceLinks < expectation.semanticEvidenceLinksMin
  ) {
    errors.push(
      `expected ${label} at least ${expectation.semanticEvidenceLinksMin} semantic evidence link(s), got ${observation.map.semanticEvidenceLinks}`,
    );
  }
  let matchedFindings = 0;
  for (const expected of expectation.findings ?? []) {
    const match = observation.report.items.find((item) => matchesFinding(item, expected));
    if (match === undefined) {
      errors.push(`missing expected ${label} finding ${JSON.stringify(expected)}`);
      continue;
    }
    matchedFindings += 1;
  }
  const expectedFindings = expectation.findings?.length ?? 0;
  const extraFindings = Math.max(0, observation.report.items.length - expectedFindings);
  const recall = expectedFindings === 0 ? 0 : matchedFindings / expectedFindings;
  const traceCredit =
    expectedFindings === 0
      ? 0
      : observation.report.items.some((item) => item.mapEvidenceTrace.length > 0)
        ? 1
        : 0;
  const falsePositivePenalty = Math.min(extraFindings * 25, 50);
  const score =
    expectedFindings === 0
      ? Math.max(0, observation.report.findings === 0 ? 10 : 0)
      : Math.max(0, 70 * recall + 30 * traceCredit - falsePositivePenalty);
  return {
    score,
    recall,
    traceCredit,
    extraFindings,
    errors,
    hardConstraintFailures,
    ok: errors.length === 0 && hardConstraintFailures.length === 0,
  };
}

function aggregateResults(results) {
  const controlScore = sum(results, (result) => result.scores.control.score);
  const treatmentScore = sum(results, (result) => result.scores.treatment.score);
  return {
    fixtures: results.length,
    passed: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    controlScore,
    treatmentScore,
    scoreDelta: treatmentScore - controlScore,
    semanticEvidenceLinks: {
      control: sum(results, (result) => result.control.map.semanticEvidenceLinks),
      treatment: sum(results, (result) => result.treatment.map.semanticEvidenceLinks),
    },
    findings: {
      control: sum(results, (result) => result.control.report.findings),
      treatment: sum(results, (result) => result.treatment.report.findings),
    },
  };
}

function semanticRoiDecision({ aggregate, hardConstraintFailures, results }) {
  const failures = [
    ...hardConstraintFailures,
    ...results.flatMap((result) => [
      ...result.scores.control.errors.map((error) => `${result.slug}: ${error}`),
      ...result.scores.treatment.errors.map((error) => `${result.slug}: ${error}`),
    ]),
  ];
  if (failures.length > 0) {
    return {
      status: "discard",
      reason: failures.join("; "),
      failures,
    };
  }
  if (aggregate.scoreDelta <= 0) {
    return {
      status: "discard",
      reason: `treatment did not beat control: delta ${aggregate.scoreDelta.toFixed(1)}`,
      failures: [`treatment did not beat control: delta ${aggregate.scoreDelta.toFixed(1)}`],
    };
  }
  return {
    status: "keep",
    reason: `treatment beat control by ${aggregate.scoreDelta.toFixed(1)} point(s) with no hard constraint failures`,
    failures: [],
  };
}

function protectedSnapshot(fixtures) {
  const paths = new Set(["package.json", "evals/scripts/run-semantic-roi.mjs", "pnpm-lock.yaml"]);
  for (const fixture of fixtures) {
    addRelativeFiles(paths, fixture.root);
    addRelativeFiles(paths, fixture.filesRoot);
  }
  addMatchingFiles(paths, "src", (path) => /(^|\/)[^/]+\.test\.[cm]?[tj]sx?$/u.test(path));
  addRelativeFiles(paths, join(repoRoot, ".scratch"));
  addRelativeFiles(paths, join(repoRoot, ".agents"));
  addRelativeFiles(paths, join(repoRoot, "dist"));
  const snapshot = new Map();
  for (const relativePath of [...paths].toSorted()) {
    const fullPath = join(repoRoot, relativePath);
    if (existsSync(fullPath) && statSync(fullPath).isFile()) {
      snapshot.set(relativePath, hashFile(fullPath));
    }
  }
  return snapshot;
}

function protectedMutationFailures(before, after) {
  const paths = [...new Set([...before.keys(), ...after.keys()])].toSorted();
  return paths
    .filter((path) => before.get(path) !== after.get(path))
    .map((path) => `protected file changed during semantic ROI eval: ${path}`);
}

function addRelativeFiles(paths, root) {
  if (!existsSync(root)) {
    return;
  }
  walkFiles(root, (file) => {
    const relativePath = relativeRepoPath(file);
    if (!relativePath.startsWith("evals/results/")) {
      paths.add(relativePath);
    }
  });
}

function addMatchingFiles(paths, rootName, predicate) {
  const root = join(repoRoot, rootName);
  if (!existsSync(root)) {
    return;
  }
  walkFiles(root, (file) => {
    const relativePath = relativeRepoPath(file);
    if (predicate(relativePath)) {
      paths.add(relativePath);
    }
  });
}

function walkFiles(root, onFile) {
  const info = statSync(root);
  if (info.isFile()) {
    onFile(root);
    return;
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") {
        continue;
      }
      walkFiles(fullPath, onFile);
    } else if (entry.isFile()) {
      onFile(fullPath);
    }
  }
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function relativeRepoPath(path) {
  return path.slice(repoRoot.length + 1).replace(/\\/gu, "/");
}

function runCli(root, args, semanticEvidence) {
  return execFileSync(process.execPath, [cli, "--root", root, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CODENUKE_PROVIDER: "mock",
      CODENUKE_CODEX_SKIP_GIT_REPO_CHECK: "1",
      CODENUKE_SEMANTIC_EVIDENCE: semanticEvidence ? "1" : "0",
      NO_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function readStateRecords(worktree, name) {
  const dir = join(worktree, ".codenuke", name);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .toSorted()
    .map((file) => readJson(join(dir, file)));
}

function matchesFinding(item, expected) {
  if (expected.title !== undefined && item.title !== expected.title) {
    return false;
  }
  if (expected.category !== undefined && item.category !== expected.category) {
    return false;
  }
  if (expected.severity !== undefined && item.severity !== expected.severity) {
    return false;
  }
  if (expected.confidence !== undefined && item.confidence !== expected.confidence) {
    return false;
  }
  if (expected.evidencePath !== undefined) {
    const evidence = Array.isArray(item.evidence) ? item.evidence : [];
    if (!evidence.some((entry) => entry.path === expected.evidencePath)) {
      return false;
    }
  }
  const mapEvidenceTrace = Array.isArray(item.mapEvidenceTrace) ? item.mapEvidenceTrace : [];
  if (expected.mapEvidenceTrace === true && mapEvidenceTrace.length === 0) {
    return false;
  }
  if (
    expected.mapEvidenceTraceKind !== undefined &&
    !mapEvidenceTrace.some((entry) => entry.kind === expected.mapEvidenceTraceKind)
  ) {
    return false;
  }
  if (
    expected.mapEvidenceTraceTargetTitle !== undefined &&
    !mapEvidenceTrace.some((entry) => entry.targetTitle === expected.mapEvidenceTraceTargetTitle)
  ) {
    return false;
  }
  if (
    expected.mapEvidenceTraceSignal !== undefined &&
    !mapEvidenceTrace.some((entry) =>
      (entry.signals ?? []).includes(expected.mapEvidenceTraceSignal),
    )
  ) {
    return false;
  }
  return true;
}

function normalizeItems(items) {
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    category: item.category,
    severity: item.severity,
    confidence: item.confidence,
    status: item.status,
    evidence: Array.isArray(item.evidence)
      ? item.evidence.map((entry) => ({
          path: entry.path,
          startLine: entry.startLine ?? null,
          endLine: entry.endLine ?? null,
          symbol: entry.symbol ?? null,
        }))
      : [],
    mapEvidenceTrace: Array.isArray(item.mapEvidenceTrace)
      ? item.mapEvidenceTrace.map((entry) => ({
          kind: entry.kind,
          source: entry.source,
          targetTitle: entry.targetTitle,
          signals: entry.signals ?? [],
        }))
      : [],
  }));
}

function semanticRoiMarkdown(output) {
  const lines = [
    "# Semantic ROI Autoresearch Audit",
    "",
    `decision: ${output.decision.status}`,
    `reason: ${output.decision.reason}`,
    `score delta: ${output.aggregate.scoreDelta.toFixed(1)}`,
    "",
    "## Proven Behavior",
    ...output.audit.provenBehavior.map((entry) => `- ${entry}`),
    "",
    "## Proxy Evidence",
    ...(output.audit.proxyEvidence.length === 0
      ? ["- none"]
      : output.audit.proxyEvidence.map((entry) => `- ${entry}`)),
    "",
    "## Unproven Model-backed ROI",
    ...output.audit.unprovenModelBackedRoi.map((entry) => `- ${entry}`),
    "",
    "## Blockers",
    ...(output.audit.blockers.length === 0
      ? ["- none"]
      : output.audit.blockers.map((entry) => `- ${entry}`)),
    "",
    "## Next Inputs",
    ...output.audit.nextInputs.map((entry) => `- ${entry}`),
    "",
    "## Fixtures",
  ];
  for (const result of output.results) {
    lines.push(
      "",
      `### ${result.slug}`,
      `- control findings: ${result.control.report.findings}`,
      `- treatment findings: ${result.treatment.report.findings}`,
      `- control semantic links: ${result.control.map.semanticEvidenceLinks}`,
      `- treatment semantic links: ${result.treatment.map.semanticEvidenceLinks}`,
      `- score delta: ${result.scores.delta.toFixed(1)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function readJson(path) {
  return parseJson(readFileSync(path, "utf8"));
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to parse JSON: ${message}\n${text}`, { cause: error });
  }
}

function sum(items, value) {
  return items.reduce((total, item) => total + value(item), 0);
}
