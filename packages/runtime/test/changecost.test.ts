import { describe, expect, it } from "@effect/vitest"
import {
  costOf,
  DEFAULT_BETA,
  editSize,
  editTokensOf,
  lcsLength,
  verifyFrac,
  vhatOf,
} from "../src/periodic/changecost.ts"

describe("changecost — RULE-012 (editCost LCS token edit size)", () => {
  it("RULE-012 identical before/after → editSize 0", () => {
    expect(editSize(["a", "b", "c"], ["a", "b", "c"])).toBe(0)
  })

  it("RULE-012 [a,b,c] vs [a,x,c] (lcs=2) → editSize == 2", () => {
    expect(lcsLength(["a", "b", "c"], ["a", "x", "c"])).toBe(2)
    expect(editSize(["a", "b", "c"], ["a", "x", "c"])).toBe(2)
  })

  it("RULE-012 empty a → m; empty b → n", () => {
    expect(editSize([], ["a", "b"])).toBe(2)
    expect(editSize(["a", "b", "c"], [])).toBe(3)
  })

  it("RULE-012 total editTokens sums per-file edit sizes", () => {
    const total = editTokensOf([
      { rel: "a.ts", before: ["a", "b", "c"], after: ["a", "x", "c"] }, // 2
      { rel: "b.ts", before: ["p"], after: ["p"] }, // 0
    ])
    expect(total).toBe(2)
  })
})

describe("changecost — RULE-013 (verifyCost mean fence gap)", () => {
  it("RULE-013 fidelities {r1:0.9,r2:0.8} → verifyFrac == 0.15", () => {
    const fence = { r1: { p: 0.9 }, r2: { p: 0.8 } }
    expect(verifyFrac(["r1", "r2"], fence)).toBeCloseTo(0.15, 12)
  })

  it("RULE-013 empty regions → 0", () => {
    expect(verifyFrac([], {})).toBe(0)
  })

  it("RULE-013 a missing region fidelity defaults to 0 (gap 1)", () => {
    expect(verifyFrac(["unknown"], {})).toBe(1)
  })
})

describe("changecost — RULE-011 (cost = editTokens + β·verifyFrac; 𝒱̂ = mean over done)", () => {
  it("RULE-011 editTokens=100, verifyFrac=0.5, β=60 → cost == 130", () => {
    expect(costOf(100, 0.5, 60)).toBe(130)
  })

  it("RULE-011 β defaults to 60", () => {
    expect(DEFAULT_BETA).toBe(60)
    expect(costOf(100, 0.5)).toBe(130)
  })

  it("RULE-011 𝒱̂ == mean(costs over done)", () => {
    expect(vhatOf([130, 70])).toBe(100)
  })

  it("RULE-011 no done results → 𝒱̂ == null", () => {
    expect(vhatOf([])).toBeNull()
  })
})
