import { describe, expect, it } from "vitest";
import { fixtureRoot, writeFixture } from "../testing/test-helpers.js";
import { CodenukeConfig, FeatureRecord, ProjectRecord } from "../platform/types.js";
import { refactoringOpportunityCandidates } from "./ludicrous.js";
import { initCommand, reviewCommand } from "./app.js";
import { buildReviewPromptWithGuidance } from "./prompt.js";
import { statePaths, writeFeature } from "./state.js";

const now = "2026-01-01T00:00:00.000Z";

describe("ludicrous review mode", () => {
  it("finds high-recall cross-file refactoring opportunity candidates", async () => {
    const root = await fixtureRoot("codenuke-ludicrous-candidates-");
    await writeFixture(
      root,
      "src/alpha.ts",
      [
        "export function alphaFeatureCandidate(input: string) {",
        "  const normalizedFeatureCandidate = input.trim().toLowerCase();",
        "  const resolvedFeatureCandidate = normalizedFeatureCandidate.replaceAll(' ', '-');",
        "  return { normalizedFeatureCandidate, resolvedFeatureCandidate };",
        "}",
        "",
      ].join("\n"),
    );
    await writeFixture(
      root,
      "src/beta.ts",
      [
        "export function betaFeatureCandidate(input: string) {",
        "  const normalizedFeatureCandidate = input.trim().toLowerCase();",
        "  const resolvedFeatureCandidate = normalizedFeatureCandidate.replaceAll('_', '-');",
        "  return { normalizedFeatureCandidate, resolvedFeatureCandidate };",
        "}",
        "",
      ].join("\n"),
    );
    const features = [
      feature("feat_alpha", "Alpha", "src/alpha.ts"),
      feature("feat_beta", "Beta", "src/beta.ts"),
    ];

    const candidates = await refactoringOpportunityCandidates(root, features);

    expect(candidates[0]).toMatchObject({
      source: expect.any(String),
      audit: expect.objectContaining({
        algorithm: expect.any(String),
      }),
      files: expect.arrayContaining([
        expect.objectContaining({ path: "src/alpha.ts" }),
        expect.objectContaining({ path: "src/beta.ts" }),
      ]),
    });
  });

  it("keeps semantic candidates visible when lexical candidates score higher", async () => {
    const root = await fixtureRoot("codenuke-ludicrous-diverse-candidates-");
    await writeFixture(
      root,
      "src/alpha.ts",
      [
        "export function alphaFeatureCandidate(input: string) {",
        "  const normalizedFeatureCandidate = input.trim().toLowerCase();",
        "  const resolvedFeatureCandidate = normalizedFeatureCandidate.replaceAll(' ', '-');",
        "  return { normalizedFeatureCandidate, resolvedFeatureCandidate };",
        "}",
        "",
      ].join("\n"),
    );
    await writeFixture(
      root,
      "src/beta.ts",
      [
        "export function betaFeatureCandidate(input: string) {",
        "  const normalizedFeatureCandidate = input.trim().toLowerCase();",
        "  const resolvedFeatureCandidate = normalizedFeatureCandidate.replaceAll('_', '-');",
        "  return { normalizedFeatureCandidate, resolvedFeatureCandidate };",
        "}",
        "",
      ].join("\n"),
    );
    const features = [
      feature("feat_alpha", "Alpha", "src/alpha.ts"),
      feature("feat_beta", "Beta", "src/beta.ts"),
    ];

    const candidates = await refactoringOpportunityCandidates(root, features, { limit: 2 });

    expect(candidates.map((candidate) => candidate.source)).toEqual(
      expect.arrayContaining(["lexical-phrase", "tfidf-file-similarity"]),
    );
  });

  it("adds TF-IDF file similarity candidates with source audit metadata", async () => {
    const root = await fixtureRoot("codenuke-ludicrous-tfidf-candidates-");
    await writeFixture(
      root,
      "src/alpha.ts",
      [
        "export function auditPermissionScope(input: string) {",
        "  const accountScope = input.trim();",
        "  const roleMatrix = accountScope.toLowerCase();",
        "  const policyDecision = roleMatrix.includes('admin');",
        "  const permissionAudit = `${accountScope}:${policyDecision}`;",
        "  return { roleMatrix, permissionAudit, policyDecision };",
        "}",
        "",
      ].join("\n"),
    );
    await writeFixture(
      root,
      "src/beta.ts",
      [
        "export function resolvePolicyMatrix(input: string) {",
        "  const permissionAudit = input.toLowerCase();",
        "  const policyDecision = permissionAudit.includes('owner');",
        "  const accountScope = permissionAudit.trim();",
        "  const roleMatrix = `${policyDecision}:${accountScope}`;",
        "  return { accountScope, policyDecision, roleMatrix };",
        "}",
        "",
      ].join("\n"),
    );
    const features = [
      feature("feat_alpha", "Alpha", "src/alpha.ts"),
      feature("feat_beta", "Beta", "src/beta.ts"),
    ];

    const candidates = await refactoringOpportunityCandidates(root, features, { limit: 20 });
    const semantic = candidates.find((candidate) => candidate.source === "tfidf-file-similarity");

    expect(semantic).toEqual(
      expect.objectContaining({
        source: "tfidf-file-similarity",
        audit: expect.objectContaining({
          algorithm: "cosine similarity over identifier TF-IDF vectors",
          matchedSignals: expect.arrayContaining(["account", "policy", "scope"]),
        }),
        files: expect.arrayContaining([
          expect.objectContaining({ path: "src/alpha.ts" }),
          expect.objectContaining({ path: "src/beta.ts" }),
        ]),
      }),
    );
  });

  it("injects candidates as review leads, not findings", async () => {
    const root = await fixtureRoot("codenuke-ludicrous-prompt-");
    await writeFixture(root, "src/alpha.ts", "export const normalizedFeatureCandidate = true;\n");
    await writeFixture(root, "src/beta.ts", "export const normalizedFeatureCandidate = false;\n");
    const project = projectRecord(root);
    const alpha = feature("feat_alpha", "Alpha", "src/alpha.ts");

    const { prompt } = await buildReviewPromptWithGuidance(root, project, alpha, config(), {
      ludicrousCandidates: [
        {
          title: "Cross-file normalized feature candidate",
          summary: "High-recall candidate around normalized feature candidate.",
          source: "lexical-phrase",
          score: 12.25,
          signals: ["normalized feature", "candidate"],
          audit: {
            algorithm: "test",
            matchedSignals: ["normalized feature"],
            score: 12.25,
          },
          files: [
            { path: "src/alpha.ts", reason: "signal appears", lines: 1 },
            { path: "src/beta.ts", reason: "signal appears", lines: 1 },
          ],
        },
      ],
    });

    expect(prompt).toContain("Ludicrous Review Mode");
    expect(prompt).toContain("high-recall Refactoring Opportunity Candidates, not findings");
    expect(prompt).toContain('"source": "lexical-phrase"');
    expect(prompt).toContain('"algorithm": "test"');
    expect(prompt.match(/^--- src\/beta\.ts$/gmu) ?? []).toHaveLength(1);
  });

  it("builds dry-run candidates from the review scope before applying --limit", async () => {
    const root = await fixtureRoot("codenuke-ludicrous-review-command-");
    await writeFixture(root, "package.json", JSON.stringify({ name: "fixture" }));
    await writeFixture(
      root,
      "src/alpha.ts",
      "export const normalizedFeatureCandidate = 'alpha';\nexport const resolvedFeatureCandidate = normalizedFeatureCandidate;\n",
    );
    await writeFixture(
      root,
      "src/beta.ts",
      "export const normalizedFeatureCandidate = 'beta';\nexport const resolvedFeatureCandidate = normalizedFeatureCandidate;\n",
    );
    const context = { root, options: options() };
    await initCommand(context, {});
    const paths = statePaths(`${root}/.codenuke`);
    await writeFeature(paths, feature("feat_alpha", "Alpha", "src/alpha.ts"));
    await writeFeature(paths, feature("feat_beta", "Beta", "src/beta.ts"));

    const dryRun = (await reviewCommand(context, {
      dryRun: true,
      ludicrousMode: true,
      limit: "1",
    })) as {
      wouldReview: number;
      opportunityCandidates: Array<{ files: Array<{ path: string }> }>;
    };

    expect(dryRun.wouldReview).toBe(1);
    expect(dryRun.opportunityCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          files: expect.arrayContaining([
            expect.objectContaining({ path: "src/alpha.ts" }),
            expect.objectContaining({ path: "src/beta.ts" }),
          ]),
        }),
      ]),
    );
  });
});

function feature(featureId: string, title: string, path: string): FeatureRecord {
  return {
    schemaVersion: 1,
    featureId,
    title,
    summary: title,
    kind: "library",
    source: "test",
    confidence: "high",
    entrypoints: [{ path, symbol: null, route: null, command: null }],
    ownedFiles: [{ path, reason: "test" }],
    contextFiles: [],
    tests: [],
    tags: [],
    trustBoundaries: [],
    status: "pending",
    lock: null,
    findingIds: [],
    patchAttemptIds: [],
    analysisHistory: [],
    createdAt: now,
    updatedAt: now,
  };
}

function projectRecord(root: string): ProjectRecord {
  return {
    schemaVersion: 1,
    projectId: "proj_test",
    name: "test",
    rootPath: root,
    git: { remoteUrl: null, defaultBranch: null, currentBranch: null, headSha: null },
    detected: {
      languages: ["typescript"],
      frameworks: [],
      packageManagers: [],
      commands: {
        typecheck: null,
        lint: null,
        format: null,
        formatCheck: null,
        test: null,
      },
    },
    createdAt: now,
    updatedAt: now,
  };
}

function config(): CodenukeConfig {
  return {
    schemaVersion: 1,
    stateDir: ".codenuke",
    include: [],
    exclude: [],
    provider: { name: "mock", model: null, reasoningEffort: null },
    commands: {
      typecheck: null,
      lint: null,
      format: null,
      formatCheck: null,
      test: null,
    },
    review: {
      maxContextFiles: 5,
      maxOwnedFiles: 5,
      maxFindingsPerFeature: 5,
      minConfidenceToFix: "medium",
    },
    git: {
      requireCleanWorktreeForFix: false,
      commit: false,
      openPr: false,
    },
  };
}

function options() {
  return {
    json: false,
    plain: false,
    quiet: true,
    verbose: false,
    debug: false,
    noColor: true,
    noInput: true,
  };
}
