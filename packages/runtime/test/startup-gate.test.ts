import { describe, expect, it } from "@effect/vitest"
import {
  type ArtifactReadiness,
  collectGaps,
  firstGap,
  shouldRequireValueProxyValidation,
} from "../src/orchestrator/orchestrator.ts"

/**
 * RULE-030/031/054 — the fail-closed startup gate (pure readiness logic). The
 * git-backed `startupGate` (reads .codenuke/*.json) is proven by the CLI smoke;
 * here we pin the ordering, the RULE-054 changecost inclusion, and the RULE-031
 * value-proxy gating, hermetically.
 */

const ready = (over: Partial<ArtifactReadiness> = {}): ArtifactReadiness => ({
  fencePresent: true,
  fenceUsable: true,
  hasMeasuredRegion: true,
  calibrationPresent: true,
  calibrationUsable: true,
  changecostPresent: true,
  changecostUsable: true,
  valueProxyPresent: true,
  valueProxyUsable: true,
  ...over,
})

describe("RULE-030 fail-closed startup gate", () => {
  it("RULE-030 fully-unready ⇒ first gap is fence-missing", () => {
    const r: ArtifactReadiness = {
      fencePresent: false,
      fenceUsable: false,
      hasMeasuredRegion: false,
      calibrationPresent: false,
      calibrationUsable: false,
      changecostPresent: false,
      changecostUsable: false,
      valueProxyPresent: false,
      valueProxyUsable: false,
    }
    expect(firstGap(r, false)?.kind).toBe("fence-missing")
  })

  it("RULE-030 fully-ready (short run) ⇒ no gap", () => {
    expect(firstGap(ready(), false)).toBeNull()
  })

  it("RULE-032 doctor collects EVERY gap in canonical order (no short-circuit)", () => {
    const r: ArtifactReadiness = {
      fencePresent: false,
      fenceUsable: false,
      hasMeasuredRegion: false,
      calibrationPresent: false,
      calibrationUsable: false,
      changecostPresent: false,
      changecostUsable: false,
      valueProxyPresent: false,
      valueProxyUsable: false,
    }
    const kinds = collectGaps(r, true).map((g) => g.kind)
    expect(kinds).toEqual([
      "fence-missing",
      "calibration-missing",
      "changecost-missing",
      "value-proxy-missing",
    ])
  })
})

describe("RULE-054 changecost is gated (the un-wired-in-legacy fix)", () => {
  it("RULE-054 fence+calibration ready but changecost missing ⇒ changecost-missing gap", () => {
    const gap = firstGap(ready({ changecostPresent: false, changecostUsable: false }), false)
    expect(gap?.kind).toBe("changecost-missing")
  })

  it("RULE-054 changecost is gated BEFORE value-proxy", () => {
    const kinds = collectGaps(
      ready({
        changecostPresent: false,
        changecostUsable: false,
        valueProxyPresent: false,
        valueProxyUsable: false,
      }),
      true,
    ).map((g) => g.kind)
    expect(kinds.indexOf("changecost-missing")).toBeLessThan(kinds.indexOf("value-proxy-missing"))
  })
})

describe("RULE-031 value-proxy required only for long runs", () => {
  it("RULE-031 short run (≤5) does NOT require value-proxy", () => {
    expect(shouldRequireValueProxyValidation(5)).toBe(false)
    expect(firstGap(ready({ valueProxyPresent: false, valueProxyUsable: false }), false)).toBeNull()
  })

  it("RULE-031 long run (>5) DOES require value-proxy", () => {
    expect(shouldRequireValueProxyValidation(6)).toBe(true)
    expect(
      firstGap(ready({ valueProxyPresent: false, valueProxyUsable: false }), true)?.kind,
    ).toBe("value-proxy-missing")
  })
})
