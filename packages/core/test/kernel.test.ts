import { describe, expect, it } from "@effect/vitest";
import {
  countTypeErrors,
  fenceGapMean,
  fenceGapMin,
  parseDiffSize,
  spearmanRho,
  tieRanks,
  wilson,
} from "@codenuke/core";

describe("Statistical kernel", () => {
  // RULE-006 — Wilson interval & fence-admissibility bar
  it("RULE-006 (k=35,n=35) wilson.lo >= 0.90 (admissible at fenceLB)", () => {
    const w = wilson(35, 35);
    expect(w.p).toBe(1);
    expect(w.lo).toBeGreaterThanOrEqual(0.9);
    expect(w.hi).toBeLessThanOrEqual(1);
  });

  it("RULE-006 (k=34,n=35) wilson.lo < 0.90 (inadmissible)", () => {
    const w = wilson(34, 35);
    expect(w.lo).toBeLessThan(0.9);
  });

  it("RULE-006 n=0 → degenerate {p:0,lo:0,hi:1} (fail-closed)", () => {
    const w = wilson(0, 0);
    expect(w).toEqual({ p: 0, lo: 0, hi: 1 });
  });

  it("RULE-006 bounds are clamped to [0,1]", () => {
    const w = wilson(1, 1);
    expect(w.lo).toBeGreaterThanOrEqual(0);
    expect(w.hi).toBeLessThanOrEqual(1);
    expect(w.lo).toBeLessThanOrEqual(w.p);
    expect(w.p).toBeLessThanOrEqual(w.hi);
  });
});

describe("Tie-averaged ranks & Spearman (RULE-014)", () => {
  it("RULE-014 ranks of [3,1,2] == [3,1,2] (input order preserved)", () => {
    expect(tieRanks([3, 1, 2])).toEqual([3, 1, 2]);
  });

  it("RULE-014 ties [5,5,1] → [2.5,2.5,1] (midpoint rank)", () => {
    expect(tieRanks([5, 5, 1])).toEqual([2.5, 2.5, 1]);
  });

  it("RULE-014 perfectly concordant series → spearmanRho == 1", () => {
    expect(spearmanRho([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 12);
  });

  it("RULE-014 perfectly discordant series → spearmanRho == -1", () => {
    expect(spearmanRho([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1, 12);
  });

  it("RULE-014 zero-variance series → null (undefined ρ)", () => {
    expect(spearmanRho([1, 1, 1], [1, 2, 3])).toBeNull();
  });

  it("RULE-014 length<2 → null", () => {
    expect(spearmanRho([1], [2])).toBeNull();
  });

  it("RULE-014 unequal lengths throw", () => {
    expect(() => spearmanRho([1, 2], [1, 2, 3])).toThrow();
  });

  it("RULE-014 non-finite value throws RangeError", () => {
    expect(() => tieRanks([1, Number.NaN, 3])).toThrow(RangeError);
  });
});

describe("Shared fence-gap helper (RULE-002 min / RULE-013 mean)", () => {
  // The min-vs-mean split is INTENTIONAL & documented, not drift.
  it("RULE-002 fenceGapMin returns the worst (minimum) fidelity", () => {
    expect(fenceGapMin([0.95, 0.9, 0.99])).toBeCloseTo(0.9, 12);
  });

  it("RULE-002 fenceGapMin of empty → 1 (no touched regions, no penalty)", () => {
    expect(fenceGapMin([])).toBe(1);
  });

  it("RULE-013 fenceGapMean returns the mean fidelity", () => {
    // regions r1:0.9, r2:0.8 → mean fidelity 0.85; the gap (1-mean) is 0.15.
    expect(fenceGapMean([0.9, 0.8])).toBeCloseTo(0.85, 12);
    expect(1 - fenceGapMean([0.9, 0.8])).toBeCloseTo(0.15, 12);
  });

  it("RULE-013 fenceGapMean of empty → 1", () => {
    expect(fenceGapMean([])).toBe(1);
  });

  it("RULE-002/013 min and mean differ for non-uniform fidelities (the intentional split)", () => {
    const fids = [0.5, 1.0];
    expect(fenceGapMin(fids)).toBe(0.5);
    expect(fenceGapMean(fids)).toBeCloseTo(0.75, 12);
  });
});

describe("Pure parsers", () => {
  // RULE-060 — type-error count parse
  it("RULE-060 counts `error TS` lines on a failed run", () => {
    const out = [
      "src/a.ts(1,1): error TS2304: Cannot find name 'x'.",
      "src/b.ts(2,2): error TS2322: Type mismatch.",
      "src/c.ts(3,3): error TS1005: ',' expected.",
      "Found 3 errors.",
    ].join("\n");
    expect(countTypeErrors(out, true)).toBe(3);
  });

  it("RULE-060 failed run with zero matches floors to 1 (|| 1)", () => {
    expect(countTypeErrors("some unparseable crash output", true)).toBe(1);
  });

  it("RULE-060 no command configured → 0", () => {
    expect(countTypeErrors(null, true)).toBe(0);
  });

  it("RULE-060 command succeeded → 0", () => {
    expect(countTypeErrors("src/a.ts: error TS2304", false)).toBe(0);
  });

  // RULE-061 — diffSize from git --shortstat
  it("RULE-061 parses insertions + deletions", () => {
    expect(
      parseDiffSize(" 3 files changed, 12 insertions(+), 7 deletions(-)"),
    ).toBe(19);
  });

  it("RULE-061 missing deletions section → deletions term 0", () => {
    expect(parseDiffSize(" 1 file changed, 5 insertions(+)")).toBe(5);
  });

  it("RULE-061 missing insertions section → insertions term 0", () => {
    expect(parseDiffSize(" 1 file changed, 4 deletions(-)")).toBe(4);
  });

  it("RULE-061 empty/no shortstat → 0", () => {
    expect(parseDiffSize("")).toBe(0);
  });
});
