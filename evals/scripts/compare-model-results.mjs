#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(new URL("../..", import.meta.url).pathname);
const resultsRoot = join(repoRoot, "evals", "results");
const baselineFile = process.env["CODENUKE_EVAL_BASELINE"] ?? "latest.json";
const modelFile = process.env["CODENUKE_EVAL_RESULTS"] ?? "model-latest.json";
const outputJson = process.env["CODENUKE_EVAL_COMPARISON_JSON"] ?? "model-comparison.json";
const outputMarkdown = process.env["CODENUKE_EVAL_COMPARISON_MD"] ?? "model-comparison.md";

const baselineResult = readResult(join(resultsRoot, baselineFile));
const modelResult = readResult(join(resultsRoot, modelFile));
const comparisonResult = compareResults(baselineResult, modelResult);

mkdirSync(resultsRoot, { recursive: true });
writeFileSync(join(resultsRoot, outputJson), `${JSON.stringify(comparisonResult, null, 2)}\n`);
writeFileSync(join(resultsRoot, outputMarkdown), markdownReport(comparisonResult));

function compareResults(baselineRun, modelRun) {
  const baselineBySlug = new Map(
    (baselineRun.results ?? []).map((result) => [result.slug, result]),
  );
  const modelBySlug = new Map((modelRun.results ?? []).map((result) => [result.slug, result]));
  const fixtureSlugs = uniqueSorted([...baselineBySlug.keys(), ...modelBySlug.keys()]);
  const fixtureDeltas = fixtureSlugs.map((slug) => {
    const baselineFixture = baselineBySlug.get(slug);
    const modelFixture = modelBySlug.get(slug);
    return {
      slug,
      baselineOk: baselineFixture?.ok ?? null,
      modelOk: modelFixture?.ok ?? null,
      baselineFindings: baselineFixture?.report?.findings ?? null,
      modelFindings: modelFixture?.report?.findings ?? null,
      findingDelta:
        baselineFixture?.report?.findings === undefined ||
        modelFixture?.report?.findings === undefined
          ? null
          : modelFixture.report.findings - baselineFixture.report.findings,
      baselineGuidanceResources:
        baselineFixture?.baseline?.guidanceSelection?.selectedResources ?? [],
      modelGuidanceResources: modelFixture?.baseline?.guidanceSelection?.selectedResources ?? [],
      modelErrors: modelFixture?.errors ?? [],
    };
  });

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baseline: runSummary(baselineRun, baselineFile),
    model: runSummary(modelRun, modelFile),
    guidanceCoverage: {
      baseline: baselineRun.guidanceCoverageMatrix?.totals ?? null,
      model: modelRun.guidanceCoverageMatrix?.totals ?? null,
    },
    fixtureDeltas,
    totals: {
      fixturesCompared: fixtureDeltas.length,
      modelExecutionFailures: fixtureDeltas.filter((delta) => delta.modelOk === false).length,
      findingDeltas: countBy(
        fixtureDeltas
          .map((delta) => delta.findingDelta)
          .filter((delta) => typeof delta === "number")
          .map((delta) => String(delta)),
      ),
    },
  };
}

function runSummary(result, file) {
  return {
    file,
    generatedAt: result.generatedAt,
    cli: result.cli,
    mode: result.mode,
    totals: result.totals,
    patchBoundary: aggregatePatchBoundary(result.results ?? []),
    workflow: aggregateWorkflow(result.results ?? []),
  };
}

function aggregatePatchBoundary(results) {
  return {
    patchAttempts: sum(results, (result) => result.baseline?.patchBoundary?.patchAttempts ?? 0),
    filesChanged: sum(results, (result) => result.baseline?.patchBoundary?.filesChanged ?? 0),
    failures: sum(results, (result) => result.baseline?.patchBoundary?.failures ?? 0),
    unexpectedFiles: sum(results, (result) => result.baseline?.patchBoundary?.unexpectedFiles ?? 0),
  };
}

function aggregateWorkflow(results) {
  return {
    patchAttempts: sum(results, (result) => result.baseline?.workflow?.patchAttempts ?? 0),
    validationCommands: sum(
      results,
      (result) => result.baseline?.workflow?.validationCommands ?? 0,
    ),
    findingsByStatus: countObjects(
      results.map((result) => result.baseline?.workflow?.findingsByStatus),
    ),
    revalidationOutcomes: countObjects(
      results.map((result) => result.baseline?.workflow?.revalidationOutcomes),
    ),
  };
}

function markdownReport(report) {
  const failedFixtures = report.fixtureDeltas
    .filter((delta) => delta.modelOk === false)
    .map((delta) => delta.slug);
  const changedFindings = report.fixtureDeltas
    .filter((delta) => delta.findingDelta !== 0 && delta.findingDelta !== null)
    .map(
      (delta) =>
        `| ${delta.slug} | ${delta.baselineFindings} | ${delta.modelFindings} | ${delta.findingDelta} |`,
    );
  return `${[
    "# Codex GPT-5.5 Model Eval Comparison",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Runs",
    "",
    `- Baseline: ${report.baseline.totals.passed}/${report.baseline.totals.fixtures} fixtures passed (${report.baseline.mode.expectations})`,
    `- Model: ${report.model.totals.passed}/${report.model.totals.fixtures} fixtures passed (${report.model.mode.providerOverride}/${report.model.mode.model}, ${report.model.mode.reasoningEffort}, ${report.model.mode.expectations})`,
    "",
    "## Guidance Coverage",
    "",
    `- Baseline unowned selectable resources: ${report.guidanceCoverage.baseline?.unownedSelectableResources ?? "n/a"}`,
    `- Model unowned selectable resources: ${report.guidanceCoverage.model?.unownedSelectableResources ?? "n/a"}`,
    `- Baseline unowned resources: ${report.guidanceCoverage.baseline?.unownedResources ?? "n/a"}`,
    `- Model unowned resources: ${report.guidanceCoverage.model?.unownedResources ?? "n/a"}`,
    "",
    "## Patch Boundary",
    "",
    `- Baseline unexpected files: ${report.baseline.patchBoundary.unexpectedFiles}`,
    `- Model unexpected files: ${report.model.patchBoundary.unexpectedFiles}`,
    `- Baseline boundary failures: ${report.baseline.patchBoundary.failures}`,
    `- Model boundary failures: ${report.model.patchBoundary.failures}`,
    "",
    "## Workflow",
    "",
    `- Baseline patch attempts: ${report.baseline.workflow.patchAttempts}`,
    `- Model patch attempts: ${report.model.workflow.patchAttempts}`,
    `- Baseline validation commands: ${report.baseline.workflow.validationCommands}`,
    `- Model validation commands: ${report.model.workflow.validationCommands}`,
    "",
    "## Model Failures",
    "",
    failedFixtures.length === 0 ? "- none" : failedFixtures.map((slug) => `- ${slug}`).join("\n"),
    "",
    "## Finding Deltas",
    "",
    changedFindings.length === 0
      ? "- none"
      : [
          "| Fixture | Baseline findings | Model findings | Delta |",
          "| --- | ---: | ---: | ---: |",
          ...changedFindings,
        ].join("\n"),
    "",
  ].join("\n")}`;
}

function readResult(path) {
  if (!existsSync(path)) {
    throw new Error(`missing eval result: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function sum(items, value) {
  return items.reduce((total, item) => total + value(item), 0);
}

function uniqueSorted(values) {
  return [...new Set(values)].toSorted();
}

function countBy(values) {
  const counts = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).toSorted(([a], [b]) => a.localeCompare(b)));
}

function countObjects(objects) {
  const counts = {};
  for (const object of objects) {
    if (object === null || object === undefined) {
      continue;
    }
    for (const [key, value] of Object.entries(object)) {
      counts[key] = (counts[key] ?? 0) + value;
    }
  }
  return Object.fromEntries(Object.entries(counts).toSorted(([a], [b]) => a.localeCompare(b)));
}
