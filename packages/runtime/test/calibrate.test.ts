import { describe, expect, it } from "@effect/vitest"
import {
  type CommitDelta,
  DEFAULT_CALIBRATION_SCALES,
  deriveCalibration,
  deriveScales,
  median,
} from "../src/periodic/calibrate.ts"

const d = (dL: number, dCx: number, dDup: number): CommitDelta => ({ dL, dCx, dDup })

describe("calibrate — RULE-010 (scales = median of positive per-axis deltas)", () => {
  it("RULE-010 positive ΔL deltas [100,150,200] across 3 commits → sL == 150 (median)", () => {
    const scales = deriveScales([d(100, 0, 0), d(150, 0, 0), d(200, 0, 0)])
    expect(scales.sL).toBe(150)
  })

  it("RULE-010 < 3 qualifying commits → sL falls back to 150", () => {
    const scales = deriveScales([d(100, 0, 0), d(150, 0, 0)])
    expect(scales.sL).toBe(DEFAULT_CALIBRATION_SCALES.sL)
  })

  it("RULE-010 even count [100,200] → median == 150", () => {
    expect(median([100, 200])).toBe(150)
  })

  it("RULE-010 median([]) == 0 and a zero-median axis falls back to default", () => {
    expect(median([])).toBe(0)
    // 3 qualifying commits but ΔCx all zero ⇒ no positive ΔCx ⇒ fall back.
    const scales = deriveScales([d(100, 0, 0), d(150, 0, 0), d(200, 0, 0)])
    expect(scales.sCx).toBe(DEFAULT_CALIBRATION_SCALES.sCx)
  })

  it("RULE-010 deriveCalibration reports provenance (commitsSampled / enoughHistory)", () => {
    const c = deriveCalibration([d(100, 1, 1), d(150, 2, 2), d(200, 3, 3)])
    expect(c.commitsSampled).toBe(3)
    expect(c.enoughHistory).toBe(true)
    expect(c.scales.sL).toBe(150)
  })
})
