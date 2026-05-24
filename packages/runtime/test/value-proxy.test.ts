import { describe, expect, it } from "@effect/vitest"
import {
  type Candidate,
  EXACT_CAP,
  PERMUTATION_SEED,
  permutationPValue,
  pMethodForSize,
  spearmanRhoLocal,
  tieRanksLocal,
  validateValueProxy,
} from "../src/periodic/value-proxy.ts"

// ---------------------------------------------------------------------------
// RULE-014 — prefer core's tieRanks/spearmanRho if exported; otherwise fall
// back to the local legacy-faithful copies (and note the substitution).
// ---------------------------------------------------------------------------
let coreTieRanks: ((xs: readonly number[]) => number[]) | undefined
let coreSpearman: ((a: readonly number[], b: readonly number[]) => number) | undefined
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const core = await import("@codenuke/core")
  coreTieRanks = (core as Record<string, unknown>)["tieRanks"] as typeof coreTieRanks
  coreSpearman = (core as Record<string, unknown>)["spearmanRho"] as typeof coreSpearman
} catch {
  // core not built yet — local fallback used.
}

const tieRanks = coreTieRanks ?? tieRanksLocal
const spearman = coreSpearman ?? spearmanRhoLocal

describe("value-proxy — RULE-014 (tie-averaged ranks & Spearman ρ)", () => {
  it("RULE-014 ranks([3,1,2]) == [3,1,2]", () => {
    expect(tieRanks([3, 1, 2])).toEqual([3, 1, 2])
  })

  it("RULE-014 ties [5,5,1] → [2.5,2.5,1]", () => {
    expect(tieRanks([5, 5, 1])).toEqual([2.5, 2.5, 1])
  })

  it("RULE-014 perfectly concordant series → ρ == 1", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 12)
  })

  it("RULE-014 ranks throws on non-finite (local fallback)", () => {
    expect(() => tieRanksLocal([1, NaN, 2])).toThrow(RangeError)
  })
})

describe("value-proxy — RULE-015 / RULE-056 (permutation p-value + DoS guard)", () => {
  it("RULE-015 non-finite ρ → { p:1, method:'degenerate' }", () => {
    const r = permutationPValue([1, 2, 3], [-1, -2, -3], NaN, spearman)
    expect(r).toEqual({ p: 1, method: "degenerate" })
  })

  it("RULE-015 n=4 with ρ=1 (exact path) → p == 1/24 with method 'exact'", () => {
    // proxy and negVhat perfectly concordant ⇒ observed ρ == 1; only the
    // identity permutation reaches ρ ≥ 1−eps over 24 permutations.
    const proxy = [1, 2, 3, 4]
    const negVhat = [10, 20, 30, 40]
    const rho = spearman(proxy, negVhat)
    const r = permutationPValue(proxy, negVhat, rho, spearman)
    expect(r.method).toBe("exact")
    expect(r.p).toBeCloseTo(1 / 24, 12)
  })

  it("RULE-056 n=9 (9! == exactCap) → exact; n=10 (>9!) → sampled (cap boundary)", () => {
    // Assert the path DECISION at the cap boundary without paying O(n!) cost.
    expect(pMethodForSize(9)).toBe("exact")
    expect(pMethodForSize(10)).toBe("sampled")
  })

  it("RULE-056 the sampled path uses add-one smoothing so p > 0", () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => i + 1)
    const n10 = mk(10)
    const r10 = permutationPValue(n10, n10, spearman(n10, n10), spearman)
    expect(r10.method).toBe("sampled")
    expect(r10.p).toBeGreaterThan(0)
  })

  it("RULE-056 exactCap is the hardcoded 9! and not config-derived", () => {
    expect(EXACT_CAP).toBe(362_880)
  })

  it("RULE-015 the permutation seed is the dedicated 0x9e3779b9 (distinct from fence)", () => {
    expect(PERMUTATION_SEED).toBe(0x9e3779b9)
  })
})

describe("value-proxy — RULE-027/028/029 (gates)", () => {
  const mkCorpus = (n: number, rho: "high" | "low"): Candidate[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `c${i}`,
      proxy: i,
      // high proxy ↔ low cost ⇒ negVhat increasing ⇒ positive ρ. "low" weakens it.
      Vhat: rho === "high" ? -i : (i % 2 === 0 ? -i : i),
    }))

  it("RULE-027 5 candidates with minimumCandidates=6 → too-small-corpus", () => {
    const r = validateValueProxy(mkCorpus(5, "high"), undefined, spearman)
    expect(r.reason).toBe("too-small-corpus")
    expect(r.passed).toBe(false)
  })

  it("RULE-028 ρ below minimumRho → low-rho", () => {
    const r = validateValueProxy(mkCorpus(8, "low"), { minimumCandidates: 6, minimumRho: 0.9, alpha: 0.05 }, spearman)
    expect(r.reason).toBe("low-rho")
  })

  it("RULE-028 zero-variance proxy → undefined-rank-correlation", () => {
    const flat: Candidate[] = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, proxy: 1, Vhat: i }))
    const r = validateValueProxy(flat, undefined, spearman)
    expect(r.reason).toBe("undefined-rank-correlation")
  })

  it("RULE-029 a strong, significant corpus passes", () => {
    const r = validateValueProxy(mkCorpus(8, "high"), undefined, spearman)
    expect(r.passed).toBe(true)
    expect(r.reason).toBeNull()
    expect(r.pValue).not.toBeNull()
  })

  it("RULE-029 a high-ρ but non-significant tiny corpus fails not-significant", () => {
    // 6 perfectly-concordant points: ρ==1 but exact p == 1/720 ≈ 0.00139 < 0.05,
    // so it PASSES. Use alpha smaller than the smallest reachable p to force
    // not-significant deterministically.
    const r = validateValueProxy(mkCorpus(6, "high"), { minimumCandidates: 6, minimumRho: 0.6, alpha: 0.0001 }, spearman)
    expect(r.reason).toBe("not-significant")
  })
})
