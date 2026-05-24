/**
 * Spearman rank correlation + its one-sided permutation significance test.
 *
 * Migrated from `legacy/codenuke/loop/value-proxy.mjs`. Reuses `ranks` from the
 * already-migrated `@codenuke/stats` slice (the strangler fig connecting slices).
 * The arithmetic and the seeded sampler are preserved exactly so p-values are
 * bit-for-bit equivalent to legacy (proven by the dual-execution diff tests).
 *
 * @see analysis/codenuke/BUSINESS_RULES.md — RULE-014, RULE-015
 */

import { ranks } from "@codenuke/stats";

/** Options for the permutation test. Omitted fields fall back to the legacy defaults. */
export interface PermutationOptions {
  /** Enumerate exactly while `n! ≤ exactCap`; otherwise sample. Default `362880` (9!). */
  readonly exactCap?: number;
  /** Sample count on the sampled path. Default `50000`. */
  readonly samples?: number;
  /** PRNG seed for the sampled path. Default `0x9e3779b9`. */
  readonly seed?: number;
}

/** Result of {@link spearmanPValue}. */
export interface PValueResult {
  /** One-sided p-value (H1: positive rank correlation). */
  readonly p: number;
  /** Which branch produced it. */
  readonly method: "exact" | "sampled" | "degenerate";
  /** Permutations evaluated (`0` for degenerate, `count` for exact, `samples` for sampled). */
  readonly permutations: number;
}

/** Pearson correlation; `NaN` when either vector has zero variance. */
function pearson(left: readonly number[], right: readonly number[]): number {
  const n = left.length;
  const meanLeft = left.reduce((sum, value) => sum + value, 0) / n;
  const meanRight = right.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let leftSquares = 0;
  let rightSquares = 0;
  for (let index = 0; index < n; index += 1) {
    const leftDelta = left[index] - meanLeft;
    const rightDelta = right[index] - meanRight;
    numerator += leftDelta * rightDelta;
    leftSquares += leftDelta * leftDelta;
    rightSquares += rightDelta * rightDelta;
  }
  const denominator = Math.sqrt(leftSquares * rightSquares);
  return denominator === 0 ? NaN : numerator / denominator;
}

/**
 * Spearman rank correlation ρ between two equal-length series (**RULE-014**):
 * Pearson on the tie-averaged ranks of each series.
 *
 * @returns ρ in `[-1, 1]`, or `NaN` for fewer than 2 points / zero-variance ranks
 * @throws {Error} if the inputs differ in length
 */
export function spearmanRho(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length) throw new Error("spearman inputs must have equal length");
  if (left.length < 2) return NaN;
  return pearson(ranks(left), ranks(right));
}

function factorial(n: number): number {
  // n ≥ 171 overflows to Infinity — intentionally safe: Infinity > any finite
  // exactCap, so it routes to the sampled path and never drives enumeration.
  let f = 1;
  for (let i = 2; i <= n; i += 1) f *= i;
  return f;
}

/** mulberry32 — tiny seeded PRNG; keeps the sampled permutation test deterministic. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lazily enumerate every permutation of `values` (Heap-free, allocation-per-yield). */
function* permute(values: readonly number[]): Generator<number[]> {
  if (values.length <= 1) {
    yield [...values];
    return;
  }
  for (let i = 0; i < values.length; i += 1) {
    const rest = [...values.slice(0, i), ...values.slice(i + 1)];
    for (const tail of permute(rest)) yield [values[i], ...tail];
  }
}

/**
 * One-sided permutation test for H1 = positive rank correlation (**RULE-015**):
 * higher proxy ranks with lower change-cost. Exact enumeration when `n!` is small
 * (`≤ exactCap`, default 9! so n ≤ 9 is exact); otherwise a fixed-seed sample with
 * add-one smoothing (so it never reports `p = 0`).
 *
 * The famous n=3 trap: even a perfect ρ=1 yields `p = 1/3! ≈ 0.167`, so a
 * 3-candidate "PASS" is statistically vacuous — this is intentional.
 *
 * @throws {Error} if the inputs differ in length
 */
export function spearmanPValue(
  left: readonly number[],
  right: readonly number[],
  options: PermutationOptions = {},
): PValueResult {
  const n = left.length;
  if (n !== right.length) throw new Error("spearman inputs must have equal length");

  const observed = spearmanRho(left, right);
  if (!Number.isFinite(observed)) return { p: 1, method: "degenerate", permutations: 0 };

  const eps = 1e-9;
  // 9!. Deliberately NOT env-configurable: a large exactCap on a big n would force
  // O(n!) enumeration, so it must never be wired to untrusted config.
  const exactCap = options.exactCap ?? 362880;
  if (factorial(n) <= exactCap) {
    let ge = 0;
    let count = 0;
    for (const perm of permute(right)) {
      if (spearmanRho(left, perm) >= observed - eps) ge += 1;
      count += 1;
    }
    return { p: ge / count, method: "exact", permutations: count };
  }

  const draws = options.samples ?? 50000;
  const rng = mulberry32(options.seed ?? 0x9e3779b9);
  const pool = [...right];
  let ge = 1; // pre-count the observed arrangement → add-one smoothing, never p = 0
  for (let s = 0; s < draws; s += 1) {
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    if (spearmanRho(left, pool) >= observed - eps) ge += 1;
  }
  return { p: ge / (draws + 1), method: "sampled", permutations: draws };
}
