/**
 * Statistical primitives for codenuke's safety gates.
 *
 * Migrated from `legacy/codenuke/loop/stats.mjs`. Only the two functions with
 * live callers are carried over — the dead toolkit (Mann–Whitney/AUC/bootstrap,
 * erf/normalCDF) was retired per RULE-017. The surviving arithmetic is preserved
 * exactly so the keep/revert decision stays bit-for-bit equivalent to legacy.
 *
 * @see analysis/codenuke/BUSINESS_RULES.md — RULE-006 (P0), RULE-014
 */

/** Default z-score: 1.96 ≈ the 95% two-sided normal quantile (RULE-006). */
const Z_95 = 1.96;

/** A binomial proportion estimate with its Wilson score confidence interval. */
export interface WilsonInterval {
  /** Point estimate `k / n` (`0` when `n === 0`). */
  readonly p: number;
  /** Lower confidence bound, clamped to `[0, 1]`. */
  readonly lo: number;
  /** Upper confidence bound, clamped to `[0, 1]`. */
  readonly hi: number;
}

/**
 * Wilson score interval for a binomial proportion `k / n`.
 *
 * Implements **RULE-006 (P0)**: a behavior-fence region is admissible only when
 * its lower bound `lo` clears the configured threshold (default 0.90) — e.g. it
 * takes ≥ 35/35 caught mutants to admit a region at 0.90.
 *
 * @param k caught count, `0 ≤ k ≤ n`
 * @param n sample size; `n === 0` returns the degenerate `{ p: 0, lo: 0, hi: 1 }`
 * @param z normal quantile; defaults to the 95% two-sided value, 1.96
 * @throws {RangeError} if `k`/`n` are not integers with `0 ≤ k ≤ n` or `z` is
 *   not a finite non-negative number. A P0 gate
 *   must fail loud: an unvalidated bad input produces a `NaN` lower bound, and
 *   `NaN >= 0.90` is `false`, which would silently mark a region inadmissible.
 */
export function wilson(k: number, n: number, z: number = Z_95): WilsonInterval {
  if (!Number.isInteger(k) || !Number.isInteger(n) || n < 0 || k < 0 || k > n) {
    throw new RangeError(`wilson: expected integers 0 <= k <= n, received k=${k}, n=${n}`);
  }
  if (!Number.isFinite(z) || z < 0) {
    throw new RangeError(`wilson: expected finite non-negative z, received z=${z}`);
  }
  if (n === 0) return { p: 0, lo: 0, hi: 1 };

  const p = k / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const halfWidth = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;

  return {
    p,
    lo: Math.max(0, center - halfWidth),
    hi: Math.min(1, center + halfWidth),
  };
}

/**
 * Tie-averaged ranks of `values`, returned in the original input order.
 *
 * Implements **RULE-014**: the primitive the Spearman rank correlation in the
 * value-proxy validation is built on. Ranks are 1-based; tied values share the
 * average of the ranks they span.
 *
 * @param values observations to rank (not mutated); must all be finite
 * @returns an array the same length as `values`, where `result[i]` is the rank of `values[i]`
 * @throws {RangeError} if any value is non-finite. A `NaN` makes the sort order
 *   undefined and breaks tie detection (`NaN !== NaN`), silently producing a
 *   wrong-but-plausible rank vector that would corrupt the downstream Spearman ρ.
 */
export function ranks(values: readonly number[]): number[] {
  for (const value of values) {
    if (!Number.isFinite(value)) {
      throw new RangeError(`ranks: all values must be finite, received ${value}`);
    }
  }

  const ordered = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);

  const result = new Array<number>(values.length);
  for (let start = 0; start < ordered.length; ) {
    let end = start;
    while (end + 1 < ordered.length && ordered[end + 1].value === ordered[start].value) {
      end += 1;
    }
    // midpoint of the 0-based span [start, end], shifted to a 1-based rank
    const averageRank = (start + end) / 2 + 1;
    for (let i = start; i <= end; i += 1) {
      result[ordered[i].index] = averageRank;
    }
    start = end + 1;
  }
  return result;
}
