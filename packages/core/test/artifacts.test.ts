import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_CALIBRATION_SCALES,
  costOf,
  validateCalibrationArtifact,
  validateChangeCostArtifact,
  validateFenceArtifact,
  validateValueProxy,
  validateValueProxyArtifact,
  vhatOf,
  wilson,
} from "../src/index.ts";

const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);

const fenceArtifact = () => {
  const w = wilson(60, 60);
  return {
    schemaVersion: 1 as const,
    baseline: "HEAD",
    baselineSha: SHA,
    generatedAt: "2026-05-25T00:00:00.000Z",
    method: "ast-aware" as const,
    threshold: 0.9,
    capPerRegion: 60,
    seed: 1337,
    regions: {
      src: {
        caught: 60,
        total: 60,
        p: w.p,
        lo: w.lo,
        hi: w.hi,
        admissible: w.lo >= 0.9,
        survivorSpecs: [],
      },
    },
  };
};

const calibrationArtifact = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1 as const,
  baseline: "HEAD",
  baselineSha: SHA,
  generatedAt: "2026-05-25T00:00:00.000Z",
  commitsSampled: 3,
  scales: { sL: 150, sCx: 15, sDup: 5 },
  ...overrides,
});

const valueProxyArtifact = () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    id: `candidate-${i + 1}`,
    proxy: i + 1,
    Vhat: 12 - i,
  }));
  const report = validateValueProxy(rows);
  expect(report.passed).toBe(true);
  return {
    schemaVersion: 1 as const,
    input: ".codenuke/value-proxy-input.json",
    ...report,
    rows,
  };
};

const changecostArtifact = () => {
  const cost = costOf(10, 0, 60);
  return {
    schemaVersion: 1 as const,
    ref: "HEAD",
    beta: 60,
    Vhat: vhatOf([cost]),
    done: 1,
    total: 1,
    results: [
      {
        id: "task-1",
        status: "done" as const,
        editTokens: 10,
        filesTouched: 1,
        regions: ["src"],
        verifyFrac: 0,
        cost,
      },
    ],
  };
};

describe("artifact validation — schema decode plus re-derivation", () => {
  it("rejects hand-edited fence admissibility and Wilson values", () => {
    const valid = fenceArtifact();
    expect(validateFenceArtifact(valid, { baselineSha: SHA, threshold: 0.9 }).status.usable).toBe(true);

    expect(
      validateFenceArtifact(
        { ...valid, regions: { src: { ...valid.regions.src, admissible: !valid.regions.src.admissible } } },
        { baselineSha: SHA, threshold: 0.9 },
      ).status.reason,
    ).toContain("admissible");

    expect(
      validateFenceArtifact(
        { ...valid, regions: { src: { ...valid.regions.src, lo: valid.regions.src.lo - 0.01 } } },
        { baselineSha: SHA, threshold: 0.9 },
      ).status.reason,
    ).toContain("wilson");
  });

  it("marks stale fence/calibration baselines unusable", () => {
    expect(validateFenceArtifact(fenceArtifact(), { baselineSha: OTHER_SHA, threshold: 0.9 }).status).toMatchObject({
      stale: true,
      usable: false,
    });
    expect(validateCalibrationArtifact(calibrationArtifact(), { baselineSha: OTHER_SHA }).status).toMatchObject({
      stale: true,
      usable: false,
    });
  });

  it("validates calibration positive finite scales and default-scale provenance", () => {
    expect(validateCalibrationArtifact(calibrationArtifact(), { baselineSha: SHA }).status.usable).toBe(true);
    expect(
      validateCalibrationArtifact(calibrationArtifact({ scales: { sL: 0, sCx: 15, sDup: 5 } }), { baselineSha: SHA })
        .status.reason,
    ).toBe("invalid-scales");
    expect(
      validateCalibrationArtifact(calibrationArtifact({ commitsSampled: 2, scales: { sL: 10, sCx: 15, sDup: 5 } }), {
        baselineSha: SHA,
      }).status.reason,
    ).toBe("invalid-provenance");
    expect(
      validateCalibrationArtifact(calibrationArtifact({ commitsSampled: 2, scales: DEFAULT_CALIBRATION_SCALES }), {
        baselineSha: SHA,
      }).status.usable,
    ).toBe(true);
  });

  it("re-runs value-proxy rho and p-value validation from rows", () => {
    const valid = valueProxyArtifact();
    expect(validateValueProxyArtifact(valid).status.usable).toBe(true);

    expect(validateValueProxyArtifact({ ...valid, rho: valid.rho! - 0.01 }).status.reason).toContain(
      "re-derivation",
    );
    expect(validateValueProxyArtifact({ ...valid, pValue: valid.pValue! + 0.01 }).status.reason).toContain(
      "re-derivation",
    );
    expect(validateValueProxyArtifact({ ...valid, passed: false }).status.usable).toBe(false);
  });

  it("re-derives changecost verifyFrac, cost, done count, and Vhat", () => {
    const valid = changecostArtifact();
    expect(validateChangeCostArtifact(valid, { src: { p: 1 } }).status.usable).toBe(true);

    expect(
      validateChangeCostArtifact(
        { ...valid, results: [{ ...valid.results[0]!, verifyFrac: 0.5, cost: 40 }] },
        { src: { p: 1 } },
      ).status.reason,
    ).toContain("tampered");
    expect(validateChangeCostArtifact({ ...valid, done: 0 }, { src: { p: 1 } }).status.reason).toBe(
      "tampered: done-count",
    );
    expect(validateChangeCostArtifact({ ...valid, Vhat: 11 }, { src: { p: 1 } }).status.reason).toBe(
      "tampered: Vhat",
    );
  });
});
