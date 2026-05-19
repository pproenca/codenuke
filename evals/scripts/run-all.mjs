#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(new URL("../..", import.meta.url).pathname);
const fixturesRoot = join(repoRoot, "evals", "fixtures");
const resultsRoot = join(repoRoot, "evals", "results");
const cli = join(repoRoot, "dist", "cli.js");
const providerOverride = envValue("CODENUKE_EVAL_PROVIDER");
const modelOverride = envValue("CODENUKE_EVAL_MODEL");
const reasoningEffortOverride = envValue("CODENUKE_EVAL_REASONING_EFFORT");
const expectationMode = envValue("CODENUKE_EVAL_EXPECTATIONS") ?? "strict";
const resultsFile = envValue("CODENUKE_EVAL_RESULTS") ?? "latest.json";
const guidanceManifest = readJson(join(repoRoot, "resources", "refactoring", "manifest.json"));
const guidanceCoverageConfig =
  readOptionalJson(join(repoRoot, "evals", "guidance-coverage.json")) ?? {};

if (!existsSync(cli)) {
  throw new Error("dist/cli.js is missing. Run pnpm build before pnpm eval.");
}

const fixtureNames = readdirSync(fixturesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .toSorted();

const startedAt = new Date().toISOString();
const results = [];
let fixtureFailures = 0;
const suiteFailures = [];

for (const fixtureName of fixtureNames) {
  const result = runFixture(fixtureName);
  results.push(result);
  if (!result.ok) {
    fixtureFailures += 1;
  }
  const status = result.ok ? "PASS" : "FAIL";
  console.log(`${status} ${result.slug}: ${result.summary}`);
}

const guidanceCoverageMatrix = guidanceCoverageMatrixFromResults(results);
if (expectationMode !== "record" && guidanceCoverageMatrix.totals.unownedResources > 0) {
  const unowned = guidanceCoverageMatrix.resources
    .filter((resource) => resource.status === "unowned")
    .map((resource) => resource.id)
    .join(", ");
  const message = `unowned guidance resource(s): ${unowned}`;
  suiteFailures.push({ check: "guidance-coverage-matrix", message });
  console.log(`FAIL guidance-coverage-matrix: ${message}`);
}

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  startedAt,
  cli: "node dist/cli.js",
  mode: {
    expectations: expectationMode,
    providerOverride,
    model: modelOverride,
    reasoningEffort: reasoningEffortOverride,
  },
  totals: {
    fixtures: results.length,
    passed: results.length - fixtureFailures,
    failed: fixtureFailures,
  },
  suite: {
    ok: suiteFailures.length === 0,
    failures: suiteFailures,
  },
  guidanceCoverageMatrix,
  results,
};

mkdirSync(resultsRoot, { recursive: true });
writeFileSync(join(resultsRoot, resultsFile), `${JSON.stringify(output, null, 2)}\n`);
writeFileSync(
  join(resultsRoot, "guidance-coverage-matrix.json"),
  `${JSON.stringify(guidanceCoverageMatrix, null, 2)}\n`,
);

if ((fixtureFailures > 0 || suiteFailures.length > 0) && expectationMode !== "record") {
  process.exitCode = 1;
}

function runFixture(fixtureName) {
  const fixtureRoot = join(fixturesRoot, fixtureName);
  const definition = readJson(join(fixtureRoot, "eval.json"));
  const tmp = mkdtempSync(join(tmpdir(), `codenuke-eval-${fixtureName}-`));
  const worktree = join(tmp, "repo");
  const started = Date.now();

  try {
    cpSync(join(fixtureRoot, "files"), worktree, { recursive: true });
    const provider = providerOverride ?? definition.review?.provider ?? "mock";
    const limit = String(definition.review?.limit ?? 1);

    if (definition.fix?.enabled === true) {
      initGitWorktree(worktree);
    }
    runCli(worktree, ["init", "--force", "--json"]);
    const map = parseJson(runCli(worktree, ["map", "--json"]));
    const review = parseJson(
      runCli(worktree, [
        "review",
        "--provider",
        provider,
        "--limit",
        limit,
        ...modelArgs(definition.review),
        "--json",
      ]),
    );
    const report = parseJson(runCli(worktree, ["report", "--status", "open", "--json"]));
    const fix = runFixStep(worktree, provider, definition, report);
    const revalidate = runRevalidateStep(worktree, provider, definition, fix?.findingId ?? null);
    const finalReport =
      fix === null && revalidate === null
        ? report
        : parseJson(runCli(worktree, ["report", "--json"]));
    const baseline = baselineFromState(worktree, report, finalReport);
    const score =
      expectationMode === "record"
        ? { ok: true, errors: [] }
        : scoreReport(definition.expect, report);
    const baselineScore =
      expectationMode === "record"
        ? { ok: true, errors: [] }
        : scoreBaseline(definition.expect?.baseline, baseline);

    return {
      schemaVersion: 1,
      slug: definition.slug ?? fixtureName,
      name: definition.name ?? fixtureName,
      ok: score.ok && baselineScore.ok,
      summary:
        score.ok && baselineScore.ok
          ? `${report.findings} open finding(s), ${baseline.workflow.patchAttempts} patch attempt(s)`
          : `${score.errors.length + baselineScore.errors.length} expectation failure(s)`,
      durationMs: Date.now() - started,
      provider,
      map: {
        features: map.features,
        source: map.source,
        usedAgent: map.usedAgent,
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
      baseline,
      errors: [...score.errors, ...baselineScore.errors],
    };
  } catch (error) {
    return {
      schemaVersion: 1,
      slug: definition.slug ?? fixtureName,
      name: definition.name ?? fixtureName,
      ok: false,
      summary: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function runFixStep(worktree, provider, definition, report) {
  if (definition.fix?.enabled !== true) {
    return null;
  }
  const finding = selectFinding(report.items ?? [], definition.fix);
  if (finding === null) {
    throw new Error(`fix requested but no matching finding was found`);
  }
  const fixOutput = parseJson(
    runCli(worktree, [
      "fix",
      "--provider",
      provider,
      "--finding",
      finding.id,
      ...modelArgs(definition.fix),
      "--json",
    ]),
  );
  return {
    findingId: finding.id,
    status: fixOutput.status,
    patchAttempt: fixOutput.patchAttempt,
    filesChanged: fixOutput.filesChanged,
    changedFiles: fixOutput.changedFiles,
    commands: fixOutput.commands,
    validation: fixOutput.validation,
  };
}

function runRevalidateStep(worktree, provider, definition, findingId) {
  if (definition.revalidate?.enabled !== true) {
    return null;
  }
  if (findingId === null) {
    throw new Error("revalidate requested but no fixed finding id is available");
  }
  const revalidateOutput = parseJson(
    runCli(worktree, [
      "revalidate",
      "--provider",
      provider,
      "--finding",
      findingId,
      ...modelArgs(definition.revalidate),
      "--json",
    ]),
  );
  return {
    findingId,
    outcome: revalidateOutput.outcome,
    reasoning: revalidateOutput.reasoning,
  };
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

function scoreReport(expectation, report) {
  const errors = [];
  const expectedOpen = expectation?.openFindings;
  if (typeof expectedOpen === "number" && report.findings !== expectedOpen) {
    errors.push(`expected ${expectedOpen} open finding(s), got ${report.findings}`);
  }

  const actualItems = Array.isArray(report.items) ? report.items : [];
  for (const expected of expectation?.findings ?? []) {
    const match = actualItems.find((item) => matchesFinding(item, expected));
    if (match === undefined) {
      errors.push(`missing expected finding ${JSON.stringify(expected)}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function scoreBaseline(expectation, baseline) {
  const errors = [];
  if (expectation === undefined) {
    return { ok: true, errors };
  }
  if (
    expectation.guidanceSelectionAudits !== undefined &&
    baseline.guidanceSelection.audits !== expectation.guidanceSelectionAudits
  ) {
    errors.push(
      `expected ${expectation.guidanceSelectionAudits} guidance selection audit(s), got ${baseline.guidanceSelection.audits}`,
    );
  }
  for (const resourceId of expectation.selectedResources ?? []) {
    if (!baseline.guidanceSelection.selectedResources.includes(resourceId)) {
      errors.push(`missing selected guidance resource ${resourceId}`);
    }
  }
  for (const resourceId of expectation.absentSelectedResources ?? []) {
    if (baseline.guidanceSelection.selectedResources.includes(resourceId)) {
      errors.push(`unexpected selected guidance resource ${resourceId}`);
    }
  }
  for (const resourceId of expectation.primaryResources ?? []) {
    if (!baseline.guidanceSelection.primaryResources.includes(resourceId)) {
      errors.push(`missing primary guidance resource ${resourceId}`);
    }
  }
  for (const resourceId of expectation.supportingResources ?? []) {
    if (!baseline.guidanceSelection.supportingResources.includes(resourceId)) {
      errors.push(`missing supporting guidance resource ${resourceId}`);
    }
  }
  for (const resourceId of expectation.absentPrimaryResources ?? []) {
    if (baseline.guidanceSelection.primaryResources.includes(resourceId)) {
      errors.push(`unexpected primary guidance resource ${resourceId}`);
    }
  }
  for (const shape of expectation.detectedShapes ?? []) {
    if (!baseline.guidanceSelection.detectedShapeNames.includes(shape)) {
      errors.push(`missing detected guidance shape ${shape}`);
    }
  }
  if (
    expectation.patchAttempts !== undefined &&
    baseline.workflow.patchAttempts !== expectation.patchAttempts
  ) {
    errors.push(
      `expected ${expectation.patchAttempts} patch attempt(s), got ${baseline.workflow.patchAttempts}`,
    );
  }
  if (
    expectation.guidanceApplications !== undefined &&
    baseline.guidanceApplication.withGuidanceApplication !== expectation.guidanceApplications
  ) {
    errors.push(
      `expected ${expectation.guidanceApplications} guidance application(s), got ${baseline.guidanceApplication.withGuidanceApplication}`,
    );
  }
  if (
    expectation.patchBoundaryUnexpectedFiles !== undefined &&
    baseline.patchBoundary.unexpectedFiles !== expectation.patchBoundaryUnexpectedFiles
  ) {
    errors.push(
      `expected ${expectation.patchBoundaryUnexpectedFiles} unexpected patch boundary file(s), got ${baseline.patchBoundary.unexpectedFiles}`,
    );
  }
  for (const [status, count] of Object.entries(expectation.findingsByStatus ?? {})) {
    const actual = baseline.workflow.findingsByStatus[status] ?? 0;
    if (actual !== count) {
      errors.push(`expected ${count} ${status} finding(s), got ${actual}`);
    }
  }
  for (const [status, count] of Object.entries(expectation.patchAttemptsByStatus ?? {})) {
    const actual = baseline.workflow.patchAttemptsByStatus[status] ?? 0;
    if (actual !== count) {
      errors.push(`expected ${count} ${status} patch attempt(s), got ${actual}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function baselineFromState(worktree, initialReport, finalReport) {
  const state = readState(worktree);
  const guidanceSelectionAudits = state.runs.flatMap((run) => run.guidanceSelectionAudits ?? []);
  const patchesWithGuidance = state.patches.filter((patch) => patch.guidanceApplication !== null);
  const patchFailures = state.patches
    .map((patch) => patch.failure)
    .filter((failure) => failure !== null && failure !== undefined);
  return {
    schemaVersion: 1,
    deterministicEval: {
      initialOpenFindings: initialReport.findings,
      finalFindings: finalReport.findings,
    },
    guidanceSelection: {
      audits: guidanceSelectionAudits.length,
      detectedShapes: sum(guidanceSelectionAudits, (audit) => audit.detectedShapes?.length ?? 0),
      selectedResources: uniqueSorted(
        guidanceSelectionAudits.flatMap((audit) =>
          (audit.selected ?? []).map((resource) => resource.resourceId),
        ),
      ),
      primaryResources: uniqueSorted(
        guidanceSelectionAudits.flatMap((audit) =>
          (audit.selected ?? [])
            .filter((resource) => resource.role === "primary")
            .map((resource) => resource.resourceId),
        ),
      ),
      supportingResources: uniqueSorted(
        guidanceSelectionAudits.flatMap((audit) =>
          (audit.selected ?? [])
            .filter((resource) => resource.role === "supporting")
            .map((resource) => resource.resourceId),
        ),
      ),
      detectedShapeNames: uniqueSorted(
        guidanceSelectionAudits.flatMap((audit) =>
          (audit.detectedShapes ?? []).map((shape) => shape.shape),
        ),
      ),
      promptedResources: uniqueSorted(
        guidanceSelectionAudits.flatMap((audit) =>
          (audit.promptedResources ?? []).map((resource) => resource.resourceId),
        ),
      ),
      rejectedResources: uniqueSorted(
        guidanceSelectionAudits.flatMap((audit) =>
          (audit.rejected ?? []).map((resource) => resource.resourceId),
        ),
      ),
      promptProofs: guidanceSelectionAudits.filter((audit) => typeof audit.promptHash === "string")
        .length,
    },
    guidanceApplication: {
      patchAttempts: state.patches.length,
      withGuidanceApplication: patchesWithGuidance.length,
      appliedResources: countGuidanceActions(patchesWithGuidance, "applied"),
      adaptedResources: countGuidanceActions(patchesWithGuidance, "adapted"),
      notUsedResources: countGuidanceActions(patchesWithGuidance, "not-used"),
      resourceActions: guidanceResourceActions(patchesWithGuidance),
      deviations: sum(
        patchesWithGuidance,
        (patch) => patch.guidanceApplication?.deviations?.length ?? 0,
      ),
      risks: countBy(
        patchesWithGuidance.map((patch) => patch.guidanceApplication?.risk).filter(Boolean),
      ),
    },
    patchBoundary: {
      patchAttempts: state.patches.length,
      filesChanged: sum(state.patches, (patch) => patch.filesChanged?.length ?? 0),
      failures: patchFailures.filter((failure) => failure.code === "out-of-scope-changes").length,
      unexpectedFiles: sum(patchFailures, (failure) => failure.unexpectedFiles?.length ?? 0),
    },
    workflow: {
      runs: state.runs.length,
      findings: state.findings.length,
      findingsByStatus: countBy(state.findings.map((finding) => finding.status)),
      patchAttempts: state.patches.length,
      patchAttemptsByStatus: countBy(state.patches.map((patch) => patch.status)),
      validationCommands: sum(state.patches, (patch) => patch.commandsRun?.length ?? 0),
      revalidationOutcomes: countBy(
        state.findings.flatMap((finding) =>
          (finding.history ?? [])
            .filter((entry) => entry.kind === "revalidate")
            .map((entry) => entry.status),
        ),
      ),
    },
  };
}

function readState(worktree) {
  const stateRoot = join(worktree, ".codenuke");
  return {
    runs: readJsonRecords(join(stateRoot, "runs")),
    findings: readJsonRecords(join(stateRoot, "findings")),
    patches: readJsonRecords(join(stateRoot, "patches")),
  };
}

function readJsonRecords(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => readJson(join(dir, entry.name)));
}

function countGuidanceActions(patches, action) {
  return sum(
    patches,
    (patch) =>
      patch.guidanceApplication?.appliedResources?.filter((resource) => resource.action === action)
        .length ?? 0,
  );
}

function guidanceResourceActions(patches) {
  return patches.flatMap((patch) =>
    (patch.guidanceApplication?.appliedResources ?? []).map((resource) => ({
      patchAttemptId: patch.patchAttemptId,
      findingId: patch.findingId ?? null,
      resourceId: resource.resourceId,
      action: resource.action,
    })),
  );
}

function countBy(values) {
  const counts = {};
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0) {
      continue;
    }
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).toSorted(([a], [b]) => a.localeCompare(b)));
}

function sum(items, value) {
  return items.reduce((total, item) => total + value(item), 0);
}

function uniqueSorted(values) {
  return [...new Set(values)].toSorted();
}

function modelArgs(definition) {
  const model = modelOverride ?? definition?.model;
  const reasoningEffort = reasoningEffortOverride ?? definition?.reasoningEffort;
  return [
    ...(typeof model === "string" && model.length > 0 ? ["--model", model] : []),
    ...(typeof reasoningEffort === "string" && reasoningEffort.length > 0
      ? ["--reasoning-effort", reasoningEffort]
      : []),
  ];
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
  }));
}

function guidanceCoverageMatrixFromResults(evalResults) {
  const coverage = new Map();
  for (const resource of guidanceManifest.resources ?? []) {
    coverage.set(resource.id, {
      id: resource.id,
      title: resource.title,
      kind: resource.kind,
      stages: resource.stages ?? [],
      selectWhen: resource.selectWhen ?? [],
      selectable: (resource.selectWhen ?? []).length > 0,
      selectedBy: [],
      appliedBy: [],
      reservedBy: [],
      status: "unowned",
    });
  }

  for (const result of evalResults) {
    const selection = result.baseline?.guidanceSelection;
    for (const resourceId of selection?.selectedResources ?? []) {
      const row = coverage.get(resourceId);
      if (row !== undefined) {
        row.selectedBy.push(result.slug);
      }
    }
    const patches = result.baseline?.guidanceApplication;
    if (patches === undefined) {
      continue;
    }
    for (const resource of patches.resourceActions ?? []) {
      const row = coverage.get(resource.resourceId);
      if (row !== undefined) {
        row.appliedBy.push({
          fixture: result.slug,
          action: resource.action,
          patchAttemptId: resource.patchAttemptId,
        });
      }
    }
  }

  const reservations = guidanceCoverageConfig.reservedResources ?? [];
  for (const reservation of reservations) {
    const row = coverage.get(reservation.resourceId);
    if (row !== undefined) {
      row.reservedBy.push({
        reason: reservation.reason,
      });
    }
  }

  const resources = [...coverage.values()].map((row) => {
    const selectedBy = uniqueSorted(row.selectedBy);
    const appliedBy = row.appliedBy.toSorted(
      (left, right) =>
        left.fixture.localeCompare(right.fixture) || left.action.localeCompare(right.action),
    );
    const reservedBy = row.reservedBy;
    const status =
      selectedBy.length > 0
        ? "covered"
        : appliedBy.length > 0
          ? "applied"
          : reservedBy.length > 0
            ? "reserved"
            : "unowned";
    return {
      ...row,
      selectedBy,
      appliedBy,
      reservedBy,
      status,
    };
  });

  const unownedResources = resources.filter((resource) => resource.status === "unowned").length;
  const unownedSelectableResources = resources.filter(
    (resource) => resource.status === "unowned" && resource.selectable,
  ).length;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      manifest: "resources/refactoring/manifest.json",
      coverageConfig: "evals/guidance-coverage.json",
    },
    totals: {
      resources: resources.length,
      selectableResources: resources.filter((resource) => resource.selectable).length,
      coveredResources: resources.filter((resource) => resource.status === "covered").length,
      appliedResources: resources.filter((resource) => resource.status === "applied").length,
      reservedResources: resources.filter((resource) => resource.status === "reserved").length,
      unownedResources,
      unownedSelectableResources,
    },
    resources,
  };
}

function readJson(path) {
  return parseJson(readFileSync(path, "utf8"));
}

function readOptionalJson(path) {
  return existsSync(path) ? readJson(path) : null;
}

function envValue(name) {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? null : value;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to parse JSON: ${message}\n${text}`, { cause: error });
  }
}
