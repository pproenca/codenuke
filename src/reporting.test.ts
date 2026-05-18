import { describe, expect, it } from "vitest";
import { renderFindingDetail, renderReport } from "./reporting.js";
import type { FeatureRecord, FindingRecord } from "./types.js";

function finding(overrides: Partial<FindingRecord> = {}): FindingRecord {
  const now = new Date(0).toISOString();
  return {
    schemaVersion: 1,
    findingId: "fnd_test",
    featureId: "feat_test",
    title: "Test finding",
    category: "maintainability",
    severity: "low",
    confidence: "medium",
    triage: "risk",
    evidence: [],
    reasoning: "Reasoning.",
    reproduction: null,
    recommendation: "",
    whyTestsDoNotAlreadyCoverThis: "",
    suggestedRegressionTest: null,
    minimumFixScope: "",
    status: "open",
    history: [],
    signature: "sig_test",
    linkedPatchAttemptIds: [],
    createdByRunId: "run_test",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function feature(overrides: Partial<FeatureRecord> = {}): FeatureRecord {
  const now = new Date(0).toISOString();
  return {
    schemaVersion: 1,
    featureId: "feat_test",
    title: "Test feature",
    summary: "Test feature summary.",
    kind: "library",
    source: "test",
    confidence: "medium",
    entrypoints: [],
    ownedFiles: [],
    contextFiles: [],
    tests: [],
    tags: [],
    trustBoundaries: [],
    status: "needs-fix",
    lock: null,
    findingIds: [],
    patchAttemptIds: [],
    analysisHistory: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("markdown finding sections", () => {
  it("renders populated finding metadata sections in report and detail views", () => {
    const record = finding({
      evidence: [
        {
          path: "src/reporting.ts",
          startLine: 45,
          endLine: 78,
          symbol: "renderReport",
          quote: null,
        },
      ],
      recommendation: "Extract shared section rendering.",
      whyTestsDoNotAlreadyCoverThis: "Existing tests only cover workflow output.",
      suggestedRegressionTest: "Assert section labels in both views.",
      minimumFixScope: "src/reporting.ts and reporting tests.",
      reproduction: "Run codenuke report.",
    });

    const report = renderReport([record], [feature()]);
    const detail = renderFindingDetail(record, feature(), [], []);

    for (const output of [report, detail]) {
      expect(output).toContain("\nevidence:\n- src/reporting.ts:45-78 (renderReport)\n");
      expect(output).toContain("\nrecommendation:\nExtract shared section rendering.\n");
      expect(output).toContain("\ntest analysis:\nExisting tests only cover workflow output.\n");
      expect(output).toContain(
        "\nsuggested regression test:\nAssert section labels in both views.\n",
      );
      expect(output).toContain("\nminimum fix scope:\nsrc/reporting.ts and reporting tests.\n");
    }
    expect(report).toContain("\nrepro:\nRun codenuke report.\n");
    expect(detail).not.toContain("\nrepro:\n");
  });

  it("keeps empty optional finding metadata omitted from both markdown views", () => {
    const record = finding();
    const report = renderReport([record]);
    const detail = renderFindingDetail(record, null, [], []);

    expect(report).not.toContain("\nevidence:\n");
    expect(report).not.toContain("\nrecommendation:\n");
    expect(detail).toContain("\nevidence:\n- none\n");
    expect(detail).toContain("\nrecommendation:\n");
    for (const output of [report, detail]) {
      expect(output).not.toContain("\ntest analysis:\n");
      expect(output).not.toContain("\nsuggested regression test:\n");
      expect(output).not.toContain("\nminimum fix scope:\n");
      expect(output).not.toContain("\nrepro:\n");
    }
  });
});
