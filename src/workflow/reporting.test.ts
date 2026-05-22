import { describe, expect, it } from "vitest";
import { findingSummary, renderFindingDetail, renderReport } from "./reporting.js";
import type { FeatureRecord, FindingRecord } from "../platform/types.js";

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
    status: "open",
    history: [],
    signature: "sig_test",
    linkedPatchAttemptIds: [],
    createdByRunId: "run_test",
    createdAt: now,
    updatedAt: now,
    ...overrides,
    changeScenario: overrides.changeScenario ?? null,
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
  it("renders populated finding sections in report and detail views", () => {
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
      reproduction: "Run codenuke report.",
      changeScenario: {
        futureChange: "Add another finding detail section.",
        currentCost: "Each section must be wired separately across report and detail rendering.",
        targetCost: "One section helper handles report and detail rendering consistently.",
        behaviorInvariant:
          "Existing evidence, recommendation, and reproduction output remains unchanged.",
        evidence: ["renderReport and renderFindingDetail both render finding sections"],
        costDimensions: ["change-amplification", "verification-cost"],
      },
    });

    const report = renderReport([record], [feature()]);
    const detail = renderFindingDetail(record, feature(), [], []);

    for (const output of [report, detail]) {
      expect(output).toContain("\nevidence:\n- src/reporting.ts:45-78 (renderReport)\n");
      expect(output).toContain("\nrecommendation:\nExtract shared section rendering.\n");
      expect(output).toContain(
        "\nchange scenario:\nfuture change: Add another finding detail section.\n",
      );
      expect(output).toContain("cost dimensions: change-amplification, verification-cost\n");
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

  it("keeps JSON summaries limited to active finding fields", () => {
    const record = finding();

    const detail = renderFindingDetail(record, feature(), [], []);
    const report = renderReport([record], [feature()]);
    const summary = findingSummary(record, feature());

    expect(detail).not.toContain("candidate trace:");
    expect(detail).not.toContain("guidance:");
    expect(report).not.toContain("candidate trace:");
    expect(summary).not.toHaveProperty("mapEvidenceTrace");
    expect(summary).not.toHaveProperty("candidateTrace");
    expect(summary).not.toHaveProperty("guidance");
    expect(summary).toHaveProperty("changeScenario", null);
  });
});
