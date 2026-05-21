#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
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
const ledgerPath = resolve(
  process.env["CODENUKE_SEMANTIC_ROI_LEDGER"] ?? join(resultsRoot, "semantic-roi-ledger.jsonl"),
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
    ledger: {
      path: ledgerPath,
      appendOnly: true,
    },
    aggregate,
    decision,
    audit: {
      provenBehavior: [
        "The deterministic harness runs the same fixture with semantic evidence disabled and enabled.",
        "The control run exposes no semantic-neighbor links and produces no finding.",
        "The treatment run exposes semantic-neighbor links and produces a traced Refactoring Finding.",
        "Treatment fixtures can run fix and revalidate through the normal CLI while rejecting test mutation.",
        "Constraint fixtures run sealed behavior invariants before measuring future-change cost.",
        "Future-change probes measure whether treatment reduces touch points versus control.",
        "The run records hard constraint failures separately from quality metrics.",
      ],
      proxyEvidence: [],
      unprovenModelBackedRoi: [
        "Live model-backed ROI remains out of scope for this deterministic command.",
      ],
      blockers: decision.status === "keep" ? [] : decision.failures,
      nextInputs:
        decision.status === "keep"
          ? [
              "Expand the sealed constraint corpus and add optional model-backed repeated samples before claiming live-provider ROI.",
            ]
          : ["Inspect failed hard constraints or fixture deltas before changing implementation."],
    },
    results,
  };

  mkdirSync(dirname(resultsPath), { recursive: true });
  writeFileSync(resultsPath, `${JSON.stringify(output, null, 2)}\n`);
  writeFileSync(auditPath, semanticRoiMarkdown(output));
  appendFileSync(ledgerPath, `${JSON.stringify(semanticRoiLedgerRecord(output))}\n`);
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
    constraint: definition.constraint ?? null,
    behaviorInvariants: definition.behaviorInvariants ?? [],
    expectedTransformation: definition.expectedTransformation ?? null,
    futureChangeProbe: definition.futureChangeProbe ?? null,
    review: definition.review ?? {},
    fix: definition.fix ?? {},
    revalidate: definition.revalidate ?? {},
    expect: definition.expect ?? {},
  };
}

function runRoiFixture(fixture) {
  const control = runObservation(fixture, "control", false);
  const treatment = runObservation(fixture, "treatment", true);
  const controlScore = scoreObservation(control, fixture.expect.control ?? {}, "control");
  const treatmentScore = scoreObservation(treatment, fixture.expect.treatment ?? {}, "treatment");
  const constraint = constraintResult(fixture, control, treatment);
  const futureChange = futureChangeComparison(fixture, control, treatment);
  const hardConstraintFailures = [
    ...controlScore.hardConstraintFailures,
    ...treatmentScore.hardConstraintFailures,
    ...futureChange.hardConstraintFailures,
  ].map((failure) => `${fixture.slug}: ${failure}`);
  const scoreDelta = treatmentScore.score - controlScore.score;
  const positiveRoiFixture = (fixture.expect.treatment?.findings ?? []).length > 0;
  const fixtureScoreOk = positiveRoiFixture ? scoreDelta > 0 : scoreDelta >= 0;
  return {
    schemaVersion: 1,
    slug: fixture.slug,
    name: fixture.name,
    description: fixture.description,
    constraint,
    expectedTransformation: fixture.expectedTransformation,
    control,
    treatment,
    futureChange,
    scores: {
      control: controlScore,
      treatment: treatmentScore,
      delta: scoreDelta,
    },
    hardConstraintFailures,
    ok: hardConstraintFailures.length === 0 && futureChange.ok && fixtureScoreOk,
  };
}

function runObservation(fixture, label, semanticEvidence) {
  const worktree = join(tmp, `${fixture.slug}-${label}`);
  cpSync(fixture.filesRoot, worktree, { recursive: true });
  const provider = fixture.review.provider ?? "mock";
  const limit = String(fixture.review.limit ?? 1);
  if (fixture.fix.enabled === true) {
    initGitWorktree(worktree);
  }
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
  const report = parseJson(
    runCli(worktree, ["report", "--status", "open", "--json"], semanticEvidence),
  );
  const fix = runFixStep(worktree, provider, fixture, report, semanticEvidence);
  const revalidate = runRevalidateStep(
    worktree,
    provider,
    fixture,
    fix?.findingId ?? null,
    semanticEvidence,
  );
  const finalReport =
    fix === null && revalidate === null
      ? report
      : parseJson(runCli(worktree, ["report", "--json"], semanticEvidence));
  const behaviorInvariants = runBehaviorInvariants(worktree, fixture.behaviorInvariants);
  const futureChangeProbe = runFutureChangeProbe(worktree, fixture.futureChangeProbe);
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
    finalReport: {
      findings: finalReport.findings,
      items: normalizeItems(finalReport.items ?? []),
    },
    fix,
    revalidate,
    behaviorInvariants,
    futureChangeProbe,
  };
}

function runFixStep(worktree, provider, fixture, report, semanticEvidence) {
  if (fixture.fix.enabled !== true) {
    return null;
  }
  const finding = selectFinding(report.items ?? [], fixture.fix);
  if (finding === null) {
    return null;
  }
  try {
    const fixOutput = parseJson(
      runCli(
        worktree,
        [
          "fix",
          "--provider",
          provider,
          "--finding",
          finding.id,
          ...modelArgs(fixture.fix),
          "--json",
        ],
        semanticEvidence,
      ),
    );
    return {
      findingId: finding.id,
      status: fixOutput.status,
      patchAttempt: fixOutput.patchAttempt,
      filesChanged: fixOutput.filesChanged,
      changedFiles: changedFilesList(fixOutput.changedFiles),
      commands: fixOutput.commands,
      validation: fixOutput.validation,
      error: null,
      files: snapshotFixtureFiles(worktree),
    };
  } catch (error) {
    return {
      findingId: finding.id,
      status: "failed",
      patchAttempt: null,
      filesChanged: 0,
      changedFiles: [],
      commands: 0,
      validation: "failed",
      error: error instanceof Error ? error.message : String(error),
      files: snapshotFixtureFiles(worktree),
    };
  }
}

function runRevalidateStep(worktree, provider, fixture, findingId, semanticEvidence) {
  if (fixture.revalidate.enabled !== true || findingId === null) {
    return null;
  }
  try {
    const revalidateOutput = parseJson(
      runCli(
        worktree,
        [
          "revalidate",
          "--provider",
          provider,
          "--finding",
          findingId,
          ...modelArgs(fixture.revalidate),
          "--json",
        ],
        semanticEvidence,
      ),
    );
    return {
      findingId,
      outcome: revalidateOutput.outcome,
      reasoning: revalidateOutput.reasoning,
      error: null,
    };
  } catch (error) {
    return {
      findingId,
      outcome: "error",
      reasoning: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
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
  const reviewScore =
    expectedFindings === 0
      ? Math.max(0, observation.report.findings === 0 ? 10 : 0)
      : Math.max(0, 70 * recall + 30 * traceCredit - falsePositivePenalty);
  const fixScore = scoreFix(
    observation,
    expectation.fix ?? null,
    label,
    errors,
    hardConstraintFailures,
  );
  const revalidationScore = scoreRevalidation(
    observation,
    expectation.revalidate ?? null,
    label,
    errors,
  );
  const invariantScore = scoreBehaviorInvariants(observation, label, hardConstraintFailures);
  const constraintScore = scoreConstraintIdentification(
    expectation.constraint ?? null,
    matchedFindings,
    label,
    errors,
  );
  const futureChangeScore = scoreFutureChangeProbe(
    observation,
    expectation.futureChangeProbe ?? null,
    label,
    errors,
    hardConstraintFailures,
  );
  const score =
    reviewScore +
    fixScore +
    revalidationScore +
    invariantScore +
    constraintScore +
    futureChangeScore;
  return {
    score,
    reviewScore,
    fixScore,
    revalidationScore,
    invariantScore,
    constraintScore,
    futureChangeScore,
    recall,
    traceCredit,
    extraFindings,
    errors,
    hardConstraintFailures,
    ok: errors.length === 0 && hardConstraintFailures.length === 0,
  };
}

function scoreBehaviorInvariants(observation, label, hardConstraintFailures) {
  if (observation.behaviorInvariants.length === 0) {
    return 0;
  }
  const failures = observation.behaviorInvariants.filter((invariant) => !invariant.ok);
  for (const failure of failures) {
    hardConstraintFailures.push(
      `${label} behavior invariant failed: ${failure.name}: ${failure.error}`,
    );
  }
  return failures.length === 0 ? 30 : 0;
}

function scoreConstraintIdentification(expectation, matchedFindings, label, errors) {
  if (expectation === null) {
    return 0;
  }
  const identified = matchedFindings > 0;
  if (typeof expectation.identified === "boolean" && identified !== expectation.identified) {
    errors.push(
      `expected ${label} constraint identified=${expectation.identified}, got ${identified}`,
    );
  }
  return identified ? 30 : 0;
}

function scoreFix(observation, expectation, label, errors, hardConstraintFailures) {
  if (observation.fix !== null) {
    const changedTests = observation.fix.changedFiles.filter(isTestPath);
    if (changedTests.length > 0) {
      hardConstraintFailures.push(
        `${label} fix changed test file(s) during sealed ROI run: ${changedTests.join(", ")}`,
      );
    }
  }
  if (expectation === null) {
    return 0;
  }
  if (observation.fix === null) {
    errors.push(`expected ${label} fix, got none`);
    return 0;
  }
  if (expectation.status !== undefined && observation.fix.status !== expectation.status) {
    errors.push(
      `expected ${label} fix status ${expectation.status}, got ${observation.fix.status}`,
    );
  }
  if (Array.isArray(expectation.changedFiles)) {
    const expected = expectation.changedFiles.toSorted();
    const actual = observation.fix.changedFiles.toSorted();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      errors.push(
        `expected ${label} changed files ${expected.join(", ")}, got ${actual.join(", ")}`,
      );
    }
  }
  if (
    typeof expectation.maxChangedFiles === "number" &&
    observation.fix.changedFiles.length > expectation.maxChangedFiles
  ) {
    errors.push(
      `expected ${label} at most ${expectation.maxChangedFiles} changed file(s), got ${observation.fix.changedFiles.length}`,
    );
  }
  for (const check of expectation.requiredText ?? []) {
    const content = observation.fix.files[check.path] ?? "";
    if (!content.includes(check.text)) {
      errors.push(`expected ${label} ${check.path} to contain ${JSON.stringify(check.text)}`);
    }
  }
  for (const check of expectation.forbiddenText ?? []) {
    const content = observation.fix.files[check.path] ?? "";
    if (content.includes(check.text)) {
      errors.push(`expected ${label} ${check.path} not to contain ${JSON.stringify(check.text)}`);
    }
  }
  return errors.length === 0 ? 40 : 0;
}

function scoreRevalidation(observation, expectation, label, errors) {
  if (expectation === null) {
    return 0;
  }
  if (observation.revalidate === null) {
    errors.push(`expected ${label} revalidation, got none`);
    return 0;
  }
  if (expectation.outcome !== undefined && observation.revalidate.outcome !== expectation.outcome) {
    errors.push(
      `expected ${label} revalidation outcome ${expectation.outcome}, got ${observation.revalidate.outcome}`,
    );
  }
  return errors.length === 0 ? 20 : 0;
}

function scoreFutureChangeProbe(observation, expectation, label, errors, hardConstraintFailures) {
  if (observation.futureChangeProbe !== null) {
    const changedTests = observation.futureChangeProbe.changedFiles.filter(isTestPath);
    if (changedTests.length > 0) {
      hardConstraintFailures.push(
        `${label} future-change probe changed test file(s): ${changedTests.join(", ")}`,
      );
    }
    for (const validation of observation.futureChangeProbe.validation) {
      if (!validation.ok) {
        hardConstraintFailures.push(
          `${label} future-change validation failed: ${validation.name}: ${validation.error}`,
        );
      }
    }
  }
  if (expectation === null) {
    return 0;
  }
  if (observation.futureChangeProbe === null) {
    errors.push(`expected ${label} future-change probe, got none`);
    return 0;
  }
  const touchPoints = observation.futureChangeProbe.touchPoints;
  if (typeof expectation.touchPoints === "number" && touchPoints !== expectation.touchPoints) {
    errors.push(
      `expected ${label} future-change touch points ${expectation.touchPoints}, got ${touchPoints}`,
    );
  }
  if (typeof expectation.touchPointsMax === "number" && touchPoints > expectation.touchPointsMax) {
    errors.push(
      `expected ${label} future-change touch points <= ${expectation.touchPointsMax}, got ${touchPoints}`,
    );
  }
  if (
    typeof expectation.validationPassed === "boolean" &&
    observation.futureChangeProbe.validationPassed !== expectation.validationPassed
  ) {
    errors.push(
      `expected ${label} future-change validationPassed=${expectation.validationPassed}, got ${observation.futureChangeProbe.validationPassed}`,
    );
  }
  return errors.length === 0 ? 40 : 0;
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
    fixRuns: {
      control: results.filter((result) => result.control.fix !== null).length,
      treatment: results.filter((result) => result.treatment.fix !== null).length,
    },
    revalidationRuns: {
      control: results.filter((result) => result.control.revalidate !== null).length,
      treatment: results.filter((result) => result.treatment.revalidate !== null).length,
    },
    behaviorInvariants: {
      fixtures: results.filter((result) => result.control.behaviorInvariants.length > 0).length,
      controlPassed: results.filter(
        (result) =>
          result.control.behaviorInvariants.length > 0 &&
          result.control.behaviorInvariants.every((invariant) => invariant.ok),
      ).length,
      treatmentPassed: results.filter(
        (result) =>
          result.treatment.behaviorInvariants.length > 0 &&
          result.treatment.behaviorInvariants.every((invariant) => invariant.ok),
      ).length,
    },
    futureChange: {
      fixtures: results.filter((result) => result.futureChange.enabled).length,
      controlTouchPoints: sum(
        results,
        (result) => result.control.futureChangeProbe?.touchPoints ?? 0,
      ),
      treatmentTouchPoints: sum(
        results,
        (result) => result.treatment.futureChangeProbe?.touchPoints ?? 0,
      ),
      touchPointReduction: sum(results, (result) => result.futureChange.touchPointReduction ?? 0),
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

function selectFinding(items, fixDefinition) {
  if (fixDefinition.findingTitle !== undefined) {
    return items.find((item) => item.title === fixDefinition.findingTitle) ?? null;
  }
  if (fixDefinition.findingId !== undefined) {
    return items.find((item) => item.id === fixDefinition.findingId) ?? null;
  }
  return items[0] ?? null;
}

function initGitWorktree(root) {
  execFileSync("git", ["init"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  execFileSync("git", ["add", "."], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=codenuke eval",
      "-c",
      "user.email=eval@example.invalid",
      "commit",
      "-m",
      "fixture baseline",
    ],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

function modelArgs(config) {
  return [
    ...(typeof config?.model === "string" ? ["--model", config.model] : []),
    ...(typeof config?.reasoningEffort === "string"
      ? ["--reasoning-effort", config.reasoningEffort]
      : []),
  ];
}

function changedFilesList(value) {
  if (typeof value !== "string" || value === "none") {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .toSorted();
}

function snapshotFixtureFiles(root) {
  const files = {};
  walkFiles(root, (file) => {
    const relativePath = file.slice(root.length + 1).replace(/\\/gu, "/");
    if (relativePath.startsWith(".git/") || relativePath.startsWith(".codenuke/")) {
      return;
    }
    files[relativePath] = readFileSync(file, "utf8");
  });
  return files;
}

function isTestPath(path) {
  return /(^|\/)(test|tests|__tests__)(\/|$)|(?:^|[._-])(?:test|spec)\.[^/]+$/iu.test(path);
}

function constraintResult(fixture, control, treatment) {
  if (fixture.constraint === null) {
    return { enabled: false };
  }
  return {
    enabled: true,
    id: fixture.constraint.id ?? null,
    type: fixture.constraint.type ?? null,
    description: fixture.constraint.description ?? "",
    evidencePaths: fixture.constraint.evidencePaths ?? [],
    controlIdentified: observationIdentifiesConstraint(control, fixture),
    treatmentIdentified: observationIdentifiesConstraint(treatment, fixture),
  };
}

function observationIdentifiesConstraint(observation, fixture) {
  const expectedFindings = fixture.expect.treatment?.findings ?? [];
  if (expectedFindings.length > 0) {
    return expectedFindings.some((expected) =>
      observation.report.items.some((item) => matchesFinding(item, expected)),
    );
  }
  return observation.report.items.length > 0;
}

function futureChangeComparison(fixture, control, treatment) {
  if (fixture.futureChangeProbe === null) {
    return { enabled: false, ok: true, hardConstraintFailures: [] };
  }
  const failures = [];
  const controlTouchPoints = control.futureChangeProbe?.touchPoints ?? null;
  const treatmentTouchPoints = treatment.futureChangeProbe?.touchPoints ?? null;
  const touchPointReduction =
    controlTouchPoints === null || treatmentTouchPoints === null
      ? null
      : controlTouchPoints - treatmentTouchPoints;
  const expectedReduction = fixture.futureChangeProbe.expect?.touchPointReductionMin ?? 0;
  if (touchPointReduction === null) {
    failures.push("future-change probe did not run for both control and treatment");
  } else if (touchPointReduction < expectedReduction) {
    failures.push(
      `expected future-change touch point reduction >= ${expectedReduction}, got ${touchPointReduction}`,
    );
  }
  return {
    enabled: true,
    name: fixture.futureChangeProbe.name ?? "future change",
    controlTouchPoints,
    treatmentTouchPoints,
    touchPointReduction,
    ok: failures.length === 0,
    hardConstraintFailures: failures,
  };
}

function runBehaviorInvariants(worktree, invariants) {
  return invariants.map((invariant) => runCommandCheck(worktree, invariant));
}

function runCommandCheck(worktree, check) {
  const started = Date.now();
  try {
    execFileSync("sh", ["-lc", check.command], {
      cwd: worktree,
      encoding: "utf8",
      env: {
        ...process.env,
        ...check.env,
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      name: check.name ?? check.command,
      command: check.command,
      ok: true,
      durationMs: Date.now() - started,
      error: null,
    };
  } catch (error) {
    return {
      name: check.name ?? check.command,
      command: check.command,
      ok: false,
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function runFutureChangeProbe(worktree, probe) {
  if (probe === null) {
    return null;
  }
  const before = snapshotFixtureFiles(worktree);
  const replacement = applyProbeReplacement(worktree, probe.replacement);
  const after = snapshotFixtureFiles(worktree);
  const changedFiles = changedFilesBetweenSnapshots(before, after);
  const validation = runBehaviorInvariants(worktree, probe.validation ?? []);
  return {
    name: probe.name ?? "future change",
    description: probe.description ?? "",
    touchPoints: changedFiles.length,
    changedFiles,
    patchSizeLines: changedFiles.reduce(
      (total, file) => total + changedLineCount(before[file] ?? "", after[file] ?? ""),
      0,
    ),
    replacements: replacement.replacements,
    validation,
    validationPassed: validation.every((check) => check.ok),
  };
}

function applyProbeReplacement(worktree, replacement) {
  if (replacement === undefined) {
    return { replacements: 0 };
  }
  let replacements = 0;
  for (const relativePath of replacement.paths ?? []) {
    const fullPath = join(worktree, relativePath);
    if (!existsSync(fullPath)) {
      continue;
    }
    const info = statSync(fullPath);
    if (info.isDirectory()) {
      walkFiles(fullPath, (file) => {
        replacements += replaceInFile(file, replacement.from, replacement.to);
      });
    } else if (info.isFile()) {
      replacements += replaceInFile(fullPath, replacement.from, replacement.to);
    }
  }
  return { replacements };
}

function replaceInFile(path, from, to) {
  const before = readFileSync(path, "utf8");
  const count = before.split(from).length - 1;
  if (count === 0) {
    return 0;
  }
  writeFileSync(path, before.split(from).join(to));
  return count;
}

function changedFilesBetweenSnapshots(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((path) => before[path] !== after[path])
    .toSorted();
}

function changedLineCount(before, after) {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const length = Math.max(beforeLines.length, afterLines.length);
  let changed = 0;
  for (let index = 0; index < length; index += 1) {
    if (beforeLines[index] !== afterLines[index]) {
      changed += 1;
    }
  }
  return changed;
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
      `- control fix: ${result.control.fix?.status ?? "none"}`,
      `- treatment fix: ${result.treatment.fix?.status ?? "none"}`,
      `- control revalidation: ${result.control.revalidate?.outcome ?? "none"}`,
      `- treatment revalidation: ${result.treatment.revalidate?.outcome ?? "none"}`,
      `- constraint: ${result.constraint.enabled ? `${result.constraint.id} (${result.constraint.type})` : "none"}`,
      `- control constraint identified: ${result.constraint.controlIdentified ?? "n/a"}`,
      `- treatment constraint identified: ${result.constraint.treatmentIdentified ?? "n/a"}`,
      `- control behavior invariants: ${passedCount(result.control.behaviorInvariants)}/${result.control.behaviorInvariants.length}`,
      `- treatment behavior invariants: ${passedCount(result.treatment.behaviorInvariants)}/${result.treatment.behaviorInvariants.length}`,
      `- control future-change touch points: ${result.control.futureChangeProbe?.touchPoints ?? "none"}`,
      `- treatment future-change touch points: ${result.treatment.futureChangeProbe?.touchPoints ?? "none"}`,
      `- future-change touch point reduction: ${result.futureChange.touchPointReduction ?? "none"}`,
      `- score delta: ${result.scores.delta.toFixed(1)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function semanticRoiLedgerRecord(output) {
  return {
    schemaVersion: 1,
    generatedAt: output.generatedAt,
    decision: output.decision.status,
    reason: output.decision.reason,
    aggregate: output.aggregate,
    fixtures: output.results.map((result) => ({
      slug: result.slug,
      ok: result.ok,
      scoreDelta: result.scores.delta,
      constraint: result.constraint,
      control: ledgerObservation(result.control),
      treatment: ledgerObservation(result.treatment),
      futureChange: result.futureChange,
      hardConstraintFailures: result.hardConstraintFailures,
    })),
  };
}

function ledgerObservation(observation) {
  return {
    semanticEvidence: observation.semanticEvidence,
    findings: observation.report.findings,
    behaviorInvariantPassed: observation.behaviorInvariants.every((check) => check.ok),
    fix: observation.fix
      ? {
          status: observation.fix.status,
          changedFiles: observation.fix.changedFiles,
          filesChanged: observation.fix.filesChanged,
          validation: observation.fix.validation,
        }
      : null,
    revalidation: observation.revalidate
      ? {
          outcome: observation.revalidate.outcome,
          error: observation.revalidate.error,
        }
      : null,
    futureChangeProbe: observation.futureChangeProbe
      ? {
          touchPoints: observation.futureChangeProbe.touchPoints,
          changedFiles: observation.futureChangeProbe.changedFiles,
          patchSizeLines: observation.futureChangeProbe.patchSizeLines,
          validationPassed: observation.futureChangeProbe.validationPassed,
        }
      : null,
  };
}

function passedCount(checks) {
  return checks.filter((check) => check.ok).length;
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
