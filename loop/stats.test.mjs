import { describe, expect, it } from "vitest";
import { ranks, wilson } from "./stats.mjs";

describe("average tie ranks", () => {
  it("assigns average ranks while preserving original order", () => {
    expect(ranks([10, 20, 10, 30])).toEqual([1.5, 3, 1.5, 4]);
  });
});

describe("Wilson confidence interval", () => {
  it("matches the specified examples", () => {
    const interval = wilson(56, 60);

    expect(interval.p).toBeCloseTo(56 / 60, 12);
    expect(interval.lo).toBeGreaterThanOrEqual(0.84);
    expect(interval.lo).toBeLessThanOrEqual(0.842);
    expect(interval.hi).toBeGreaterThanOrEqual(0.973);
    expect(interval.hi).toBeLessThanOrEqual(0.975);
    expect(wilson(0, 0)).toEqual({ p: 0, lo: 0, hi: 1 });
  });

  it("keeps bounds ordered and the lower bound monotonic at fixed n", () => {
    let previousLower = 0;

    for (let caught = 0; caught <= 20; caught += 1) {
      const interval = wilson(caught, 20);

      expect(interval.lo).toBeGreaterThanOrEqual(0);
      expect(interval.p).toBeGreaterThanOrEqual(interval.lo);
      expect(interval.hi).toBeGreaterThanOrEqual(interval.p);
      expect(interval.hi).toBeLessThanOrEqual(1);
      expect(interval.lo).toBeGreaterThanOrEqual(previousLower);
      previousLower = interval.lo;
    }
  });

  it("requires at least 35 all-caught mutants to admit a region at 0.90", () => {
    expect(wilson(34, 34).lo).toBeLessThan(0.9);
    expect(wilson(35, 35).lo).toBeGreaterThanOrEqual(0.9);
  });
});
