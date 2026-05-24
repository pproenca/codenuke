/**
 * Change-Cost ground truth (C11) — periodic artifact.
 *
 * PURE math implemented for real and tested:
 *  - RULE-012  editCost — LCS token edit size
 *  - RULE-011  cost = editTokens + β·verifyFrac (β=60); 𝒱̂ = mean over done
 *  - RULE-013  verifyCost — mean fence gap (uses core's fenceGapMean if exported)
 *
 * STUBBED (effectful):
 *  - RULE-052  git ref/pathspec safety (pure validators live in ../git/git.ts)
 *  - RULE-055  changecost implementer-surface guard
 *  - the SDK implementer + artifact writer (ChangeCostServiceLive)
 *
 * Cross-package contract: `EditCostResult`, `BenchmarkDelta`, `ChangeCostResult`,
 * `ChangeCostArtifact`, `ChangeCostArtifactStatus` come from `@codenuke/core`.
 * The shared fence-gap helper (min for risk vs mean for cost) lives in
 * `core/kernel`; if `fenceGapMean` is exported there, the live wiring imports it.
 * Below is a local mean implementation used by the pure cost math + tests.
 */
import { Context, Data, Effect, Layer } from "effect"

// ---------------------------------------------------------------------------
// Constants — preserved exactly.
// ---------------------------------------------------------------------------
/** RULE-011 — cost weight β default (env CN_BETA). */
export const DEFAULT_BETA = 60

// ---------------------------------------------------------------------------
// Local error fallback.
// ---------------------------------------------------------------------------
export class ChangeCostInvalid extends Data.TaggedError("ChangeCostInvalid")<{
  readonly message: string
}> {}

// ---------------------------------------------------------------------------
// RULE-012 — editCost via rolling-array LCS over token streams (PURE).
// ---------------------------------------------------------------------------

/** RULE-012 — tokenize source into JS-ish tokens (identifiers / numbers / single
 * punctuation) for LCS edit sizing. Whitespace-insensitive. */
export const tokenize = (s: string): string[] => s.match(/[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|[^\s]/gu) ?? []

/**
 * Longest-common-subsequence length over two token arrays (rolling array, O(min)).
 */
export const lcsLength = (a: readonly string[], b: readonly string[]): number => {
  const n = a.length
  const m = b.length
  if (n === 0 || m === 0) return 0
  // Iterate over the longer dim outside, shorter inside, for the rolling array.
  let prev = new Array<number>(m + 1).fill(0)
  let curr = new Array<number>(m + 1).fill(0)
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, curr[j - 1]!)
    }
    const tmp = prev
    prev = curr
    curr = tmp
    curr.fill(0)
  }
  return prev[m]!
}

/**
 * RULE-012 — edit size between two token streams:
 *   editSize = (n − lcs) + (m − lcs)
 * empty a ⇒ m; empty b ⇒ n; identical ⇒ 0.
 */
export const editSize = (a: readonly string[], b: readonly string[]): number => {
  const lcs = lcsLength(a, b)
  return a.length - lcs + (b.length - lcs)
}

export interface PerFileEdit {
  readonly rel: string
  readonly before: readonly string[]
  readonly after: readonly string[]
}

/** RULE-012 — total editTokens = Σ editSize over changed counted source files. */
export const editTokensOf = (files: readonly PerFileEdit[]): number =>
  files.reduce((sum, f) => sum + editSize(f.before, f.after), 0)

// ---------------------------------------------------------------------------
// RULE-013 — verifyCost = mean fence gap (PURE).
// ---------------------------------------------------------------------------

export interface FenceRegions {
  readonly [region: string]: { readonly p: number } | undefined
}

/** Fidelity of a region from the fence artifact, defaulting to 0 when absent. */
export const fidelityOf = (fence: FenceRegions, region: string): number => fence[region]?.p ?? 0

/**
 * RULE-013 — verifyFrac = regions.length===0 ? 0 : Σ(1 − fidelity(r))/n.
 * NOTE: this MEAN aggregation differs from RULE-002's `mfence` (a MIN) on
 * purpose. When no fence artifact exists the CALLER substitutes verifyFrac = 1
 * (changecost.ts:594) — this function does not special-case null fence.
 */
export const verifyFrac = (regions: readonly string[], fence: FenceRegions): number => {
  if (regions.length === 0) return 0
  let sum = 0
  for (const r of regions) sum += 1 - fidelityOf(fence, r)
  return sum / regions.length
}

// ---------------------------------------------------------------------------
// RULE-011 — cost & 𝒱̂ (PURE).
// ---------------------------------------------------------------------------

/** RULE-011 — cost = editTokens + β·verifyFrac. */
export const costOf = (editTokens: number, vFrac: number, beta: number = DEFAULT_BETA): number =>
  editTokens + beta * vFrac

/** RULE-011 — 𝒱̂ = mean(costs over status==="done"), or null when none. */
export const vhatOf = (doneCosts: readonly number[]): number | null => {
  if (doneCosts.length === 0) return null
  return doneCosts.reduce((a, b) => a + b, 0) / doneCosts.length
}

// ---------------------------------------------------------------------------
// ChangeCostService (C11) — implementer + artifact IO. STUB.
//
// RULE-052 (ref/pathspec safety) reuses ../git/git.ts pure validators.
// RULE-055 (implementer-surface guard) is the effectful dirty-set check below.
// ---------------------------------------------------------------------------
export type ChangeCostStatus = "impl-fail" | "impl-bad-surface" | "not-done" | "done"

export interface ChangeCostResult {
  readonly id: string
  readonly status: ChangeCostStatus
  readonly editTokens?: number
  readonly filesTouched?: number
  readonly regions?: readonly string[]
  readonly verifyFrac?: number
  readonly cost?: number
  readonly disallowed?: readonly string[]
}

export class ChangeCostService extends Context.Tag("@codenuke/runtime/ChangeCostService")<
  ChangeCostService,
  {
    /** Run the held-out benchmark suite against `ref`, write changecost.json. */
    readonly run: (ref: string, beta: number) => Effect.Effect<readonly ChangeCostResult[]>
  }
>() {}

export const ChangeCostServiceLive = Layer.succeed(
  ChangeCostService,
  ChangeCostService.of({
    run: () =>
      Effect.die("unimplemented: RULE-055 implementer-surface + changecost artifact IO (ChangeCostServiceLive)"),
  }),
)
