import { describe, expect, it } from "@effect/vitest"
import {
  type ProgressEvent,
  toNdjson,
  type VerdictLike,
} from "../src/progress/progress.ts"

const verdict = (failedGates: VerdictLike["failedGates"]): VerdictLike => ({
  admissible: failedGates.length === 0,
  keep: false,
  loss: failedGates.length === 0 ? -1.2 : null,
  gain: 2.35,
  risk: 0.2,
  mfence: 0.9,
  gates: {
    G1: !failedGates.includes("G1"),
    G1prime: !failedGates.includes("G1prime"),
    G3: !failedGates.includes("G3"),
    G4: !failedGates.includes("G4"),
  },
  failedGates,
})

describe("progress — RULE-063 (Scored serializes ALL failedGates)", () => {
  it("RULE-063 a Scored event serializes failedGates with multiple concurrent failures", () => {
    const ev: ProgressEvent = { _tag: "Scored", verdict: verdict(["G1prime", "G3", "G4"]) }
    const obj = JSON.parse(toNdjson(ev))
    expect(obj.type).toBe("scored")
    // The legacy verdictLabel would mask all but "G1′ fence"; the fix surfaces all.
    expect(obj.failedGates).toEqual(["G1prime", "G3", "G4"])
    expect(obj.blocked).toBe(true)
  })

  it("RULE-063 a clean keep verdict serializes an empty failedGates and blocked=false", () => {
    const ev: ProgressEvent = { _tag: "Scored", verdict: { ...verdict([]), keep: true } }
    const obj = JSON.parse(toNdjson(ev))
    expect(obj.failedGates).toEqual([])
    expect(obj.blocked).toBe(false)
    expect(obj.keep).toBe(true)
  })

  it("RULE-063 toNdjson emits exactly one line (no embedded newline)", () => {
    const ev: ProgressEvent = { _tag: "Scored", verdict: verdict(["G4"]) }
    expect(toNdjson(ev).includes("\n")).toBe(false)
  })
})

describe("progress — ProgressEvent ADT serialization", () => {
  it("RULE-063 RunStarted / RegionSelected / KeptOrReverted round-trip to NDJSON", () => {
    expect(JSON.parse(toNdjson({ _tag: "RunStarted", iterations: 5, baselineSha: "abc" }))).toEqual({
      type: "runStarted",
      iterations: 5,
      baselineSha: "abc",
    })
    expect(JSON.parse(toNdjson({ _tag: "RegionSelected", region: "scorer", mode: "reduce" }))).toEqual({
      type: "regionSelected",
      region: "scorer",
      mode: "reduce",
    })
    expect(JSON.parse(toNdjson({ _tag: "KeptOrReverted", kept: true, reason: "loss<0" }))).toEqual({
      type: "keptOrReverted",
      kept: true,
      reason: "loss<0",
    })
  })
})
