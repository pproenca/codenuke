import { describe, expect, it } from "@effect/vitest"
import {
  metricContext,
  scoreEnvelope,
  type GateName,
  type ScoreEnvelope,
  type Verdict,
} from "@codenuke/core"
import { Effect, Stream } from "effect"
import {
  ProgressBus,
  ProgressBusLive,
  type ProgressEvent,
  renderTty,
  toNdjson,
} from "../src/progress/progress.ts"

const metric = metricContext({
  confidence: "bootstrap",
  weights: {
    dL: 1,
    dCx: 1.8,
    dDup: 0.35,
    scaleL: 150,
    scaleCx: 15,
    scaleDup: 5,
    r3: 1,
  },
  provenance: {
    baselineSha: "a".repeat(40),
    configHash: "config",
    artifactHashes: {},
    toolchain: {},
  },
})

const verdict = (failedGates: readonly GateName[], keep = false): Verdict => ({
  admissible: failedGates.length === 0,
  keep,
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
  dL: 12,
  dCx: 1,
  dDup: 0,
})

const envelope = (failedGates: readonly GateName[], keep = false): ScoreEnvelope =>
  scoreEnvelope({ verdict: verdict(failedGates, keep), metric })

describe("progress — Scored emits the v2 envelope only", () => {
  it("serializes failedGates through envelope.verdict with multiple concurrent failures", () => {
    const ev: ProgressEvent = { _tag: "Scored", envelope: envelope(["G1prime", "G3", "G4"]) }
    const obj = JSON.parse(toNdjson(ev))
    expect(obj.schemaVersion).toBe(2)
    expect(obj._tag).toBe("Scored")
    expect(obj.verdict.failedGates).toEqual(["G1prime", "G3", "G4"])
    expect(obj.status).toBe("rejected")
  })

  it("serializes a clean keep as an accepted v2 envelope", () => {
    const ev: ProgressEvent = { _tag: "Scored", envelope: envelope([], true) }
    const obj = JSON.parse(toNdjson(ev))
    expect(obj.verdict.failedGates).toEqual([])
    expect(obj.status).toBe("accepted")
    expect(obj.verdict.keep).toBe(true)
    expect("blocked" in obj).toBe(false)
    expect("keep" in obj).toBe(false)
  })

  it("RULE-063 toNdjson emits exactly one line (no embedded newline)", () => {
    const ev: ProgressEvent = { _tag: "Scored", envelope: envelope(["G4"]) }
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

  it("serializes compact loop phase and run-finished events", () => {
    expect(JSON.parse(toNdjson({ _tag: "IterationStarted", iter: 2, total: 5 }))).toEqual({
      type: "iterationStarted",
      iter: 2,
      total: 5,
    })
    expect(JSON.parse(toNdjson({ _tag: "PhaseFinished", iter: 2, phase: "tests", ok: false, ms: 123 }))).toEqual({
      type: "phaseFinished",
      iter: 2,
      phase: "tests",
      ok: false,
      ms: 123,
    })
    expect(JSON.parse(toNdjson({ _tag: "RunFinished", kept: 1, reverted: 1, iterations: 2, reductionPct: 4.2, resultRef: null }))).toEqual({
      type: "runFinished",
      kept: 1,
      reverted: 1,
      iterations: 2,
      reductionPct: 4.2,
      resultRef: null,
    })
  })

  it("serializes proposer events compactly without raw agent text", () => {
    const long = "x".repeat(300)
    const command = JSON.parse(toNdjson({ _tag: "ProposerEvent", ev: { _tag: "CommandExecution", command: long } }))
    expect(command.type).toBe("proposer")
    expect(command.kind).toBe("CommandExecution")
    expect(command.command.length).toBeLessThanOrEqual(160)

    const file = JSON.parse(toNdjson({ _tag: "ProposerEvent", ev: { _tag: "FileChange", path: long } }))
    expect(file.path.length).toBeLessThanOrEqual(240)

    const agent = JSON.parse(toNdjson({ _tag: "ProposerEvent", ev: { _tag: "AgentMessage", text: "secret raw text" } }))
    expect(agent).toEqual({ type: "proposer", kind: "AgentMessage" })
    expect(renderTty({ _tag: "ProposerEvent", ev: { _tag: "AgentMessage", text: "secret raw text" } })).toBe("")
  })
})

describe("progress — ProgressBus shutdown", () => {
  it.effect("drains queued events before ending the renderer stream", () =>
    Effect.gen(function* () {
      const progress = yield* ProgressBus
      yield* progress.emit({ _tag: "RunStarted", iterations: 1, baselineSha: "abc" })
      yield* progress.emit({ _tag: "RunFinished", kept: 0, reverted: 1, iterations: 1, reductionPct: 0, resultRef: null })
      yield* progress.shutdown
      const events = yield* Stream.runCollect(progress.stream)
      expect(Array.from(events).map((ev) => ev._tag)).toEqual(["RunStarted", "RunFinished"])
    }).pipe(Effect.provide(ProgressBusLive)),
  )
})
