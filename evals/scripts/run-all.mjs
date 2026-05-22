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

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  startedAt,
  cli: "node dist/cli.js",
  mode: {
    deterministic: true,
    expectations: "strict",
    provider: "mock",
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
  results,
};

mkdirSync(resultsRoot, { recursive: true });
writeFileSync(join(resultsRoot, "latest.json"), `${JSON.stringify(output, null, 2)}\n`);

if (fixtureFailures > 0 || suiteFailures.length > 0) {
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
    const provider = definition.review?.provider ?? "mock";
    if (provider !== "mock") {
      throw new Error(`eval fixtures must use the mock provider, got ${provider}`);
    }
    const limit = String(definition.review?.limit ?? 1);

    if (definition.fix?.enabled === true) {
      initGitWorktree(worktree);
    }
    runCli(worktree, ["init", "--force", "--json"]);
    const map = parseJson(runCli(worktree, ["map", "--json"]));
    const review = parseJson(
      runCli(worktree, ["review", "--provider", provider, "--limit", limit, "--json"]),
    );
    const report = parseJson(runCli(worktree, ["report", "--status", "open", "--json"]));
    const fix = runFixStep(worktree, provider, definition, report);
    const revalidate = runRevalidateStep(worktree, provider, definition, fix?.findingId ?? null);
    const finalReport =
      fix === null && revalidate === null
        ? report
        : parseJson(runCli(worktree, ["report", "--json"]));
    const baseline = baselineFromState(worktree, report, finalReport);
    const score = scoreReport(definition.expect, report);
    const baselineScore = scoreBaseline(definition.expect?.baseline, baseline);

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
    runCli(worktree, ["fix", "--provider", provider, "--finding", finding.id, "--json"]),
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
    runCli(worktree, ["revalidate", "--provider", provider, "--finding", findingId, "--json"]),
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
    expectation.patchAttempts !== undefined &&
    baseline.workflow.patchAttempts !== expectation.patchAttempts
  ) {
    errors.push(
      `expected ${expectation.patchAttempts} patch attempt(s), got ${baseline.workflow.patchAttempts}`,
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
  const patchFailures = state.patches
    .map((patch) => patch.failure)
    .filter((failure) => failure !== null && failure !== undefined);
  return {
    schemaVersion: 1,
    deterministicEval: {
      initialOpenFindings: initialReport.findings,
      finalFindings: finalReport.findings,
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
  if (expected.changeScenario === true && item.changeScenario === null) {
    return false;
  }
  if (
    expected.changeScenarioFutureChange !== undefined &&
    item.changeScenario?.futureChange !== expected.changeScenarioFutureChange
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
    changeScenario: item.changeScenario ?? null,
  }));
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
