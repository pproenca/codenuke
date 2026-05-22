import { describe, expect, it } from "vitest";
import { spearmanRho, validateValueProxy } from "./value-proxy.mjs";

describe("Spearman rho", () => {
  it("detects positive and negative rank correlation", () => {
    expect(spearmanRho([1, 2, 3], [10, 20, 30])).toBeCloseTo(1, 12);
    expect(spearmanRho([1, 2, 3], [30, 20, 10])).toBeCloseTo(-1, 12);
  });

  it("handles tied ranks with average ranks", () => {
    expect(spearmanRho([1, 1, 2, 3], [10, 10, 20, 30])).toBeCloseTo(1, 12);
  });
});

describe("value proxy validation", () => {
  it("passes when higher proxy values track lower change-cost", () => {
    const report = validateValueProxy([
      { id: "small", proxy: 1, Vhat: 30 },
      { id: "medium", proxy: 2, Vhat: 20 },
      { id: "large", proxy: 3, Vhat: 10 },
    ]);

    expect(report).toMatchObject({
      passed: true,
      rho: 1,
      minimumRho: 0.6,
      candidates: 3,
    });
  });

  it("fails closed for too-small corpora", () => {
    const report = validateValueProxy([
      { id: "one", proxy: 1, Vhat: 1 },
      { id: "two", proxy: 2, Vhat: 2 },
    ]);

    expect(report).toMatchObject({
      passed: false,
      reason: "too-small-corpus",
      candidates: 2,
    });
  });
});
