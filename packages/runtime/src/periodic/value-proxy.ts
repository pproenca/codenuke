/**
 * Value-Proxy validation (C10) — periodic artifact.
 *
 * PURE math implemented for real and tested:
 *  - RULE-014  tie-averaged ranks & Spearman ρ (uses core's tieRanks/spearmanRho)
 *  - RULE-015  one-sided permutation p-value with its OWN PRNG
 *  - RULE-056  exactCap DoS guard (n! > exactCap ⇒ sampled)
 *  - RULE-027/028/029  corpus / effect-size / significance gates
 *
 * The artifact-writing service (`ValueProxyServiceLive`) is a STUB.
 *
 * Cross-package contract: `tieRanks`, `spearmanRho`, `Candidate`,
 * `ValidationReport`, `ValueProxyValidationArtifact`, `CorpusTooSmall`,
 * `RankCorrelationUndefined` come from `@codenuke/core`. core's `tieRanks` /
 * `spearmanRho` are the source of truth — DO NOT reimplement them in production.
 * Below we provide a LOCAL fallback ONLY so this module compiles before core's
 * src exists; the local copies are byte-faithful to the legacy formulae and are
 * what RULE-014's test asserts (it skips if core's exports are unavailable).
 */
import { Context, Data, Effect, Layer } from "effect"

// ---------------------------------------------------------------------------
// Constants — preserved exactly (RULE-015 / RULE-027/028/029).
// ---------------------------------------------------------------------------
/** RULE-015 — permutation PRNG seed (distinct from fence's mulberry32, RULE-008). */
export const PERMUTATION_SEED = 0x9e3779b9
/** RULE-015 — sampled-path draw count. */
export const PERMUTATION_SAMPLES = 50_000
/** RULE-056 — exact-enumeration DoS cap (9!), NOT config-exposed. */
export const EXACT_CAP = 362_880
/** RULE-015 — comparison epsilon. */
export const PERMUTATION_EPS = 1e-9

/** RULE-027 — value-proxy corpus-size floor. */
export const MIN_CANDIDATES = 6
/** RULE-028 — minimum Spearman ρ effect size. */
export const MIN_RHO = 0.6
/** RULE-029 — significance level. */
export const ALPHA = 0.05

// ---------------------------------------------------------------------------
// Local errors (authoritative versions in @codenuke/core).
// ---------------------------------------------------------------------------
export class CorpusTooSmall extends Data.TaggedError("CorpusTooSmall")<{
  readonly candidates: number
  readonly minimum: number
}> {}

export class RankCorrelationUndefined extends Data.TaggedError("RankCorrelationUndefined")<{
  readonly message: string
}> {}

// ---------------------------------------------------------------------------
// LOCAL fallback for ranks/spearman (legacy-faithful). Production must use
// core's exports; see test guard.
// ---------------------------------------------------------------------------

/** Pearson correlation over two equal-length series. NaN on zero variance / n<2. */
const pearson = (a: readonly number[], b: readonly number[]): number => {
  const n = a.length
  if (n < 2 || b.length !== n) return NaN
  let sa = 0
  let sb = 0
  for (let i = 0; i < n; i++) {
    sa += a[i]!
    sb += b[i]!
  }
  const ma = sa / n
  const mb = sb / n
  let cov = 0
  let va = 0
  let vb = 0
  for (let i = 0; i < n; i++) {
    const da = a[i]! - ma
    const db = b[i]! - mb
    cov += da * db
    va += da * da
    vb += db * db
  }
  if (va === 0 || vb === 0) return NaN
  return cov / Math.sqrt(va * vb)
}

/**
 * RULE-014 — tie-averaged ranks. Each tie-span gets its 1-based midpoint rank
 * `(start+end)/2 + 1`, preserving input order. Throws RangeError on non-finite.
 * LOCAL fallback (prefer core's `tieRanks`).
 */
export const tieRanksLocal = (xs: readonly number[]): number[] => {
  for (const x of xs) {
    if (!Number.isFinite(x)) throw new RangeError("ranks: non-finite value")
  }
  const idx = xs.map((_, i) => i).sort((i, j) => xs[i]! - xs[j]!)
  const ranks = new Array<number>(xs.length)
  let i = 0
  while (i < idx.length) {
    let j = i
    while (j + 1 < idx.length && xs[idx[j + 1]!]! === xs[idx[i]!]!) j++
    const rank = (i + j) / 2 + 1 // 1-based midpoint
    for (let k = i; k <= j; k++) ranks[idx[k]!] = rank
    i = j + 1
  }
  return ranks
}

/** RULE-014 — Spearman ρ = pearson(ranks(left), ranks(right)). LOCAL fallback. */
export const spearmanRhoLocal = (left: readonly number[], right: readonly number[]): number => {
  if (left.length !== right.length) throw new RangeError("spearman: unequal lengths")
  if (left.length < 2) return NaN
  return pearson(tieRanksLocal(left), tieRanksLocal(right))
}

// ---------------------------------------------------------------------------
// RULE-015 — one-sided permutation p-value with its OWN PRNG.
// ---------------------------------------------------------------------------

/**
 * The value-proxy PRNG. NOTE (RULE-008 vs RULE-015): this is intentionally
 * DISTINCT from fence's mulberry32 — it does NOT do `a |= 0` per call. Do not
 * unify; unifying silently changes the seeded sample set.
 */
export const makePrng = (seed: number): (() => number) => {
  let a = seed >>> 0
  return () => {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const factorial = (n: number): number => {
  let f = 1
  for (let i = 2; i <= n; i++) f *= i
  return f
}

/**
 * Visit every permutation of indices [0..n) via Heap's algorithm, invoking
 * `visit` with a reused buffer (no materialization — bounds memory at O(n) so
 * the n=9 exact path stays cheap on allocation).
 */
const forEachPermutation = (n: number, visit: (perm: readonly number[]) => void): void => {
  const arr = Array.from({ length: n }, (_, i) => i)
  const c = new Array<number>(n).fill(0)
  visit(arr)
  let i = 0
  while (i < n) {
    if (c[i]! < i) {
      const j = i % 2 === 0 ? 0 : c[i]!
      ;[arr[i], arr[j]] = [arr[j]!, arr[i]!]
      visit(arr)
      c[i] = c[i]! + 1
      i = 0
    } else {
      c[i] = 0
      i++
    }
  }
}

export type PMethod = "exact" | "sampled" | "degenerate"

/**
 * RULE-056 — the exact-vs-sampled path decision for a corpus of size n. Pure &
 * cheap (no enumeration): `n! ≤ exactCap ⇒ "exact"` else `"sampled"`. Exposed
 * so the cap boundary (n=9 exact, n=10 sampled) can be asserted without paying
 * the O(n!) enumeration cost.
 */
export const pMethodForSize = (n: number): "exact" | "sampled" => {
  let f = 1
  for (let i = 2; i <= n && f <= EXACT_CAP; i++) f *= i
  return f <= EXACT_CAP ? "exact" : "sampled"
}

export interface PermutationResult {
  readonly p: number
  readonly method: PMethod
}

/**
 * RULE-015 / RULE-056 — one-sided permutation p-value for an observed ρ.
 *  - non-finite observed ρ          → { p:1, method:"degenerate" }
 *  - n! ≤ exactCap                  → exact enumeration, p = #{ρ ≥ obs−eps}/n!
 *  - else                           → sampled (PERMUTATION_SAMPLES draws,
 *                                      add-one smoothing: ge pre-seeded 1,
 *                                      p = ge/(draws+1))
 * `spearman` is injected so the test can pass core's spearmanRho.
 */
export const permutationPValue = (
  proxy: readonly number[],
  negVhat: readonly number[],
  observedRho: number,
  spearman: (a: readonly number[], b: readonly number[]) => number = spearmanRhoLocal,
): PermutationResult => {
  if (!Number.isFinite(observedRho)) return { p: 1, method: "degenerate" }
  const n = proxy.length
  const nFact = factorial(n)

  // RULE-056 — DoS guard: n! > exactCap (or overflow to Infinity) ⇒ sampled.
  if (nFact <= EXACT_CAP) {
    let ge = 0
    const permuted = new Array<number>(n)
    forEachPermutation(n, (perm) => {
      for (let i = 0; i < n; i++) permuted[i] = negVhat[perm[i]!]!
      const rho = spearman(proxy, permuted)
      if (Number.isFinite(rho) && rho >= observedRho - PERMUTATION_EPS) ge++
    })
    return { p: ge / nFact, method: "exact" }
  }

  // Sampled path with add-one smoothing.
  const rand = makePrng(PERMUTATION_SEED)
  let ge = 1 // add-one smoothing so p > 0
  const shuffled = negVhat.slice()
  for (let s = 0; s < PERMUTATION_SAMPLES; s++) {
    // Fisher–Yates with the value-proxy PRNG.
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
    }
    const rho = spearman(proxy, shuffled)
    if (Number.isFinite(rho) && rho >= observedRho - PERMUTATION_EPS) ge++
  }
  return { p: ge / (PERMUTATION_SAMPLES + 1), method: "sampled" }
}

// ---------------------------------------------------------------------------
// RULE-027/028/029 — value-proxy gate decision (PURE).
// ---------------------------------------------------------------------------
export interface Candidate {
  readonly id: string
  readonly proxy: number
  readonly Vhat: number
  readonly [k: string]: unknown
}

export type ValidationReason =
  | "too-small-corpus"
  | "undefined-rank-correlation"
  | "low-rho"
  | "not-significant"
  | "invalid-config"
  | "malformed-input"

export interface ValidationReport {
  readonly passed: boolean
  readonly reason: ValidationReason | null
  readonly candidates: number
  readonly minimumCandidates: number
  readonly minimumRho: number
  readonly alpha: number
  readonly rho: number | null
  readonly pValue: number | null
  readonly pMethod: PMethod | null
}

export interface ValidationOptions {
  readonly minimumCandidates: number
  readonly minimumRho: number
  readonly alpha: number
}

export const DEFAULT_VALIDATION_OPTIONS: ValidationOptions = {
  minimumCandidates: MIN_CANDIDATES,
  minimumRho: MIN_RHO,
  alpha: ALPHA,
}

/**
 * RULE-027/028/029 — validate the proxy↔𝒱̂ correlation over a candidate corpus.
 * Lexicographic gate order: corpus size → ρ defined → ρ ≥ minRho → p ≤ alpha.
 * `negVhat = −Vhat` so "high proxy ↔ low cost" reads as positive correlation.
 * Pure; `spearman` injectable to use core's implementation.
 */
export const validateValueProxy = (
  candidates: readonly Candidate[],
  options: ValidationOptions = DEFAULT_VALIDATION_OPTIONS,
  spearman: (a: readonly number[], b: readonly number[]) => number = spearmanRhoLocal,
): ValidationReport => {
  const { minimumCandidates, minimumRho, alpha } = options
  const base = {
    candidates: candidates.length,
    minimumCandidates,
    minimumRho,
    alpha,
  }

  // RULE-027 — corpus-size gate (first check).
  if (candidates.length < minimumCandidates) {
    return { ...base, passed: false, reason: "too-small-corpus", rho: null, pValue: null, pMethod: null }
  }

  const proxy = candidates.map((c) => c.proxy)
  const negVhat = candidates.map((c) => -c.Vhat)
  const rho = spearman(proxy, negVhat)

  // RULE-028 — effect-size gate.
  if (!Number.isFinite(rho)) {
    return { ...base, passed: false, reason: "undefined-rank-correlation", rho: null, pValue: null, pMethod: null }
  }
  if (rho < minimumRho) {
    return { ...base, passed: false, reason: "low-rho", rho, pValue: null, pMethod: null }
  }

  // RULE-029 — significance gate.
  const perm = permutationPValue(proxy, negVhat, rho, spearman)
  if (perm.p > alpha) {
    return { ...base, passed: false, reason: "not-significant", rho, pValue: perm.p, pMethod: perm.method }
  }

  return { ...base, passed: true, reason: null, rho, pValue: perm.p, pMethod: perm.method }
}

// ---------------------------------------------------------------------------
// ValueProxyService (C10) — artifact IO. STUB.
// ---------------------------------------------------------------------------
export class ValueProxyService extends Context.Tag("@codenuke/runtime/ValueProxyService")<
  ValueProxyService,
  {
    /** Read candidates, validate, write value-proxy-validation.json. */
    readonly run: (inputPath: string) => Effect.Effect<ValidationReport>
  }
>() {}

export const ValueProxyServiceLive = Layer.succeed(
  ValueProxyService,
  ValueProxyService.of({
    run: () => Effect.die("unimplemented: RULE-024 value-proxy artifact IO (ValueProxyServiceLive)"),
  }),
)
