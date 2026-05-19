import { describe, expect, it } from "vitest";
import { stableFeatureJson } from "./feature-equivalence.js";
import type { FeatureRecord } from "../platform/types.js";

function feature(overrides: Partial<FeatureRecord> = {}): FeatureRecord {
  const now = new Date(0).toISOString();
  return {
    schemaVersion: 1,
    featureId: "feat_test",
    title: "Test feature",
    summary: "Test feature summary.",
    kind: "library",
    source: "test",
    confidence: "high",
    entrypoints: [],
    ownedFiles: [{ path: "src/index.ts", reason: "entrypoint" }],
    contextFiles: [],
    tests: [],
    tags: ["test"],
    trustBoundaries: [],
    status: "reviewed",
    lock: null,
    findingIds: [],
    patchAttemptIds: [],
    analysisHistory: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("stableFeatureJson", () => {
  it("ignores volatile feature bookkeeping fields", () => {
    const base = feature();
    const changedBookkeeping = feature({
      lock: {
        lockedByRunId: "run",
        lockedAt: "2026-01-01T00:00:00.000Z",
        hostname: "host",
        pid: 123,
      },
      analysisHistory: [
        {
          runId: "run",
          kind: "review",
          summary: "0 finding(s)",
          provider: "mock",
          model: null,
          reasoningEffort: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    expect(stableFeatureJson(changedBookkeeping)).toBe(stableFeatureJson(base));
    expect(stableFeatureJson(feature({ title: "Renamed feature" }))).not.toBe(
      stableFeatureJson(base),
    );
  });
});
