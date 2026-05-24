import { describe, expect, it } from "@effect/vitest"
import {
  chooseRegion,
  LONG_RUN_ITERATIONS,
  READINESS_ORDER,
  type RegionInfo,
  selectMode,
  shouldRequireValueProxyValidation,
} from "../src/orchestrator/orchestrator.ts"

// ---------------------------------------------------------------------------
// PURE decisions — implemented & tested for real.
// ---------------------------------------------------------------------------
describe("orchestrator — RULE-031 (value-proxy required only for long runs)", () => {
  it("RULE-031 iterations=5 → false (boundary is '>', not '≥')", () => {
    expect(shouldRequireValueProxyValidation(5)).toBe(false)
    expect(LONG_RUN_ITERATIONS).toBe(5)
  })
  it("RULE-031 iterations=6 → true", () => {
    expect(shouldRequireValueProxyValidation(6)).toBe(true)
  })
  it("RULE-031 undefined → false (defaults to 5)", () => {
    expect(shouldRequireValueProxyValidation(undefined)).toBe(false)
  })
})

describe("orchestrator — RULE-039 (region & mode selection)", () => {
  const r = (key: string, lo: number, admissible: boolean | undefined): RegionInfo => ({ key, lo, admissible })

  it("RULE-039 blocked regions {a:0.85,b:0.70} → choose a (highest lo), mode raise", () => {
    const chosen = chooseRegion([r("a", 0.85, false), r("b", 0.7, false)])
    expect(chosen?.key).toBe("a")
    expect(selectMode(chosen!)).toBe("raise")
  })

  it("RULE-039 all admissible → first admissible, mode reduce", () => {
    const chosen = chooseRegion([r("a", 0.95, true), r("b", 0.99, true)])
    expect(chosen?.key).toBe("a")
    expect(selectMode(chosen!)).toBe("reduce")
  })

  it("RULE-039 an unmeasured region (admissible undefined) is treated as blocked → raise", () => {
    const chosen = chooseRegion([r("a", 0, undefined)])
    expect(selectMode(chosen!)).toBe("raise")
  })
})

describe("orchestrator — RULE-054 fix (changecost wired into the readiness order)", () => {
  it("RULE-054 READINESS_ORDER includes changecost before value-proxy", () => {
    const cc = READINESS_ORDER.indexOf("changecost-missing")
    const vp = READINESS_ORDER.indexOf("value-proxy-missing")
    expect(cc).toBeGreaterThanOrEqual(0)
    expect(cc).toBeLessThan(vp)
  })
})

// ---------------------------------------------------------------------------
// EFFECTFUL lifecycle — stubbed (wave 2). Names start with their RULE id.
// ---------------------------------------------------------------------------
describe("orchestrator — effectful lifecycle (stubbed for wave 2)", () => {
  it.skip("RULE-030 startup gate fails closed at the FIRST gap (missing fence stops before calibration)", () => {})
  it.skip("RULE-032 doctor collects EVERY readiness gap (no short-circuit), unlike the startup gate", () => {})
  it.todo("RULE-025 reduce-surface path guard reverts edits touching outside the reduce source surface")
  it.todo("RULE-026 raise-surface path guard rejects edits outside the discovered test roots")
  it.todo("RULE-038 reduce iteration: keep ⇒ commit + state.iter+1 + accepted SHA; revert ⇒ state unchanged")
  it.todo("RULE-040 raise iteration: keep iff replay lo > loBefore + 1e-9; else raise-nogain + reset HEAD~1")
  it.skip("RULE-044 scorer manual lifecycle (init / score / accept / revert / status / cleanup)", () => {})
  it.skip("RULE-046 proposer isolation: no node_modules symlink + no benchmark during the proposer run", () => {})
  it.skip("RULE-031 value-proxy startup requirement is enforced for runs > 5 iterations (LONG_RUN_ITERATIONS)", () => {})
})
