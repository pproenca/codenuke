import { describe, expect, it } from "@effect/vitest"
import type { Measurement } from "@codenuke/core"
import { decide } from "@codenuke/core"
import { assembleScoreInputs, renderScoreHuman, SCORE_DEFAULT_WEIGHTS } from "../src/score/score.ts"

/**
 * RULE-035 score walking skeleton (Slice 0) — the pure assembly + decide path.
 * The git-backed end-to-end (`scoreCurrentChange`) is proven by the CLI smoke
 * test; here we pin the pure assembly so it stays deterministic and hermetic.
 */

const m = (L: number, complexity: number, dupMass: number): Measurement => ({ L, complexity, dupMass })

describe("RULE-035 score skeleton — assembleScoreInputs", () => {
  it("RULE-035 sets the Slice-0 safety stubs and passes through diffsize/weights", () => {
    const inputs = assembleScoreInputs({ before: m(100, 10, 5), after: m(90, 8, 5), diffsize: 12 })
    expect(inputs.testsPass).toBe(true)
    expect(inputs.fenceUsable).toBe(true)
    expect(inputs.blockedRegions).toEqual([])
    expect(inputs.touchedFidelities).toEqual([]) // ⇒ mfence = 1
    expect(inputs.typeErrors).toBe(0)
    expect(inputs.baselineTypeErrors).toBe(0)
    expect(inputs.diffsize).toBe(12)
    expect(inputs.scales).toBeNull()
    expect(inputs.weights).toEqual(SCORE_DEFAULT_WEIGHTS)
  })

  it("RULE-035 a real reduction (smaller AST, gates pass) is KEPT with loss<0", () => {
    const v = decide(assembleScoreInputs({ before: m(100, 10, 5), after: m(90, 8, 5), diffsize: 10 }))
    expect(v.admissible).toBe(true)
    expect(v.dL).toBe(10)
    expect(v.gain).toBeGreaterThan(0)
    expect(v.mfence).toBe(1) // no touched fidelities ⇒ no fence penalty (Slice 0)
    expect(v.loss).not.toBeNull()
    expect(v.loss! < 0).toBe(true)
    expect(v.keep).toBe(true)
    expect(v.failedGates).toEqual([])
  })

  it("RULE-035/RULE-021 code that GREW (ΔL≤0) fails G4 and is reverted", () => {
    const v = decide(assembleScoreInputs({ before: m(90, 8, 5), after: m(100, 10, 5), diffsize: 10 }))
    expect(v.gates.G4).toBe(false)
    expect(v.admissible).toBe(false)
    expect(v.keep).toBe(false)
    expect(v.failedGates).toContain("G4")
    expect(v.loss).toBeNull() // inadmissible ⇒ loss null (RULE-035)
  })

  it("RULE-035 renderScoreHuman summarizes keep + gates", () => {
    const v = decide(assembleScoreInputs({ before: m(100, 10, 5), after: m(90, 8, 5), diffsize: 10 }))
    const text = renderScoreHuman(v)
    expect(text).toContain("KEEP")
    expect(text).toContain("gates:")
  })
})
