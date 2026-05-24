// Characterization tests for the pure calibration math (loop/calibrate.mjs has no
// exports — it's a CLI script — so values are derived by reasoning from its logic).
import { describe, expect, it } from "vitest";

import { deltaOf, deriveScales, median, positiveScale } from "@codenuke/calibrate";

describe("median (RULE-010)", () => {
  it("odd / even / single / empty", () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([3, 1, 2])).toBe(2); // sorts first
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([5])).toBe(5);
    expect(median([])).toBe(0);
  });
});

describe("positiveScale (RULE-010)", () => {
  it("median of positives, else fallback", () => {
    expect(positiveScale([0, 0, 4, 2], 99)).toBe(3); // median([2,4]) = 3
    expect(positiveScale([0, -1, 0], 99)).toBe(99); // no positives -> fallback
    expect(positiveScale([], 7)).toBe(7);
    expect(positiveScale([6], 99)).toBe(6);
  });
});

describe("deltaOf (RULE-010)", () => {
  it("absolute per-axis difference", () => {
    expect(deltaOf({ L: 100, complexity: 10, dupMass: 5 }, { L: 80, complexity: 14, dupMass: 5 })).toEqual({
      dL: 20,
      dCx: 4,
      dDup: 0,
    });
  });
});

describe("deriveScales (RULE-010)", () => {
  it("uses defaults when fewer than 3 commits have any positive delta", () => {
    const out = deriveScales([
      { dL: 10, dCx: 0, dDup: 0 },
      { dL: 0, dCx: 0, dDup: 0 }, // filtered out (no positive)
      { dL: 4, dCx: 2, dDup: 0 },
    ]);
    expect(out.enoughHistory).toBe(false);
    expect(out.commitsSampled).toBe(2);
    expect(out.scales).toEqual({ sL: 150, sCx: 15, sDup: 5 }); // DEFAULT_CALIBRATION_SCALES
  });

  it("derives per-axis median of positive deltas with >= 3 sampled commits", () => {
    const out = deriveScales([
      { dL: 10, dCx: 4, dDup: 0 },
      { dL: 20, dCx: 0, dDup: 2 },
      { dL: 30, dCx: 8, dDup: 0 },
    ]);
    expect(out.enoughHistory).toBe(true);
    expect(out.commitsSampled).toBe(3);
    // sL: median([10,20,30]) = 20; sCx: median(positive [4,8]) = 6; sDup: median(positive [2]) = 2
    expect(out.scales).toEqual({ sL: 20, sCx: 6, sDup: 2 });
  });

  it("falls back per-axis to the default when an axis has no positive deltas", () => {
    const out = deriveScales([
      { dL: 10, dCx: 0, dDup: 0 },
      { dL: 20, dCx: 0, dDup: 0 },
      { dL: 30, dCx: 0, dDup: 0 },
    ]);
    expect(out.enoughHistory).toBe(true);
    expect(out.scales).toEqual({ sL: 20, sCx: 15, sDup: 5 }); // sCx/sDup fall back to defaults
  });
});
