import { describe, expect, it } from "vitest";
import { nextFinding } from "./selection.js";
import { FindingRecord } from "./types.js";

function finding(
  findingId: string,
  category: FindingRecord["category"],
  severity: FindingRecord["severity"],
  confidence: FindingRecord["confidence"],
  triage: FindingRecord["triage"] = "risk",
): FindingRecord {
  const now = new Date(0).toISOString();
  return {
    schemaVersion: 1,
    findingId,
    featureId: "feat_test",
    title: findingId,
    category,
    severity,
    confidence,
    triage,
    evidence: [],
    reasoning: "",
    reproduction: null,
    recommendation: "",
    whyTestsDoNotAlreadyCoverThis: "",
    suggestedRegressionTest: null,
    minimumFixScope: "",
    status: "open",
    history: [],
    signature: findingId,
    linkedPatchAttemptIds: [],
    createdByRunId: "run_test",
    createdAt: now,
    updatedAt: now,
  };
}

describe("nextFinding", () => {
  it("prioritizes trusted refactoring findings before confirmed bugs", () => {
    const next = nextFinding([
      finding("bug", "bug", "critical", "high", "confirmed-bug"),
      finding("simplify", "maintainability", "medium", "high"),
      finding("complexity", "performance", "high", "medium"),
    ]);

    expect(next?.findingId).toBe("simplify");
  });

  it("keeps low-confidence refactoring findings behind material safety findings", () => {
    const next = nextFinding([
      finding("maybe-simplify", "maintainability", "high", "low"),
      finding("security", "security", "medium", "medium", "confirmed-bug"),
    ]);

    expect(next?.findingId).toBe("security");
  });
});
