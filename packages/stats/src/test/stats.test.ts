// =============================================================================
// CHARACTERIZATION TESTS for legacy/codenuke/loop/stats.mjs
// -----------------------------------------------------------------------------
// These tests pin the *observable behavior* of the two LIVE exports that are
// being migrated:
//
//   - wilson(k, n, z = 1.96)  -> { p, lo, hi }   (RULE-006, P0)
//   - ranks(values)           -> number[]        (RULE-014)
//
// They define the EQUIVALENCE CONTRACT that the new implementation in
// `../main/stats` must satisfy. The legacy module is the ORACLE: every expected
// value below was computed by *running the legacy code*, not by reading a spec.
// If the spec and the legacy ever disagree, these tests follow the legacy and
// the discrepancy is flagged separately.
//
// The other exports in the legacy file (erf, normalCDF, mannWhitney,
// aucFromScores, bootstrapAUC, permutationAUC, bootstrapRatioMedian,
// bootstrapAUCDiff) are confirmed DEAD and are intentionally NOT tested here.
//
// These began as characterization tests written before the implementation; the
// new module now exists and is verified against the legacy ORACLE below via a
// differential (dual-execution) sweep, so this is now an equivalence suite.
// =============================================================================

import { describe, expect, it } from "vitest";
// LEGACY oracle (for dual-execution differential testing):
import {
  ranks as legacyRanks,
  wilson as legacyWilson,
} from "../../../../test-fixtures/legacy-loop/stats.mjs";
// NEW target (not yet written — implemented to satisfy this contract):
import { ranks, wilson } from "../main/stats";

// -----------------------------------------------------------------------------
// Seeded deterministic PRNG (mulberry32) so the property/diff tests are 100%
// reproducible across machines and runs.
// -----------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// =============================================================================
// ranks() — RULE-014: tie-averaged ranks, input order preserved
// =============================================================================
describe("ranks (RULE-014) — tie-averaged ranks preserving input order", () => {
  it("assigns average ranks to ties while preserving original positions", () => {
    // Carried forward verbatim from legacy/codenuke/loop/stats.test.mjs.
    expect(ranks([10, 20, 10, 30])).toEqual([1.5, 3, 1.5, 4]);
  });

  it("returns an empty array for empty input", () => {
    expect(ranks([])).toEqual([]);
  });

  it("ranks a single element as 1", () => {
    expect(ranks([5])).toEqual([1]);
  });

  it("collapses all-equal values to the same averaged rank", () => {
    // Three equal values occupy ranks 1,2,3 -> average (1+2+3)/3 = 2.
    expect(ranks([7, 7, 7])).toEqual([2, 2, 2]);
    // Two equal values occupy ranks 1,2 -> average 1.5.
    expect(ranks([4, 4])).toEqual([1.5, 1.5]);
  });

  it("is identity-like on already-sorted ascending input", () => {
    expect(ranks([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
  });

  it("inverts ranks on reverse-sorted input", () => {
    expect(ranks([4, 3, 2, 1])).toEqual([4, 3, 2, 1]);
  });

  it("handles negative and float values, ties included", () => {
    // Sorted: -5(1), -1(2), -1(3), 0(4), 3.5(5). The two -1s average to 2.5.
    expect(ranks([-1, -5, 0, 3.5, -1])).toEqual([2.5, 1, 4, 5, 2.5]);
  });

  it("handles floats with a leading tie", () => {
    // Sorted: 1.1(1), 2.5(2), 2.5(3). The two 2.5s average to 2.5.
    expect(ranks([2.5, 2.5, 1.1])).toEqual([2.5, 2.5, 1]);
  });
});

// =============================================================================
// wilson() — RULE-006: Wilson score interval for a binomial proportion k/n
// =============================================================================
describe("wilson (RULE-006) — Wilson score interval", () => {
  it("returns the degenerate {p:0, lo:0, hi:1} when n === 0", () => {
    // Carried forward from the legacy test suite.
    expect(wilson(0, 0)).toEqual({ p: 0, lo: 0, hi: 1 });
  });

  it("matches the specified worked example wilson(56, 60)", () => {
    // Carried forward from legacy/codenuke/loop/stats.test.mjs.
    const interval = wilson(56, 60);
    expect(interval.p).toBeCloseTo(56 / 60, 12);
    expect(interval.lo).toBeGreaterThanOrEqual(0.84);
    expect(interval.lo).toBeLessThanOrEqual(0.842);
    expect(interval.hi).toBeGreaterThanOrEqual(0.973);
    expect(interval.hi).toBeLessThanOrEqual(0.975);
  });

  it("pins the exact wilson(56, 60) values produced by the legacy oracle", () => {
    // Exact doubles emitted by running the legacy code. Stronger than the
    // ranged assertions above and protects against silent drift.
    const interval = wilson(56, 60);
    expect(interval.p).toBe(0.9333333333333333);
    expect(interval.lo).toBeCloseTo(0.8407442010623228, 15);
    expect(interval.hi).toBeCloseTo(0.973771725856802, 15);
  });

  it("pins p exactly to k/n on representative cases", () => {
    expect(wilson(0, 10).p).toBe(0);
    expect(wilson(5, 10).p).toBe(0.5);
    expect(wilson(10, 10).p).toBe(1);
  });

  it("pins the symmetric midpoint case wilson(5, 10) from the oracle", () => {
    const interval = wilson(5, 10);
    expect(interval.p).toBe(0.5);
    expect(interval.lo).toBeCloseTo(0.23658959361548731, 15);
    expect(interval.hi).toBeCloseTo(0.7634104063845126, 15);
  });

  it("clamps lo to 0 when k === 0 (all missed)", () => {
    const interval = wilson(0, 10);
    expect(interval.p).toBe(0);
    expect(interval.lo).toBe(0); // Math.max(0, center - half)
    expect(interval.hi).toBeCloseTo(0.2775401687666166, 15);
  });

  it("clamps hi to 1 when k === n (all caught)", () => {
    const interval = wilson(10, 10);
    expect(interval.p).toBe(1);
    expect(interval.hi).toBe(1); // Math.min(1, center + half)
    expect(interval.lo).toBeCloseTo(0.7224598312333834, 15);
  });
});

// =============================================================================
// The load-bearing fence-admissibility property (RULE-006, P0)
// =============================================================================
describe("wilson (RULE-006) — fence admissibility at the 0.90 bar", () => {
  it("requires at least 35 all-caught mutants to admit a region at 0.90", () => {
    // Carried forward from the legacy suite. This is the business-critical
    // boundary: 34/34 is NOT enough, 35/35 IS enough, to clear lo >= 0.90.
    expect(wilson(34, 34).lo).toBeLessThan(0.9);
    expect(wilson(35, 35).lo).toBeGreaterThanOrEqual(0.9);
  });

  it("pins the exact lower bounds at the 34/34 and 35/35 boundary", () => {
    // Exact oracle values straddling the 0.90 fence.
    expect(wilson(34, 34).lo).toBeCloseTo(0.8984820937803899, 15);
    expect(wilson(35, 35).lo).toBeCloseTo(0.9010957324106112, 15);
  });
});

// =============================================================================
// Invariants / property tests
// =============================================================================
describe("wilson (RULE-006) — interval invariants at fixed n", () => {
  it("keeps 0 <= lo <= p <= hi <= 1 and lo monotonic non-decreasing at n=20", () => {
    // Carried forward (and made explicit) from the legacy suite.
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
});

// =============================================================================
// Dual-execution equivalence — the strongest evidence of behavioral parity.
// New implementation MUST agree with the legacy oracle on randomized inputs.
// =============================================================================
describe("dual-execution equivalence vs legacy oracle", () => {
  it("wilson agrees with legacyWilson within 1e-12 over ~1000 random (k,n) pairs", () => {
    const rand = mulberry32(0x9e3779b9);
    const TRIALS = 1000;
    const TOL = 1e-12;

    for (let t = 0; t < TRIALS; t += 1) {
      // 0 <= k <= n <= 200
      const n = Math.floor(rand() * 201);
      const k = Math.floor(rand() * (n + 1));

      const got = wilson(k, n);
      const want = legacyWilson(k, n);

      // p, lo, hi must all match the oracle within tolerance.
      expect(Math.abs(got.p - want.p)).toBeLessThanOrEqual(TOL);
      expect(Math.abs(got.lo - want.lo)).toBeLessThanOrEqual(TOL);
      expect(Math.abs(got.hi - want.hi)).toBeLessThanOrEqual(TOL);
    }
  });

  it("wilson agrees with legacyWilson across the full enumerated 0..n, n=0..50 grid", () => {
    // Exhaustive small grid complements the randomized sweep above.
    const TOL = 1e-12;
    for (let n = 0; n <= 50; n += 1) {
      for (let k = 0; k <= n; k += 1) {
        const got = wilson(k, n);
        const want = legacyWilson(k, n);
        expect(Math.abs(got.p - want.p)).toBeLessThanOrEqual(TOL);
        expect(Math.abs(got.lo - want.lo)).toBeLessThanOrEqual(TOL);
        expect(Math.abs(got.hi - want.hi)).toBeLessThanOrEqual(TOL);
      }
    }
  });

  it("ranks deep-equals legacyRanks over ~500 random arrays (with duplicates)", () => {
    const rand = mulberry32(0x1234abcd);
    const TRIALS = 500;

    for (let t = 0; t < TRIALS; t += 1) {
      const len = Math.floor(rand() * 51); // length 0..50
      const values: number[] = [];
      for (let i = 0; i < len; i += 1) {
        // Small integer range (0..7) to force frequent ties; occasionally
        // sprinkle a fractional value so floats are exercised too.
        const base = Math.floor(rand() * 8);
        values.push(rand() < 0.15 ? base + 0.5 : base);
      }

      // Exact structural equality — ranks must be byte-for-byte identical.
      expect(ranks(values)).toEqual(legacyRanks(values));
    }
  });
});

// =============================================================================
// Input validation — DELIBERATE DEVIATION from legacy.
// Legacy emitted NaN-poisoned results on bad input; the modern P0 gate fails
// loud with a RangeError. This deviation is confined to the invalid-input domain
// the dual-execution sweep above never exercises, so equivalence is preserved.
// =============================================================================
describe("input validation (modern deviation: fail loud, not silent NaN)", () => {
  it("wilson throws on non-integer, negative, or k > n inputs", () => {
    expect(() => wilson(80, 60)).toThrow(RangeError); // k > n
    expect(() => wilson(-1, 10)).toThrow(RangeError); // negative k
    expect(() => wilson(5, 1.5)).toThrow(RangeError); // non-integer n
    expect(() => wilson(Number.NaN, 10)).toThrow(RangeError); // NaN k
  });

  it("wilson throws on invalid custom z values", () => {
    expect(() => wilson(5, 10, Number.NaN)).toThrow(RangeError);
    expect(() => wilson(5, 10, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => wilson(5, 10, -1.96)).toThrow(RangeError);
    expect(() => wilson(5, 10, 0)).not.toThrow();
  });

  it("wilson still accepts the valid degenerate and boundary cases", () => {
    expect(() => wilson(0, 0)).not.toThrow();
    expect(() => wilson(10, 10)).not.toThrow();
    expect(() => wilson(0, 10)).not.toThrow();
  });

  it("ranks throws on non-finite values", () => {
    expect(() => ranks([1, Number.NaN, 3])).toThrow(RangeError);
    expect(() => ranks([1, Number.POSITIVE_INFINITY])).toThrow(RangeError);
  });

  it("ranks still accepts empty and finite (incl. negative/float) inputs", () => {
    expect(() => ranks([])).not.toThrow();
    expect(() => ranks([-1, 2.5, 0])).not.toThrow();
  });
});
