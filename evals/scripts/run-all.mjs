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
let failed = 0;

for (const fixtureName of fixtureNames) {
  const result = runFixture(fixtureName);
  results.push(result);
  if (!result.ok) {
    failed += 1;
  }
  const status = result.ok ? "PASS" : "FAIL";
  console.log(`${status} ${result.slug}: ${result.summary}`);
}

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  startedAt,
  cli: "node dist/cli.js",
  totals: {
    fixtures: results.length,
    passed: results.length - failed,
    failed,
  },
  results,
};

mkdirSync(resultsRoot, { recursive: true });
writeFileSync(join(resultsRoot, "latest.json"), `${JSON.stringify(output, null, 2)}\n`);

if (failed > 0) {
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
    const limit = String(definition.review?.limit ?? 1);

    runCli(worktree, ["init", "--force", "--json"]);
    const map = parseJson(runCli(worktree, ["map", "--json"]));
    const review = parseJson(
      runCli(worktree, ["review", "--provider", provider, "--limit", limit, "--json"]),
    );
    const report = parseJson(runCli(worktree, ["report", "--status", "open", "--json"]));
    const score = scoreReport(definition.expect, report);

    return {
      schemaVersion: 1,
      slug: definition.slug ?? fixtureName,
      name: definition.name ?? fixtureName,
      ok: score.ok,
      summary: score.ok
        ? `${report.findings} open finding(s)`
        : `${score.errors.length} expectation failure(s)`,
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
      errors: score.errors,
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

function runCli(root, args) {
  return execFileSync(process.execPath, [cli, "--root", root, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CODENUKE_PROVIDER: "mock",
      NO_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
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
