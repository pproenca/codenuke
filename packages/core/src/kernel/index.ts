/**
 * The pure kernel — the judge's decision logic and statistical primitives.
 * NO Effect, NO IO: every function here is `(input) ⇒ output`. This is what
 * keeps the keep/revert decision immutable, trivially testable, and impossible
 * for the proposer to tamper with (RULE-046 enforced structurally).
 *
 * Constants are preserved EXACTLY from BEHAVIOR_CONTRACT.md. Where the contract's
 * stated THEN is the source of truth, code comments cite the rule.
 */
import type {
  CalibrationScales,
  Gates,
  GateName,
  Measurement,
  ScoreInputs,
  Verdict,
  Weights,
  WilsonInterval,
} from "../domain/index.ts";

/** Z_95 — hardcoded 95% quantile (stats.ts:13). */
export const Z_95 = 1.96;

/**
 * RULE-002 — the per-line diffsize coefficient. HARDCODED INLINE in legacy (the
 * only scoring weight not exposed to config). Preserved verbatim.
 */
export const DIFFSIZE_COEFF = 0.002;

// ---------------------------------------------------------------------------
// RULE-001 — gain: weighted, scaled axis reduction
// ---------------------------------------------------------------------------

/**
 * A calibration scale overrides the per-axis weight-default scale only when it is
 * positive-finite (RULE-001 AND-clause, guarded by RULE-023). Otherwise we fall
 * back to the weight default — never dividing by zero or a bad scale.
 */
const pickScale = (override: number | undefined, fallback: number): number =>
  override !== undefined && Number.isFinite(override) && override > 0
    ? override
    : fallback;

/**
 * RULE-001 — `gain = W.dL·(ΔL/scaleL) + W.dCx·(ΔCx/scaleCx) + W.dDup·(ΔDup/scaleDup)`
 * where `scaleX = scales?.sX ?? W.scaleX` (calibration overrides default when usable).
 * Deltas are SIGNED (RULE-059): before − after.
 */
export const gain = (
  before: Measurement,
  after: Measurement,
  weights: Weights,
  scales?: CalibrationScales | null,
): number => {
  const dL = before.L - after.L;
  const dCx = before.complexity - after.complexity;
  const dDup = before.dupMass - after.dupMass;

  const scaleL = pickScale(scales?.sL, weights.scaleL);
  const scaleCx = pickScale(scales?.sCx, weights.scaleCx);
  const scaleDup = pickScale(scales?.sDup, weights.scaleDup);

  return (
    weights.dL * (dL / scaleL) +
    weights.dCx * (dCx / scaleCx) +
    weights.dDup * (dDup / scaleDup)
  );
};

// ---------------------------------------------------------------------------
// RULE-002 — risk: diffsize + fence-gap penalty
// ---------------------------------------------------------------------------

/**
 * RULE-002 — `risk = 0.002·diffsize + W.r3·(1 − mfence)` where
 * `mfence = touchedFidelities.length ? min(...touchedFidelities) : 1`.
 * A missing per-region fidelity is passed as 0 by the caller, driving mfence→0
 * (fail-toward-risk).
 *
 * `mfence` here is the fence-gap aggregated as MIN — see fenceGapMin. This is the
 * INTENTIONAL min-vs-mean split with changecost (which uses the mean, RULE-013).
 */
export const risk = (
  diffsize: number,
  mfence: number,
  weights: Weights,
): number => DIFFSIZE_COEFF * diffsize + weights.r3 * (1 - mfence);

// ---------------------------------------------------------------------------
// RULE-035 — loss / keep
// ---------------------------------------------------------------------------

/**
 * RULE-035 — `loss = admissible ? (risk − gain) : Infinity`; the reported loss
 * field is `null` when non-finite. This helper returns the RAW loss number
 * (Infinity for inadmissible); `decide` maps non-finite → null for the Verdict.
 */
export const computeLoss = (gainValue: number, riskValue: number): number =>
  riskValue - gainValue;

// ---------------------------------------------------------------------------
// RULE-018..021 — the four gates
// ---------------------------------------------------------------------------

/**
 * RULE-018/019/020/021 — derive the four boolean gates from ScoreInputs.
 *   G1      = testsPass                                  (RULE-018)
 *   G1prime = fenceUsable ∧ blockedRegions.length === 0  (RULE-019)
 *   G3      = typeErrors ≤ baselineTypeErrors            (RULE-020)
 *   G4      = (before.L − after.L) > 0                   (RULE-021, RULE-059)
 */
export const gates = (inputs: ScoreInputs): Gates => {
  const dL = inputs.before.L - inputs.after.L;
  return {
    G1: inputs.testsPass,
    G1prime: inputs.fenceUsable && inputs.blockedRegions.length === 0,
    G3: inputs.typeErrors <= inputs.baselineTypeErrors,
    G4: dL > 0,
  };
};

/** Ordered list of gate names for failedGates enumeration (RULE-063 fix). */
const GATE_NAMES: readonly GateName[] = ["G1", "G1prime", "G3", "G4"];

// ---------------------------------------------------------------------------
// RULE-035 / RULE-059 / RULE-063 — the master decision
// ---------------------------------------------------------------------------

/**
 * RULE-035 — the keep/revert master decision (the single most important output).
 *   admissible = G1 ∧ G1′ ∧ G3 ∧ G4
 *   loss       = admissible ? (risk − gain) : Infinity; reported as null when non-finite
 *   keep       = admissible ∧ loss < 0   (break-even loss==0 is REJECTED — "no gain")
 *
 * RULE-059 — exposes SIGNED per-axis deltas (no clamp).
 * RULE-063 FIX — `failedGates` lists ALL failing gates, not just the highest-priority one.
 */
export const decide = (inputs: ScoreInputs): Verdict => {
  const g = gates(inputs);
  const admissible = g.G1 && g.G1prime && g.G3 && g.G4;

  const dL = inputs.before.L - inputs.after.L;
  const dCx = inputs.before.complexity - inputs.after.complexity;
  const dDup = inputs.before.dupMass - inputs.after.dupMass;

  const mfence = inputs.touchedFidelities.length
    ? fenceGapMin(inputs.touchedFidelities)
    : 1;

  const gainValue = gain(inputs.before, inputs.after, inputs.weights, inputs.scales);
  const riskValue = risk(inputs.diffsize, mfence, inputs.weights);

  // RULE-035: loss is Infinity when inadmissible; null in the Verdict when non-finite.
  const rawLoss = admissible ? computeLoss(gainValue, riskValue) : Infinity;
  const loss = Number.isFinite(rawLoss) ? rawLoss : null;

  // RULE-035: keep iff admissible AND loss strictly < 0 (break-even rejected).
  const keep = admissible && loss !== null && loss < 0;

  // RULE-063 FIX: surface EVERY failing gate, in canonical order.
  const failedGates = GATE_NAMES.filter((name) => g[name] === false);

  return {
    gain: gainValue,
    risk: riskValue,
    loss,
    keep,
    admissible,
    gates: g,
    failedGates,
    dL,
    dCx,
    dDup,
    mfence,
  };
};

// ---------------------------------------------------------------------------
// RULE-006 — Wilson score interval
// ---------------------------------------------------------------------------

/**
 * RULE-006 — Wilson score interval for a binomial proportion.
 *   p = k/n; center = (p + z²/2n)/(1 + z²/n)
 *   halfWidth = z·√(p(1−p)/n + z²/4n²)/(1 + z²/n)
 *   lo = max(0, center − halfWidth); hi = min(1, center + halfWidth)
 * n=0 → degenerate {p:0, lo:0, hi:1} (fail-closed for unmeasured regions).
 */
export const wilson = (caught: number, total: number): WilsonInterval => {
  if (total <= 0) {
    return { p: 0, lo: 0, hi: 1 };
  }
  const z = Z_95;
  const n = total;
  const p = caught / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const halfWidth =
    (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return {
    p,
    lo: Math.max(0, center - halfWidth),
    hi: Math.min(1, center + halfWidth),
  };
};

// ---------------------------------------------------------------------------
// RULE-014 — tie-averaged ranks & Spearman ρ
// ---------------------------------------------------------------------------

/**
 * RULE-014 — assign each value its 1-based rank; ties receive the midpoint rank
 * of their span: `(start+end)/2 + 1` (0-based indices over the sorted order).
 * Throws RangeError on any non-finite value (legacy parity).
 */
export const tieRanks = (xs: readonly number[]): number[] => {
  for (const x of xs) {
    if (!Number.isFinite(x)) {
      throw new RangeError("ranks: non-finite value");
    }
  }
  const n = xs.length;
  // sort indices by value ascending (stable, preserving input order on ties)
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    const va = xs[a]!;
    const vb = xs[b]!;
    return va === vb ? a - b : va - vb;
  });
  const ranks = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    // advance over a span of equal values
    while (j + 1 < n && xs[order[j + 1]!]! === xs[order[i]!]!) {
      j += 1;
    }
    // midpoint rank of the tie span [i, j]: (i + j)/2 + 1 (1-based)
    const midRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) {
      ranks[order[k]!] = midRank;
    }
    i = j + 1;
  }
  return ranks;
};

/** Pearson correlation; returns null on length<2, length mismatch, or zero variance. */
const pearson = (a: readonly number[], b: readonly number[]): number | null => {
  const n = a.length;
  if (n !== b.length || n < 2) return null;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i += 1) {
    sa += a[i]!;
    sb += b[i]!;
  }
  const ma = sa / n;
  const mb = sb / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i]! - ma;
    const db = b[i]! - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va === 0 || vb === 0) return null; // zero variance → undefined ρ
  return cov / Math.sqrt(va * vb);
};

/**
 * RULE-014 — `spearmanRho = pearson(ranks(left), ranks(right))`.
 * Returns null for length<2, zero-variance, or unequal lengths (mapped from the
 * legacy NaN — RankCorrelationUndefined in the effectful caller, RULE-028).
 * Throws RangeError (via tieRanks) on non-finite inputs.
 */
export const spearmanRho = (
  a: readonly number[],
  b: readonly number[],
): number | null => {
  if (a.length !== b.length) {
    throw new RangeError("spearmanRho: unequal lengths");
  }
  if (a.length < 2) return null;
  return pearson(tieRanks(a), tieRanks(b));
};

// ---------------------------------------------------------------------------
// RULE-002 / RULE-013 — the ONE shared fence-gap helper (min vs mean split)
// ---------------------------------------------------------------------------

/**
 * RULE-002 — MIN aggregation: worst-region fidelity, used for SCORING risk
 * (`mfence`). Empty input → 1 (no touched regions ⇒ no penalty).
 *
 * The min-vs-mean split (this vs fenceGapMean) is INTENTIONAL and DOCUMENTED, not
 * drift: scoring penalizes the worst region; changecost averages the gap.
 */
export const fenceGapMin = (fids: readonly number[]): number =>
  fids.length === 0 ? 1 : Math.min(...fids);

/**
 * RULE-013 — MEAN aggregation: mean fidelity across touched regions, used for
 * CHANGE-COST verifyFrac. Empty input → 1 here to match the scoring convention
 * for "no touched regions"; the changecost caller separately substitutes
 * verifyFrac=1 for a null fence and 0 for empty regions (see RULE-013 note —
 * that null/empty ordering is the caller's responsibility, kept out of this leaf).
 *
 * NOTE: this helper returns the mean FIDELITY; the changecost "gap" is `1 − mean`.
 * Kept as mean-fidelity so the two aggregators (min/mean) share the same input
 * contract; the caller subtracts from 1 as needed.
 */
export const fenceGapMean = (fids: readonly number[]): number => {
  if (fids.length === 0) return 1;
  let sum = 0;
  for (const f of fids) sum += f;
  return sum / fids.length;
};

// ---------------------------------------------------------------------------
// RULE-060 — type-error count parse helper
// ---------------------------------------------------------------------------

/**
 * RULE-060 — count `error TS` lines in typecheck output.
 *   count = (lines matching /error TS/).length || 1   when the command ran-and-failed
 *   count = 0                                          when no command / it succeeded
 * The `|| 1` floor prevents an unparseable failure from reading clean.
 *
 * @param output  raw typecheck stdout/stderr; `null` ⇒ no command configured.
 * @param failed  true iff the command ran and exited non-zero.
 */
export const countTypeErrors = (
  output: string | null,
  failed: boolean,
): number => {
  if (output === null || !failed) return 0;
  const matches = output.split(/\r?\n/).filter((line) => /error TS/.test(line));
  return matches.length || 1;
};

// ---------------------------------------------------------------------------
// RULE-061 — diffSize from `git --shortstat`
// ---------------------------------------------------------------------------

/**
 * RULE-061 — parse a `git diff --shortstat` line into a diffsize:
 *   diffsize = Number(/(\d+) insert/ ?? 0) + Number(/(\d+) delet/ ?? 0)
 * A missing insert/delete section parses to 0. The git invocation itself is the
 * runtime's job; this is the PURE parser.
 */
export const parseDiffSize = (shortstat: string): number => {
  const ins = shortstat.match(/(\d+) insert/);
  const del = shortstat.match(/(\d+) delet/);
  const insertions = ins ? Number(ins[1]) : 0;
  const deletions = del ? Number(del[1]) : 0;
  return insertions + deletions;
};
