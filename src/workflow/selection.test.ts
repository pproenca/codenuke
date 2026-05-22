import { describe, expect, it } from "vitest";
import {
  filterFeaturesByChangedFiles,
  filterFindingsByChangedOwnedFiles,
  nextFinding,
} from "./selection.js";
import { FeatureRecord, FindingRecord } from "../platform/types.js";

function finding(
  findingId: string,
  category: FindingRecord["category"],
  severity: FindingRecord["severity"],
  confidence: FindingRecord["confidence"],
  triage: FindingRecord["triage"] = "risk",
  featureId = "feat_test",
): FindingRecord {
  const now = new Date(0).toISOString();
  return {
    schemaVersion: 1,
    findingId,
    featureId,
    title: findingId,
    category,
    severity,
    confidence,
    triage,
    evidence: [],
    reasoning: "",
    reproduction: null,
    recommendation: "",
    changeScenario: null,
    status: "open",
    history: [],
    signature: findingId,
    linkedPatchAttemptIds: [],
    createdByRunId: "run_test",
    createdAt: now,
    updatedAt: now,
  };
}

function feature(
  featureId: string,
  ownedFiles: string[],
  contextFiles: string[] = [],
): FeatureRecord {
  const now = new Date(0).toISOString();
  return {
    schemaVersion: 1,
    featureId,
    title: featureId,
    summary: "",
    kind: "library",
    source: "test",
    confidence: "high",
    entrypoints: [],
    ownedFiles: ownedFiles.map((path) => ({ path, reason: "owned" })),
    contextFiles: contextFiles.map((path) => ({ path, reason: "context" })),
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

describe("changed-file selection", () => {
  it("checks feature paths against the changed set while preserving order", () => {
    const features = [
      feature("feat_a", ["src/a.ts"], ["tests/a.test.ts"]),
      feature("feat_b", ["src/b.ts", "src/b.ts"]),
      feature("feat_c", ["src/c.ts"], ["tests/c.test.ts"]),
      feature("feat_d", ["src/d.ts"]),
    ];
    const changed = new Set([
      ...Array.from({ length: 300 }, (_value, index) => `src/unrelated-${index}.ts`),
      "src/b.ts",
      "tests/c.test.ts",
    ]);

    expect(
      filterFeaturesByChangedFiles(features, changed, false).map((item) => item.featureId),
    ).toEqual(["feat_b"]);
    expect(
      filterFeaturesByChangedFiles(features, changed, true).map((item) => item.featureId),
    ).toEqual(["feat_b", "feat_c"]);
  });

  it("filters findings by changed owned files only", () => {
    const features = [
      feature("feat_owned", ["src/owned.ts"], ["tests/owned.test.ts"]),
      feature("feat_context", ["src/context.ts"], ["tests/context.test.ts"]),
    ];
    const findings = [
      finding("owned", "performance", "medium", "high", "risk", "feat_owned"),
      finding("context", "performance", "medium", "high", "risk", "feat_context"),
      finding("missing", "performance", "medium", "high", "risk", "feat_missing"),
    ];

    expect(
      filterFindingsByChangedOwnedFiles(
        findings,
        features,
        new Set(["src/owned.ts", "tests/context.test.ts"]),
      ).map((item) => item.findingId),
    ).toEqual(["owned"]);
  });
});

describe("nextFinding", () => {
  it("prioritizes high-confidence simplification findings first", () => {
    const next = nextFinding([
      finding("validation", "build-release", "critical", "high"),
      finding("simplify", "maintainability", "medium", "high"),
      finding("complexity", "performance", "high", "medium"),
    ]);

    expect(next?.findingId).toBe("simplify");
  });

  it("keeps low-confidence simplification findings behind validation blockers", () => {
    const next = nextFinding([
      finding("maybe-simplify", "maintainability", "high", "low"),
      finding("validation", "build-release", "medium", "medium"),
    ]);

    expect(next?.findingId).toBe("validation");
  });

  it("keeps the first equal-rank finding without sorting the full list", () => {
    const findings = [
      finding("first", "performance", "medium", "high"),
      finding("second", "performance", "medium", "high"),
      finding("lower-priority", "build-release", "critical", "low"),
    ];
    Object.defineProperty(findings, "toSorted", {
      value: () => {
        throw new Error("nextFinding should not sort to choose one item");
      },
    });

    expect(nextFinding(findings)?.findingId).toBe("first");
  });
});
