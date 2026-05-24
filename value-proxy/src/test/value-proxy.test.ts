// =============================================================================
// CHARACTERIZATION TESTS for legacy/codenuke/loop/value-proxy.mjs
// -----------------------------------------------------------------------------
// Second strangler-fig slice. These tests pin the *observable behavior* of the
// legacy module so the rewrite can be proven equivalent. The legacy module is
// the ORACLE: every literal expected value below was computed by RUNNING the
// legacy code, not by reading a spec. If spec and legacy ever disagree, the
// test follows the legacy and the discrepancy is flagged separately.
//
// Rules covered:
//   - RULE-014  spearmanRho(left, right) -> number   (tie-averaged ranks via
//               the already-migrated `ranks` from @codenuke/stats)
//   - RULE-015  spearmanPValue(left, right, options?) -> { p, method, permutations }
//               one-sided permutation test (exact | sampled | degenerate)
//   - RULE-027  validateValueProxy effect-size gate (low-rho / undefined-rank)
//   - RULE-028  validateValueProxy significance gate (not-significant / pass)
//   - RULE-029  validateValueProxy corpus-size gate (too-small-corpus) +
//               config / input orchestration (parseValidationOptions,
//               parseCandidates, runValidation)
//
// The legacy module exports ONLY three functions (spearmanRho, spearmanPValue,
// validateValueProxy); those are diffed directly against the new target via a
// dual-execution sweep. parseValidationOptions / parseCandidates / runValidation
// have NO legacy export — they are characterized from the legacy private logic
// (validationOptionsFromEnv / readCandidates) and the CLI `if (import.meta…)`
// block, which builds the invalid-config / malformed-input report variants.
//
// These were authored before the implementation exists; once `../main/spearman`
// and `../main/value-proxy` are written they become an equivalence suite.
// =============================================================================

import { describe, expect, it } from "vitest";

// NEW target (implemented after this contract is approved):
import { spearmanPValue, spearmanRho } from "../main/spearman";
import {
  parseCandidates,
  parseValidationOptions,
  runValidation,
  validateValueProxy,
} from "../main/value-proxy";

// LEGACY oracle (for dual-execution differential testing). The legacy file
// exports exactly these three symbols and nothing else.
import {
  spearmanPValue as legacySpearmanPValue,
  spearmanRho as legacySpearmanRho,
  validateValueProxy as legacyValidateValueProxy,
} from "../../../test-fixtures/legacy-loop/value-proxy.mjs";

// -----------------------------------------------------------------------------
// Seeded deterministic PRNG — replicates the legacy mulberry32 EXACTLY.
// NOTE: the legacy implementation has NO `a |= 0` line (unlike the copy in the
// @codenuke/stats test). We mirror it verbatim so input generation is identical
// to what the legacy permutation sampler would see, and the suite is 100%
// reproducible across machines and runs.
// -----------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A perfectly rank-correlated corpus of n candidates (higher proxy <-> lower
// Vhat). Carried over verbatim from the legacy test helper.
const monotoneCorpus = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `c${i}`, proxy: i + 1, Vhat: (n - i) * 10 }));

// =============================================================================
// PART 1 — Carried forward: every assertion from
// legacy/codenuke/loop/value-proxy.test.mjs is preserved here.
//
// The five CLI tests in the legacy suite drove the binary via spawnSync against
// a fixture .codenuke/value-proxy.json file. The modernization removes file I/O
// from the unit under test (runValidation is a PURE orchestrator), so those CLI
// scenarios are carried forward as runValidation cases that assert the SAME
// report fields the legacy CLI wrote to value-proxy-validation.json. See PART 7.
// =============================================================================

describe("Spearman rho — carried forward from legacy suite", () => {
  it("detects positive and negative rank correlation", () => {
    expect(spearmanRho([1, 2, 3], [10, 20, 30])).toBeCloseTo(1, 12);
    expect(spearmanRho([1, 2, 3], [30, 20, 10])).toBeCloseTo(-1, 12);
  });

  it("handles tied ranks with average ranks", () => {
    expect(spearmanRho([1, 1, 2, 3], [10, 10, 20, 30])).toBeCloseTo(1, 12);
  });
});

describe("Spearman permutation p-value — carried forward from legacy suite", () => {
  it("returns the exact one-sided p for small n by enumeration", () => {
    // n=3 perfect correlation: only 1 of 3! orderings reaches rho=1 -> p = 1/6.
    const { p, method, permutations } = spearmanPValue([1, 2, 3], [10, 20, 30]);
    expect(method).toBe("exact");
    expect(permutations).toBe(6);
    expect(p).toBeCloseTo(1 / 6, 12);
  });

  it("reproduces the codecharter n=3 result as non-significant (p ≈ 0.333)", () => {
    // The 2026-05-22 codecharter run: proxy vs -Vhat with a tie (Vhat 17,17,14).
    const { p } = spearmanPValue([4.2, 4.36, 5.88], [-17, -17, -14]);
    expect(p).toBeCloseTo(1 / 3, 12);
  });

  it("falls to a deterministic sample beyond the exact cap", () => {
    const proxy = monotoneCorpus(12).map((c) => c.proxy);
    const negVhat = monotoneCorpus(12).map((c) => -c.Vhat);
    const a = spearmanPValue(proxy, negVhat);
    const b = spearmanPValue(proxy, negVhat);
    expect(a.method).toBe("sampled");
    expect(a.p).toBe(b.p); // same seed -> identical p (INV-5)
    expect(a.p).toBeLessThanOrEqual(0.05);
  });
});

describe("value proxy validation — carried forward from legacy suite", () => {
  it(
    "passes when a large enough corpus tracks change-cost significantly",
    () => {
      const report = validateValueProxy(monotoneCorpus(9));

      expect(report).toMatchObject({
        passed: true,
        reason: null,
        rho: 1,
        minimumRho: 0.6,
        alpha: 0.05,
        pMethod: "exact",
        candidates: 9,
      });
      expect(report.pValue).toBeLessThanOrEqual(0.05);
    },
    15000,
  );

  it("fails closed by default for the legacy n=3 trap under the reimagined minimum of 6", () => {
    const report = validateValueProxy([
      { id: "small", proxy: 1, Vhat: 30 },
      { id: "medium", proxy: 2, Vhat: 20 },
      { id: "large", proxy: 3, Vhat: 10 },
    ]);

    expect(report).toMatchObject({
      passed: false,
      reason: "too-small-corpus",
      rho: null,
      candidates: 3,
      minimumCandidates: 6,
    });
    expect(report.pValue).toBeNull();
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

  it("reports low-rho before significance when the effect size is wrong", () => {
    const report = validateValueProxy(
      monotoneCorpus(9).map((c) => ({ ...c, Vhat: -c.Vhat })), // flip -> anti-correlated
    );

    expect(report).toMatchObject({ passed: false, reason: "low-rho", candidates: 9 });
  });
});

// =============================================================================
// PART 2 — spearmanRho (RULE-014): exact known cases + edges
// =============================================================================
describe("spearmanRho (RULE-014) — exact known cases and edges", () => {
  it("returns ρ = 1 for a perfectly positive monotone relationship", () => {
    expect(spearmanRho([1, 2, 3, 4, 5], [10, 20, 30, 40, 50])).toBe(1);
  });

  it("returns ρ = -1 for a perfectly negative monotone relationship", () => {
    expect(spearmanRho([1, 2, 3, 4, 5], [50, 40, 30, 20, 10])).toBe(-1);
  });

  it("uses tie-averaged ranks (leading tie still yields ρ = 1)", () => {
    expect(spearmanRho([1, 1, 2, 3], [10, 10, 20, 30])).toBeCloseTo(1, 12);
  });

  it("returns NaN for length < 2 (single element)", () => {
    expect(spearmanRho([5], [5])).toBeNaN();
  });

  it("returns NaN for empty inputs (length 0 < 2)", () => {
    expect(spearmanRho([], [])).toBeNaN();
  });

  it("throws on unequal lengths with the legacy message", () => {
    expect(() => spearmanRho([1, 2], [1, 2, 3])).toThrow(
      "spearman inputs must have equal length",
    );
  });

  it("returns NaN for a degenerate (zero-variance) input vector", () => {
    // Constant left vector -> zero rank variance -> Pearson denominator 0 -> NaN.
    expect(spearmanRho([2, 2, 2], [1, 2, 3])).toBeNaN();
    expect(spearmanRho([1, 2, 3], [7, 7, 7])).toBeNaN();
  });
});

// =============================================================================
// PART 3 — spearmanPValue (RULE-015): exact / degenerate / sampled paths
// =============================================================================
describe("spearmanPValue (RULE-015) — exact enumeration path", () => {
  it("documents the n=3 vacuity: even perfect ρ=1 gives p = 1/6 (method exact)", () => {
    const result = spearmanPValue([1, 2, 3], [10, 20, 30]);
    expect(result.method).toBe("exact");
    expect(result.permutations).toBe(6); // 3!
    expect(result.p).toBeCloseTo(1 / 6, 12);
    expect(result.p).toBe(0.16666666666666666); // exact oracle double
  });

  it("enumerates n=4 (4! = 24) deterministically on the exact path", () => {
    const proxy = [1, 2, 3, 4];
    const negVhat = [-40, -30, -20, -10];
    const result = spearmanPValue(proxy, negVhat);
    expect(result.method).toBe("exact");
    expect(result.permutations).toBe(24);
    expect(result.p).toBeCloseTo(1 / 24, 12);
  });

  it("stays exact at the n=8 boundary (8! = 40320 ≤ default cap 9!)", () => {
    const proxy = Array.from({ length: 8 }, (_, i) => i + 1);
    const negVhat = Array.from({ length: 8 }, (_, i) => -(8 - i) * 10);
    const result = spearmanPValue(proxy, negVhat);
    expect(result.method).toBe("exact");
    expect(result.permutations).toBe(40320);
    expect(result.p).toBeCloseTo(1 / 40320, 15);
  });
});

describe("spearmanPValue (RULE-015) — degenerate path", () => {
  it("returns { p: 1, method: 'degenerate', permutations: 0 } when ρ is non-finite", () => {
    expect(spearmanPValue([2, 2, 2], [1, 2, 3])).toEqual({
      p: 1,
      method: "degenerate",
      permutations: 0,
    });
  });

  it("treats length < 2 (NaN ρ) as degenerate", () => {
    expect(spearmanPValue([5], [5])).toEqual({ p: 1, method: "degenerate", permutations: 0 });
  });
});

describe("spearmanPValue (RULE-015) — forced sampled path", () => {
  // exactCap: 1 forces total = n! > cap so the sampler is always used; a fixed
  // seed makes it deterministic; samples kept small for speed.
  const SAMPLED = { exactCap: 1, samples: 500, seed: 0x12345 } as const;

  it("uses the sampler and reports method 'sampled' with permutations === samples", () => {
    const proxy = [1, 2, 3, 4];
    const negVhat = [-40, -30, -20, -10];
    const result = spearmanPValue(proxy, negVhat, SAMPLED);
    expect(result.method).toBe("sampled");
    expect(result.permutations).toBe(500);
  });

  it("add-one smoothing means p > 0 always, with p = ge/(samples+1)", () => {
    const proxy = [1, 2, 3, 4];
    const negVhat = [-40, -30, -20, -10];
    const result = spearmanPValue(proxy, negVhat, SAMPLED);
    expect(result.p).toBeGreaterThan(0);
    // p must be representable as ge/(samples+1) for an integer ge in [1, samples+1].
    const ge = result.p * (500 + 1);
    expect(Math.abs(ge - Math.round(ge))).toBeLessThan(1e-9);
    expect(Math.round(ge)).toBeGreaterThanOrEqual(1); // observed arrangement is pre-counted
    // Exact oracle: this seed+input yields ge = 22 -> p = 22/501.
    expect(result.p).toBe(22 / 501);
  });

  it("is reproducible: same seed + options -> identical p", () => {
    const proxy = monotoneCorpus(12).map((c) => c.proxy);
    const negVhat = monotoneCorpus(12).map((c) => -c.Vhat);
    const a = spearmanPValue(proxy, negVhat, SAMPLED);
    const b = spearmanPValue(proxy, negVhat, SAMPLED);
    expect(a.p).toBe(b.p);
    expect(a.method).toBe("sampled");
  });

  it("never reports p = 0 even when no permutation matches (smoothing floor)", () => {
    // Strongly anti-correlated observed ρ is the easiest to beat, so ge is large;
    // an easy-to-beat case still floors at 1/(samples+1). Use a hard-to-beat ρ.
    const proxy = monotoneCorpus(12).map((c) => c.proxy);
    const negVhat = monotoneCorpus(12).map((c) => -c.Vhat); // perfect ρ -> hardest to beat
    const result = spearmanPValue(proxy, negVhat, { exactCap: 1, samples: 200, seed: 7 });
    expect(result.p).toBeGreaterThanOrEqual(1 / (200 + 1));
  });
});

// =============================================================================
// PART 4 — validateValueProxy (RULE-027/028/029): one case per reason branch
// Full report shape is asserted, with negVhat = -Vhat mapping verified.
// =============================================================================
describe("validateValueProxy (RULE-027/028/029) — reason branches and report shape", () => {
  it("too-small-corpus: fewer candidates than minimumCandidates (default 6)", () => {
    const rows = [
      { id: "one", proxy: 1, Vhat: 1 },
      { id: "two", proxy: 2, Vhat: 2 },
    ];
    const report = validateValueProxy(rows);
    expect(report).toEqual({
      passed: false,
      reason: "too-small-corpus",
      candidates: 2,
      minimumCandidates: 6,
      minimumRho: 0.6,
      alpha: 0.05,
      rho: null,
      pValue: null,
      pMethod: null,
      rows,
    });
  });

  it("undefined-rank-correlation: non-finite ρ on a large-enough corpus", () => {
    // Constant proxy column -> zero rank variance -> ρ is NaN even though n ≥ 6.
    const rows = Array.from({ length: 6 }, (_, index) => ({
      id: `c${index}`,
      proxy: 5,
      Vhat: index + 1,
    }));
    const report = validateValueProxy(rows);
    expect(report).toEqual({
      passed: false,
      reason: "undefined-rank-correlation",
      candidates: 6,
      minimumCandidates: 6,
      minimumRho: 0.6,
      alpha: 0.05,
      rho: null,
      pValue: null,
      pMethod: null,
      rows,
    });
  });

  it("low-rho: ρ below minimumRho is rejected before significance is even checked", () => {
    const rows = monotoneCorpus(9).map((c) => ({ ...c, Vhat: -c.Vhat })); // anti-correlated
    const report = validateValueProxy(rows);
    expect(report).toMatchObject({
      passed: false,
      reason: "low-rho",
      candidates: 9,
      minimumCandidates: 6,
      minimumRho: 0.6,
      alpha: 0.05,
      rho: -1,
      pValue: 1,
      pMethod: "exact",
      rows,
    });
  });

  it("not-significant: ρ ≥ 0.6 but p > α when the legacy minimum is configured", () => {
    const rows = [
      { id: "small", proxy: 1, Vhat: 30 },
      { id: "medium", proxy: 2, Vhat: 20 },
      { id: "large", proxy: 3, Vhat: 10 },
    ];
    const report = validateValueProxy(rows, { minimumCandidates: 3 });
    expect(report).toMatchObject({
      passed: false,
      reason: "not-significant",
      candidates: 3,
      minimumCandidates: 3,
      minimumRho: 0.6,
      alpha: 0.05,
      rho: 1,
      pMethod: "exact",
      rows,
    });
    expect(report.pValue).toBeCloseTo(1 / 6, 12);
    expect(report.pValue).toBeGreaterThan(0.05); // p > α
  });

  it("PASS: ρ ≥ 0.6 AND p ≤ α (perfect monotone n=9)", () => {
    const rows = monotoneCorpus(9);
    const report = validateValueProxy(rows);
    expect(report).toMatchObject({
      passed: true,
      reason: null,
      candidates: 9,
      minimumCandidates: 6,
      minimumRho: 0.6,
      alpha: 0.05,
      rho: 1,
      pMethod: "exact",
      rows,
    });
    expect(report.pValue).toBeLessThanOrEqual(0.05);
    expect(report.pValue).toBeCloseTo(1 / 362880, 15); // 1/9!
  });

  it("PASS: imperfect-but-strong ρ (n=6 with a single rank swap) still passes", () => {
    // Pins a non-degenerate PASS where ρ is strictly between 0.6 and 1.
    const rows = [
      { id: "a", proxy: 1, Vhat: 60 },
      { id: "b", proxy: 2, Vhat: 50 },
      { id: "c", proxy: 3, Vhat: 40 },
      { id: "d", proxy: 4, Vhat: 30 },
      { id: "e", proxy: 6, Vhat: 20 },
      { id: "f", proxy: 5, Vhat: 10 },
    ];
    const report = validateValueProxy(rows);
    expect(report.passed).toBe(true);
    expect(report.reason).toBeNull();
    expect(report.pMethod).toBe("exact");
    expect(report.rho).toBeCloseTo(0.9428571428571428, 12);
    expect(report.pValue).toBeCloseTo(0.008333333333333333, 12);
    expect(report.pValue).toBeLessThanOrEqual(0.05);
  });

  it("respects custom thresholds passed via options (and proves negVhat mapping)", () => {
    // With minimumRho raised above the achieved ρ, the SAME corpus flips to low-rho.
    const rows = monotoneCorpus(6).map((c) => ({ ...c, Vhat: c.Vhat })); // perfect ρ=1
    const strict = validateValueProxy(rows, { minimumRho: 0.99, alpha: 0.05 });
    expect(strict.minimumRho).toBe(0.99);
    expect(strict.rho).toBe(1);
    expect(strict.passed).toBe(true); // ρ=1 ≥ 0.99
    // Now make ρ < 0.99 via the swap corpus and tighten the bar.
    const swapped = [
      { id: "a", proxy: 1, Vhat: 60 },
      { id: "b", proxy: 2, Vhat: 50 },
      { id: "c", proxy: 3, Vhat: 40 },
      { id: "d", proxy: 4, Vhat: 30 },
      { id: "e", proxy: 6, Vhat: 20 },
      { id: "f", proxy: 5, Vhat: 10 },
    ];
    const tooStrict = validateValueProxy(swapped, { minimumRho: 0.99 });
    expect(tooStrict.passed).toBe(false);
    expect(tooStrict.reason).toBe("low-rho");
  });

  it("uses the reimagined minimumCandidates default of 6", () => {
    expect(validateValueProxy([{ id: "x", proxy: 1, Vhat: 1 }]).minimumCandidates).toBe(6);
    // Boundary: exactly 6 is NOT too-small (it proceeds to rho/p evaluation).
    const atBoundary = validateValueProxy(monotoneCorpus(6));
    expect(atBoundary.reason).not.toBe("too-small-corpus");
  });
});

// =============================================================================
// PART 5 — parseValidationOptions: defaults + bound validation
// Mirrors legacy validationOptionsFromEnv, including its exact error messages.
// =============================================================================
describe("parseValidationOptions — defaults and bound checks (legacy messages)", () => {
  it("returns the reimagined defaults (0.6 / 6 / 0.05) when env is unset", () => {
    expect(parseValidationOptions({})).toEqual({
      minimumRho: 0.6,
      minimumCandidates: 6,
      alpha: 0.05,
    });
  });

  it("coerces string env values to numbers", () => {
    expect(
      parseValidationOptions({ CN_MIN_RHO: "0.7", CN_MIN_CANDIDATES: "5", CN_ALPHA: "0.1" }),
    ).toEqual({ minimumRho: 0.7, minimumCandidates: 5, alpha: 0.1 });
  });

  it("accepts alpha at the inclusive upper bound 1", () => {
    expect(parseValidationOptions({ CN_ALPHA: "1" }).alpha).toBe(1);
  });

  it("accepts minimumRho at the inclusive bounds -1 and 1", () => {
    expect(parseValidationOptions({ CN_MIN_RHO: "-1" }).minimumRho).toBe(-1);
    expect(parseValidationOptions({ CN_MIN_RHO: "1" }).minimumRho).toBe(1);
  });

  it("throws when CN_MIN_RHO is not a finite number", () => {
    expect(() => parseValidationOptions({ CN_MIN_RHO: "not-a-number" })).toThrow(
      "CN_MIN_RHO must be a finite number between -1 and 1",
    );
  });

  it("throws when CN_MIN_RHO is out of [-1, 1]", () => {
    expect(() => parseValidationOptions({ CN_MIN_RHO: "1.5" })).toThrow(
      "CN_MIN_RHO must be a finite number between -1 and 1",
    );
    expect(() => parseValidationOptions({ CN_MIN_RHO: "-2" })).toThrow(
      "CN_MIN_RHO must be a finite number between -1 and 1",
    );
  });

  it("throws when CN_MIN_CANDIDATES is non-integer", () => {
    expect(() => parseValidationOptions({ CN_MIN_CANDIDATES: "2.5" })).toThrow(
      "CN_MIN_CANDIDATES must be an integer >= 2",
    );
  });

  it("throws when CN_MIN_CANDIDATES is below 2", () => {
    expect(() => parseValidationOptions({ CN_MIN_CANDIDATES: "1" })).toThrow(
      "CN_MIN_CANDIDATES must be an integer >= 2",
    );
  });

  it("throws when CN_ALPHA is ≤ 0", () => {
    expect(() => parseValidationOptions({ CN_ALPHA: "0" })).toThrow(
      "CN_ALPHA must be a finite number in (0, 1]",
    );
  });

  it("throws when CN_ALPHA is > 1", () => {
    expect(() => parseValidationOptions({ CN_ALPHA: "1.5" })).toThrow(
      "CN_ALPHA must be a finite number in (0, 1]",
    );
  });
});

// =============================================================================
// PART 6 — parseCandidates: array / { candidates } shapes, default id, throws
// Mirrors legacy readCandidates but operates on ALREADY-PARSED JSON (no file read).
// =============================================================================
describe("parseCandidates — shape acceptance, id defaulting, finiteness checks", () => {
  it("accepts a bare array", () => {
    expect(parseCandidates([{ id: "x", proxy: 1, Vhat: 2 }])).toEqual([
      { id: "x", proxy: 1, Vhat: 2 },
    ]);
  });

  it("accepts a { candidates: [...] } wrapper", () => {
    expect(parseCandidates({ candidates: [{ id: "y", proxy: 3, Vhat: 4 }] })).toEqual([
      { id: "y", proxy: 3, Vhat: 4 },
    ]);
  });

  it("throws the legacy message when the shape is neither", () => {
    expect(() => parseCandidates({ foo: 1 })).toThrow(
      "expected an array or { candidates: [...] }",
    );
    expect(() => parseCandidates(42)).toThrow("expected an array or { candidates: [...] }");
    expect(() => parseCandidates(null)).toThrow("expected an array or { candidates: [...] }");
  });

  it("defaults a missing id to candidate-<n> (1-based)", () => {
    expect(parseCandidates([{ proxy: 1, Vhat: 2 }, { proxy: 3, Vhat: 4 }])).toEqual([
      { proxy: 1, Vhat: 2, id: "candidate-1" },
      { proxy: 3, Vhat: 4, id: "candidate-2" },
    ]);
  });

  it("preserves an explicit id and any extra fields", () => {
    expect(parseCandidates([{ id: "keep", proxy: 1, Vhat: 2, note: "hi" }])).toEqual([
      { id: "keep", proxy: 1, Vhat: 2, note: "hi" },
    ]);
  });

  it("throws on a non-finite proxy (using the supplied id in the message)", () => {
    expect(() => parseCandidates([{ id: "bad", proxy: null, Vhat: 10 }])).toThrow(
      "candidate bad must include finite proxy and Vhat numbers",
    );
  });

  it("throws on a non-finite Vhat (using the defaulted id in the message)", () => {
    expect(() => parseCandidates([{ proxy: 1, Vhat: Number.NaN }])).toThrow(
      "candidate candidate-1 must include finite proxy and Vhat numbers",
    );
  });

  it("treats Infinity and string numerics as non-finite (finiteNumber semantics)", () => {
    expect(() => parseCandidates([{ id: "inf", proxy: Number.POSITIVE_INFINITY, Vhat: 1 }])).toThrow(
      "candidate inf must include finite proxy and Vhat numbers",
    );
    // finiteNumber requires typeof === "number"; a numeric STRING is rejected.
    expect(() => parseCandidates([{ id: "str", proxy: "1", Vhat: 2 }])).toThrow(
      "candidate str must include finite proxy and Vhat numbers",
    );
  });
});

// =============================================================================
// PART 7 — runValidation: pure orchestrator (parse options + candidates +
// validate). Returns invalid-config / malformed-input report variants in place
// of process.exit, and NEVER touches the filesystem. These cases mirror what
// the legacy CLI block wrote to value-proxy-validation.json — carrying the five
// legacy spawnSync CLI tests forward without spawning a process.
// =============================================================================
describe("runValidation — pure orchestration without file I/O", () => {
  it("returns a normal PASS report for a valid corpus and default env", () => {
    const parsed = {
      candidates: Array.from({ length: 9 }, (_, i) => ({
        id: `c${i}`,
        proxy: i + 1,
        Vhat: (9 - i) * 10,
      })),
    };
    const report = runValidation(parsed, {});
    expect(report).toMatchObject({ passed: true, reason: null, rho: 1, candidates: 9 });
    expect(report.pValue).toBeLessThanOrEqual(0.05);
  });

  it("returns reason 'too-small-corpus' for a valid-but-tiny corpus (legacy CLI parity)", () => {
    const parsed = [
      { id: "one", proxy: 1, Vhat: 1 },
      { id: "two", proxy: 2, Vhat: 2 },
    ];
    const report = runValidation(parsed, {});
    expect(report).toMatchObject({
      passed: false,
      reason: "too-small-corpus",
      candidates: 2,
    });
  });

  it("returns reason 'low-rho' when proxy rank does not track change-cost", () => {
    const parsed = monotoneCorpus(6).map((candidate) => ({ ...candidate, Vhat: -candidate.Vhat }));
    const report = runValidation(parsed, {});
    expect(report).toMatchObject({
      passed: false,
      reason: "low-rho",
      rho: -1,
      candidates: 6,
      minimumRho: 0.6,
    });
  });

  it("returns reason 'malformed-input' (no throw) for bad candidate rows", () => {
    const parsed = { candidates: [{ id: "bad", proxy: null, Vhat: 10 }] };
    const report = runValidation(parsed, {});
    expect(report).toMatchObject({
      passed: false,
      reason: "malformed-input",
      candidates: 0,
      minimumCandidates: 6,
      minimumRho: 0.6,
      alpha: 0.05,
      rho: null,
      pValue: null,
      pMethod: null,
      rows: [],
    });
    expect(report.error).toContain("candidate bad");
  });

  it("malformed-input echoes the parsed option thresholds when env overrides them", () => {
    const parsed = { candidates: [{ id: "bad", proxy: null, Vhat: 10 }] };
    const report = runValidation(parsed, {
      CN_MIN_RHO: "0.7",
      CN_MIN_CANDIDATES: "4",
      CN_ALPHA: "0.1",
    });
    expect(report).toMatchObject({
      reason: "malformed-input",
      minimumCandidates: 4,
      minimumRho: 0.7,
      alpha: 0.1,
    });
  });

  it("returns reason 'invalid-config' (no throw) for bad env thresholds", () => {
    const parsed = {
      candidates: [
        { id: "small", proxy: 1, Vhat: 30 },
        { id: "medium", proxy: 2, Vhat: 20 },
        { id: "large", proxy: 3, Vhat: 10 },
      ],
    };
    const report = runValidation(parsed, { CN_MIN_RHO: "not-a-number" });
    expect(report).toMatchObject({
      passed: false,
      reason: "invalid-config",
      candidates: 0,
      minimumCandidates: 6,
      minimumRho: 0.6,
      alpha: 0.05,
      rho: null,
      pValue: null,
      pMethod: null,
      rows: [],
    });
    expect(report.error).toContain("CN_MIN_RHO");
  });

  it("invalid-config takes precedence over malformed-input (config parsed first)", () => {
    // Bad env AND bad candidates -> the config error wins, matching the legacy
    // CLI order (validationOptionsFromEnv runs before readCandidates).
    const parsed = { candidates: [{ id: "bad", proxy: null, Vhat: 10 }] };
    const report = runValidation(parsed, { CN_ALPHA: "0" });
    expect(report.reason).toBe("invalid-config");
    expect(report.error).toContain("CN_ALPHA");
  });

  it("does not throw on any of the error paths", () => {
    expect(() => runValidation({ foo: 1 }, {})).not.toThrow();
    expect(() => runValidation([], { CN_MIN_RHO: "10" })).not.toThrow();
  });
});

// =============================================================================
// PART 8 — Dual-execution equivalence (strongest evidence).
// The same seeded inputs/options are fed to BOTH the new target and the legacy
// oracle; results must match. Random generation uses the seeded mulberry32
// replicated above so the suite is fully reproducible.
// =============================================================================

// Generate `len` finite numbers in roughly [-1000, 1000) from a seeded RNG.
function randomVector(rand: () => number, len: number): number[] {
  return Array.from({ length: len }, () => (rand() - 0.5) * 2000);
}

describe("dual-execution equivalence — spearmanRho vs legacySpearmanRho", () => {
  it("agrees within 1e-12 over ~500 random finite array pairs", () => {
    const rand = mulberry32(0x9e3779b9);
    const TRIALS = 500;
    const TOL = 1e-12;

    for (let t = 0; t < TRIALS; t += 1) {
      const len = 2 + Math.floor(rand() * 19); // length 2..20 (length>=2 so ρ is defined-ish)
      const left = randomVector(rand, len);
      const right = randomVector(rand, len);

      const got = spearmanRho(left, right);
      const want = legacySpearmanRho(left, right);

      if (Number.isNaN(want)) {
        // Degenerate (zero-variance) draws -> both must agree on NaN.
        expect(Number.isNaN(got)).toBe(true);
      } else {
        expect(Math.abs(got - want)).toBeLessThanOrEqual(TOL);
      }
    }
  });

  it("agrees on the NaN / degenerate domain (length<2 and zero-variance vectors)", () => {
    expect(Number.isNaN(spearmanRho([5], [5]))).toBe(Number.isNaN(legacySpearmanRho([5], [5])));
    expect(Number.isNaN(spearmanRho([1, 1, 1], [1, 2, 3]))).toBe(
      Number.isNaN(legacySpearmanRho([1, 1, 1], [1, 2, 3])),
    );
  });
});

describe("dual-execution equivalence — spearmanPValue vs legacySpearmanPValue", () => {
  it("matches the legacy oracle on the EXACT path (n ≤ 8), p identical", () => {
    const rand = mulberry32(0x1234abcd);
    const TRIALS = 120;

    for (let t = 0; t < TRIALS; t += 1) {
      const len = 2 + Math.floor(rand() * 7); // length 2..8 -> n! ≤ 8! ≤ default cap
      const left = randomVector(rand, len);
      const right = randomVector(rand, len);

      const got = spearmanPValue(left, right);
      const want = legacySpearmanPValue(left, right);

      expect(got.method).toBe(want.method); // "exact" or "degenerate"
      expect(got.permutations).toBe(want.permutations);
      expect(got.p).toBe(want.p); // exact path is fully deterministic -> bit-identical
    }
  });

  it("matches the legacy oracle on the FORCED SAMPLED path with identical options", () => {
    const rand = mulberry32(0x55aa55aa);
    const OPTS = { exactCap: 1, samples: 500, seed: 0x12345 } as const;
    const TRIALS = 60;

    for (let t = 0; t < TRIALS; t += 1) {
      const len = 3 + Math.floor(rand() * 8); // length 3..10
      const left = randomVector(rand, len);
      const right = randomVector(rand, len);

      const got = spearmanPValue(left, right, OPTS);
      const want = legacySpearmanPValue(left, right, OPTS);

      // Same RNG seed inside both samplers -> identical p, method, permutations.
      expect(got.method).toBe(want.method);
      expect(got.permutations).toBe(want.permutations);
      expect(got.p).toBe(want.p);
    }
  });
});

describe("dual-execution equivalence — validateValueProxy vs legacyValidateValueProxy", () => {
  it("produces matching reports over ~100 random candidate sets", () => {
    const rand = mulberry32(0xdeadbeef);
    const TRIALS = 100;
    const TOL = 1e-12;

    for (let t = 0; t < TRIALS; t += 1) {
      const n = Math.floor(rand() * 8); // 0..7 candidates -> exercises too-small + valid corpora
      const candidates = Array.from({ length: n }, (_, i) => ({
        id: `cand-${i}`,
        proxy: (rand() - 0.5) * 100,
        Vhat: (rand() - 0.5) * 100,
      }));

      const got = validateValueProxy(candidates, { minimumCandidates: 3 });
      const want = legacyValidateValueProxy(candidates);

      // Numeric fields compared within tolerance; everything else deep-equal.
      expect(got.passed).toBe(want.passed);
      expect(got.reason).toBe(want.reason);
      expect(got.candidates).toBe(want.candidates);
      expect(got.minimumCandidates).toBe(want.minimumCandidates);
      expect(got.minimumRho).toBe(want.minimumRho);
      expect(got.alpha).toBe(want.alpha);
      expect(got.pMethod).toBe(want.pMethod);
      expect(got.rows).toEqual(want.rows);

      if (want.rho === null) {
        expect(got.rho).toBeNull();
      } else {
        expect(Math.abs((got.rho as number) - want.rho)).toBeLessThanOrEqual(TOL);
      }
      if (want.pValue === null) {
        expect(got.pValue).toBeNull();
      } else {
        expect(Math.abs((got.pValue as number) - want.pValue)).toBeLessThanOrEqual(TOL);
      }
    }
  });

  it("produces matching reports for monotone corpora of every exact-path size n=3..8", () => {
    for (let n = 3; n <= 8; n += 1) {
      const corpus = monotoneCorpus(n);
      const got = validateValueProxy(corpus, { minimumCandidates: 3 });
      const want = legacyValidateValueProxy(corpus);
      expect(got.passed).toBe(want.passed);
      expect(got.reason).toBe(want.reason);
      expect(got.pMethod).toBe(want.pMethod);
      expect(got.rho).toBeCloseTo(want.rho as number, 12);
      expect(got.pValue).toBeCloseTo(want.pValue as number, 12);
    }
  });
});

// =============================================================================
// PART 9 — Hardened non-finite inputs (DELIBERATE DEVIATION; architecture review H3).
// The reused @codenuke/stats `ranks` throws on non-finite values, where legacy
// `ranks` produced silent garbage. So spearmanRho / spearmanPValue now FAIL LOUD
// on non-finite inputs (length >= 2) instead of returning a meaningless number.
// This is consistent with the stats slice's approved "fail loud" deviation and is
// unreachable from value-proxy's own callers (parseCandidates rejects non-finite
// proxy/Vhat). The legacy "behavior" here was undefined garbage, not a contract.
// =============================================================================
describe("non-finite inputs (modern deviation: fail loud via @codenuke/stats ranks)", () => {
  it("spearmanRho throws RangeError on a non-finite value (length >= 2)", () => {
    expect(() => spearmanRho([Number.NaN, 1, 2], [1, 2, 3])).toThrow(RangeError);
    expect(() => spearmanRho([1, 2, 3], [1, Number.POSITIVE_INFINITY, 3])).toThrow(RangeError);
  });

  it("spearmanPValue propagates the RangeError on non-finite input", () => {
    expect(() => spearmanPValue([Number.NaN, 1, 2], [1, 2, 3])).toThrow(RangeError);
  });

  it("still returns NaN (no throw) for length < 2, before ranks is consulted", () => {
    expect(spearmanRho([Number.NaN], [Number.NaN])).toBeNaN();
  });
});
