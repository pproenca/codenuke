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
const fixtureDefinitionFailures = validateFixtureDefinitions(fixtureDefinitions);
const protectedRepoBefore = protectedSnapshot(fixtureDefinitions);

try {
  const results = fixtureDefinitions.map((fixture) => runRoiFixture(fixture));
  const protectedRepoAfter = protectedSnapshot(fixtureDefinitions);
  const mutationFailures = protectedMutationFailures(protectedRepoBefore, protectedRepoAfter);
  const aggregate = aggregateResults(results);
  const hardConstraintFailures = [
    ...fixtureDefinitionFailures,
    ...mutationFailures,
    ...results.flatMap((result) => result.hardConstraintFailures),
  ];
  const readiness = productionReadiness({
    results,
    fixtureDefinitionFailures,
    mutationFailures,
  });
  const decision = semanticRoiDecision({
    aggregate,
    hardConstraintFailures,
    results,
    readiness,
  });
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    startedAt,
    cli: "node dist/cli.js",
    mode: {
      deterministic: true,
      provider: "mock",
    },
    sealedEvaluator: {
      protectedFiles: protectedRepoBefore.size,
      protectedRepoFiles: protectedRepoBefore.size,
      mutationFailures,
    },
    productionReadiness: readiness,
    ledger: {
      path: ledgerPath,
      appendOnly: true,
    },
    aggregate,
    decision,
    audit: {
      provenBehavior: [
        "The deterministic harness runs the same fixture with semantic evidence hidden from the control state and visible in the treatment state.",
        "The control run exposes no semantic-neighbor links and produces no finding.",
        "The treatment run exposes semantic-neighbor links and produces a traced Refactoring Finding.",
        "Treatment fixtures can run fix and revalidate through the normal CLI while rejecting test mutation.",
        "Constraint fixtures run sealed behavior invariants before measuring future-change cost.",
        "Fixture definitions must declare a change scenario, current cost, target cost, and validation command before a positive ROI score can count.",
        "Fixture evaluator files are hash-checked inside copied worktrees, so fix and future-change steps cannot mutate tests, behavior scripts, or project test config.",
        "Future-change probes measure whether treatment reduces touch points versus control.",
        "Future-change probes define the change scenario, current cost, target cost, and cost dimensions before scoring easier change.",
        "Production readiness requires multiple positive future-change scenarios plus a semantic false-positive trap.",
        "The run records hard constraint failures separately from quality metrics.",
      ],
      proxyEvidence: [],
      outOfScope: ["Live-provider ROI remains out of scope for this deterministic command."],
      blockers: decision.status === "keep" ? [] : decision.failures,
      nextInputs:
        decision.status === "keep"
          ? [
              "Use this deterministic gate for production mapper/refactoring ROI changes; add new sealed scenarios as new refactoring classes become supported.",
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
    protectedPaths: definition.protectedPaths ?? [],
    review: definition.review ?? {},
    fix: definition.fix ?? {},
    revalidate: definition.revalidate ?? {},
    expect: definition.expect ?? {},
  };
}

function validateFixtureDefinitions(fixtures) {
  const failures = [];
  for (const fixture of fixtures) {
    if (fixture.futureChangeProbe === null) {
      continue;
    }
    if (fixture.behaviorInvariants.length === 0) {
      failures.push(`${fixture.slug}: positive ROI fixture must define behaviorInvariants`);
    }
    if (fixture.expectedTransformation === null) {
      failures.push(`${fixture.slug}: positive ROI fixture must define expectedTransformation`);
    } else {
      if (!isNonEmptyString(fixture.expectedTransformation.kind)) {
        failures.push(`${fixture.slug}: expectedTransformation.kind must be a non-empty string`);
      }
      if (!Array.isArray(fixture.expectedTransformation.allowedChangedFiles)) {
        failures.push(
          `${fixture.slug}: expectedTransformation.allowedChangedFiles must list the allowed patch boundary`,
        );
      }
      if (typeof fixture.expectedTransformation.maxChangedFiles !== "number") {
        failures.push(`${fixture.slug}: expectedTransformation.maxChangedFiles must be numeric`);
      }
    }
    if (fixture.fix.enabled !== true) {
      failures.push(`${fixture.slug}: positive ROI fixture must run fix`);
    }
    if (fixture.revalidate.enabled !== true) {
      failures.push(`${fixture.slug}: positive ROI fixture must run revalidate`);
    }
    const scenario = fixture.futureChangeProbe.changeScenario;
    if (!isRecord(scenario)) {
      failures.push(`${fixture.slug}: futureChangeProbe.changeScenario is required`);
    } else {
      for (const field of ["class", "scenario", "whyThisMeasuresEasier"]) {
        if (!isNonEmptyString(scenario[field])) {
          failures.push(`${fixture.slug}: changeScenario.${field} must be a non-empty string`);
        }
      }
      if (!Array.isArray(scenario.costDimensions) || scenario.costDimensions.length === 0) {
        failures.push(`${fixture.slug}: changeScenario.costDimensions must be non-empty`);
      }
      failures.push(...costModelValidationFailures(fixture.slug, scenario));
    }
    if (probeReplacementEntries(fixture.futureChangeProbe).length === 0) {
      failures.push(`${fixture.slug}: futureChangeProbe must define replacement or replacements`);
    }
    if (
      !Array.isArray(fixture.futureChangeProbe.validation) ||
      fixture.futureChangeProbe.validation.length === 0
    ) {
      failures.push(`${fixture.slug}: futureChangeProbe.validation must be non-empty`);
    }
    if (!isRecord(fixture.expect.control?.futureChangeProbe)) {
      failures.push(`${fixture.slug}: expect.control.futureChangeProbe is required`);
    }
    if (!isRecord(fixture.expect.treatment?.futureChangeProbe)) {
      failures.push(`${fixture.slug}: expect.treatment.futureChangeProbe is required`);
    }
  }
  return failures;
}

function costModelValidationFailures(slug, scenario) {
  const failures = [];
  const currentCost = scenario.currentCost;
  const targetCost = scenario.targetCost;
  for (const [name, value] of [
    ["currentCost.touchPoints", currentCost?.touchPoints],
    ["currentCost.patchSizeLines", currentCost?.patchSizeLines],
    ["currentCost.validationCommands", currentCost?.validationCommands],
    ["targetCost.touchPointsMax", targetCost?.touchPointsMax],
    ["targetCost.patchSizeLinesMax", targetCost?.patchSizeLinesMax],
    ["targetCost.changedFilesMax", targetCost?.changedFilesMax],
    ["targetCost.validationCommands", targetCost?.validationCommands],
  ]) {
    if (typeof value !== "number") {
      failures.push(`${slug}: changeScenario.${name} must be numeric`);
    }
  }
  return failures;
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

function runObservation(fixture, label, semanticEvidenceVisible) {
  const worktree = join(tmp, `${fixture.slug}-${label}`);
  cpSync(fixture.filesRoot, worktree, { recursive: true });
  const protectedFixtureBefore = protectedFixtureSnapshot(worktree, fixture);
  const provider = fixture.review.provider ?? "mock";
  if (provider !== "mock") {
    throw new Error(`semantic ROI fixtures must use the mock provider, got ${provider}`);
  }
  const limit = String(fixture.review.limit ?? 1);
  if (fixture.fix.enabled === true) {
    initGitWorktree(worktree);
  }
  runCli(worktree, ["init", "--force", "--json"]);
  const map = parseJson(runCli(worktree, ["map", "--json"]));
  if (!semanticEvidenceVisible) {
    suppressSemanticEvidenceForControl(worktree);
  }
  const features = readStateRecords(worktree, "features");
  const semanticEvidenceLinks = features.reduce(
    (total, feature) => total + (feature.semanticEvidence ?? []).length,
    0,
  );
  const review = parseJson(
    runCli(worktree, ["review", "--provider", provider, "--limit", limit, "--json"]),
  );
  const report = parseJson(runCli(worktree, ["report", "--status", "open", "--json"]));
  const fix = runFixStep(worktree, provider, fixture, report);
  const protectedAfterFix = protectedFixtureSnapshot(worktree, fixture);
  const revalidate = runRevalidateStep(worktree, provider, fixture, fix?.findingId ?? null);
  const finalReport =
    fix === null && revalidate === null
      ? report
      : parseJson(runCli(worktree, ["report", "--json"]));
  const behaviorInvariants = runBehaviorInvariants(worktree, fixture.behaviorInvariants);
  const futureChangeProbe = runFutureChangeProbe(worktree, fixture.futureChangeProbe);
  const protectedAfterFutureChange = protectedFixtureSnapshot(worktree, fixture);
  const afterFixMutations = protectedFixtureMutationFailures(
    protectedFixtureBefore,
    protectedAfterFix,
    "fix",
  );
  const afterFutureChangeMutations = protectedFixtureMutationFailures(
    protectedAfterFix,
    protectedAfterFutureChange,
    "future-change",
  );
  return {
    label,
    semanticEvidence: semanticEvidenceVisible,
    protectedFiles: {
      count: protectedFixtureBefore.size,
      afterFixMutations,
      afterFutureChangeMutations,
      mutations: [...afterFixMutations, ...afterFutureChangeMutations],
    },
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

function runFixStep(worktree, provider, fixture, report) {
  if (fixture.fix.enabled !== true) {
    return null;
  }
  const finding = selectFinding(report.items ?? [], fixture.fix);
  if (finding === null) {
    return null;
  }
  try {
    const fixOutput = parseJson(
      runCli(worktree, ["fix", "--provider", provider, "--finding", finding.id, "--json"]),
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

function runRevalidateStep(worktree, provider, fixture, findingId) {
  if (fixture.revalidate.enabled !== true || findingId === null) {
    return null;
  }
  try {
    const revalidateOutput = parseJson(
      runCli(worktree, ["revalidate", "--provider", provider, "--finding", findingId, "--json"]),
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
  hardConstraintFailures.push(
    ...observation.protectedFiles.mutations.map(
      (failure) => `${label} mutated protected evaluator file: ${failure}`,
    ),
  );
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

function productionReadiness({
  results,
  fixtureDefinitionFailures: definitionFailures,
  mutationFailures,
}) {
  const positiveScenarioFixtures = results.filter((result) => result.futureChange.enabled);
  const negativeTrapFixtures = results.filter(
    (result) =>
      !result.futureChange.enabled &&
      result.treatment.map.semanticEvidenceLinks > 0 &&
      result.treatment.report.findings === 0,
  );
  const costDimensions = [
    ...new Set(
      positiveScenarioFixtures.flatMap(
        (result) => result.futureChange.scenario?.costDimensions ?? [],
      ),
    ),
  ].toSorted();
  const requiredCostDimensions = [
    "change-amplification",
    "blast-radius",
    "verification-cost",
    "reversibility",
  ];
  const failures = [
    ...definitionFailures,
    ...mutationFailures,
    ...(positiveScenarioFixtures.length < 2
      ? [
          `production readiness requires at least 2 positive future-change fixtures, got ${positiveScenarioFixtures.length}`,
        ]
      : []),
    ...(negativeTrapFixtures.length < 1
      ? ["production readiness requires at least 1 semantic false-positive trap fixture"]
      : []),
    ...requiredCostDimensions
      .filter((dimension) => !costDimensions.includes(dimension))
      .map((dimension) => `production readiness missing cost dimension: ${dimension}`),
    ...positiveScenarioFixtures
      .filter((result) => result.control.behaviorInvariants.length === 0)
      .map((result) => `${result.slug}: positive scenario has no control behavior invariant`),
    ...positiveScenarioFixtures
      .filter((result) => result.treatment.behaviorInvariants.length === 0)
      .map((result) => `${result.slug}: positive scenario has no treatment behavior invariant`),
    ...positiveScenarioFixtures
      .filter((result) => !result.futureChange.ok)
      .map((result) => `${result.slug}: future-change cost model failed`),
  ];
  return {
    ready: failures.length === 0,
    minimums: {
      positiveFutureChangeFixtures: 2,
      semanticFalsePositiveTrapFixtures: 1,
      requiredCostDimensions,
    },
    metrics: {
      positiveFutureChangeFixtures: positiveScenarioFixtures.length,
      semanticFalsePositiveTrapFixtures: negativeTrapFixtures.length,
      costDimensions,
    },
    failures,
  };
}

function semanticRoiDecision({ aggregate, hardConstraintFailures, results, readiness }) {
  const failures = [
    ...new Set([
      ...hardConstraintFailures,
      ...readiness.failures,
      ...results.flatMap((result) => [
        ...result.scores.control.errors.map((error) => `${result.slug}: ${error}`),
        ...result.scores.treatment.errors.map((error) => `${result.slug}: ${error}`),
      ]),
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

function protectedFixtureSnapshot(root, fixture) {
  const snapshot = new Map();
  walkFiles(root, (file) => {
    const relativePath = file.slice(root.length + 1).replace(/\\/gu, "/");
    if (
      relativePath.startsWith(".git/") ||
      relativePath.startsWith(".codenuke/") ||
      relativePath.startsWith("node_modules/")
    ) {
      return;
    }
    if (isProtectedFixturePath(relativePath, fixture)) {
      snapshot.set(relativePath, hashFile(file));
    }
  });
  return snapshot;
}

function protectedFixtureMutationFailures(before, after, phase) {
  const paths = [...new Set([...before.keys(), ...after.keys()])].toSorted();
  return paths
    .filter((path) => before.get(path) !== after.get(path))
    .map((path) => `${phase} changed ${path}`);
}

function isProtectedFixturePath(path, fixture) {
  if (
    (fixture.protectedPaths ?? []).some((protectedPath) =>
      pathMatchesProtectedPath(path, protectedPath),
    )
  ) {
    return true;
  }
  return (
    path.startsWith("behavior/") ||
    path.startsWith("test/") ||
    path.startsWith("tests/") ||
    path.startsWith("__tests__/") ||
    isTestPath(path) ||
    [
      "package.json",
      "tsconfig.json",
      "bunfig.toml",
      "vitest.config.js",
      "vitest.config.ts",
    ].includes(path)
  );
}

function pathMatchesProtectedPath(path, protectedPath) {
  if (typeof protectedPath !== "string" || protectedPath.length === 0) {
    return false;
  }
  if (protectedPath.endsWith("/")) {
    return path.startsWith(protectedPath);
  }
  return path === protectedPath;
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
  const scenario = fixture.futureChangeProbe.changeScenario ?? null;
  const controlTouchPoints = control.futureChangeProbe?.touchPoints ?? null;
  const treatmentTouchPoints = treatment.futureChangeProbe?.touchPoints ?? null;
  const controlCost = costFromFutureChangeProbe(control.futureChangeProbe);
  const treatmentCost = costFromFutureChangeProbe(treatment.futureChangeProbe);
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
  failures.push(...futureChangeCostModelFailures(scenario, controlCost, treatmentCost));
  return {
    enabled: true,
    name: fixture.futureChangeProbe.name ?? "future change",
    scenario,
    controlCost,
    treatmentCost,
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
  const replacement = applyProbeReplacements(worktree, probeReplacementEntries(probe));
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
    cost: {
      touchPoints: changedFiles.length,
      changedFiles,
      patchSizeLines: changedFiles.reduce(
        (total, file) => total + changedLineCount(before[file] ?? "", after[file] ?? ""),
        0,
      ),
      validationCommands: validation.length,
      validationPassed: validation.every((check) => check.ok),
    },
  };
}

function costFromFutureChangeProbe(probe) {
  return probe?.cost ?? null;
}

function futureChangeCostModelFailures(scenario, controlCost, treatmentCost) {
  if (scenario === null || controlCost === null || treatmentCost === null) {
    return [];
  }
  const failures = [];
  const currentCost = scenario.currentCost ?? {};
  const targetCost = scenario.targetCost ?? {};
  if (
    typeof currentCost.touchPoints === "number" &&
    controlCost.touchPoints !== currentCost.touchPoints
  ) {
    failures.push(
      `expected current change cost ${currentCost.touchPoints} touch point(s), got ${controlCost.touchPoints}`,
    );
  }
  if (
    typeof currentCost.patchSizeLines === "number" &&
    controlCost.patchSizeLines !== currentCost.patchSizeLines
  ) {
    failures.push(
      `expected current change cost ${currentCost.patchSizeLines} patch-size line(s), got ${controlCost.patchSizeLines}`,
    );
  }
  if (
    typeof currentCost.validationCommands === "number" &&
    controlCost.validationCommands !== currentCost.validationCommands
  ) {
    failures.push(
      `expected current change cost ${currentCost.validationCommands} validation command(s), got ${controlCost.validationCommands}`,
    );
  }
  if (
    typeof targetCost.touchPointsMax === "number" &&
    treatmentCost.touchPoints > targetCost.touchPointsMax
  ) {
    failures.push(
      `expected target change cost <= ${targetCost.touchPointsMax} touch point(s), got ${treatmentCost.touchPoints}`,
    );
  }
  if (
    typeof targetCost.patchSizeLinesMax === "number" &&
    treatmentCost.patchSizeLines > targetCost.patchSizeLinesMax
  ) {
    failures.push(
      `expected target change cost <= ${targetCost.patchSizeLinesMax} patch-size line(s), got ${treatmentCost.patchSizeLines}`,
    );
  }
  if (
    typeof targetCost.changedFilesMax === "number" &&
    treatmentCost.changedFiles.length > targetCost.changedFilesMax
  ) {
    failures.push(
      `expected target change cost <= ${targetCost.changedFilesMax} changed file(s), got ${treatmentCost.changedFiles.length}`,
    );
  }
  if (
    typeof targetCost.validationCommands === "number" &&
    treatmentCost.validationCommands !== targetCost.validationCommands
  ) {
    failures.push(
      `expected target change cost ${targetCost.validationCommands} validation command(s), got ${treatmentCost.validationCommands}`,
    );
  }
  return failures;
}

function probeReplacementEntries(probe) {
  if (Array.isArray(probe?.replacements)) {
    return probe.replacements;
  }
  return probe?.replacement === undefined ? [] : [probe.replacement];
}

function applyProbeReplacements(worktree, replacementsToApply) {
  let replacements = 0;
  for (const replacement of replacementsToApply) {
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

function runCli(root, args) {
  return execFileSync(process.execPath, [cli, "--root", root, ...args], {
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

function suppressSemanticEvidenceForControl(worktree) {
  const dir = join(worktree, ".codenuke", "features");
  if (!existsSync(dir)) {
    return;
  }
  for (const file of readdirSync(dir)
    .filter((entry) => entry.endsWith(".json"))
    .toSorted()) {
    const path = join(dir, file);
    const feature = readJson(path);
    if (!Array.isArray(feature.semanticEvidence) || feature.semanticEvidence.length === 0) {
      continue;
    }
    feature.semanticEvidence = [];
    writeFileSync(path, `${JSON.stringify(feature, null, 2)}\n`);
  }
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
    `production ready: ${output.productionReadiness.ready ? "yes" : "no"}`,
    `positive future-change fixtures: ${output.productionReadiness.metrics.positiveFutureChangeFixtures}`,
    `semantic false-positive traps: ${output.productionReadiness.metrics.semanticFalsePositiveTrapFixtures}`,
    "",
    "## Proven Behavior",
    ...output.audit.provenBehavior.map((entry) => `- ${entry}`),
    "",
    "## Proxy Evidence",
    ...(output.audit.proxyEvidence.length === 0
      ? ["- none"]
      : output.audit.proxyEvidence.map((entry) => `- ${entry}`)),
    "",
    "## Out Of Scope",
    ...output.audit.outOfScope.map((entry) => `- ${entry}`),
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
      `- control protected evaluator files: ${result.control.protectedFiles.count}`,
      `- treatment protected evaluator files: ${result.treatment.protectedFiles.count}`,
      `- control protected mutations: ${result.control.protectedFiles.mutations.length}`,
      `- treatment protected mutations: ${result.treatment.protectedFiles.mutations.length}`,
      `- future-change scenario: ${result.futureChange.scenario?.scenario ?? "none"}`,
      `- future-change dimensions: ${(result.futureChange.scenario?.costDimensions ?? []).join(", ") || "none"}`,
      `- control future-change touch points: ${result.control.futureChangeProbe?.touchPoints ?? "none"}`,
      `- treatment future-change touch points: ${result.treatment.futureChangeProbe?.touchPoints ?? "none"}`,
      `- control future-change patch-size lines: ${result.control.futureChangeProbe?.patchSizeLines ?? "none"}`,
      `- treatment future-change patch-size lines: ${result.treatment.futureChangeProbe?.patchSizeLines ?? "none"}`,
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
    productionReadiness: output.productionReadiness,
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
    protectedMutations: observation.protectedFiles.mutations,
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

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function sum(items, value) {
  return items.reduce((total, item) => total + value(item), 0);
}
