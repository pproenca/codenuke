import { describe, expect, it } from "@effect/vitest"
import { Either } from "effect"
import {
  decodeEngineState,
  reconcileSha,
  StateInvalid,
  StateStale,
} from "../src/orchestrator/state.ts"

const validRaw = {
  baselineSha: "a".repeat(40),
  baselineTsc: 0,
  startL: 1000,
  accepted: ["abc1234"],
  iter: 2,
}

describe("orchestrator/state — RULE-053 (Schema decode + SHA reconcile)", () => {
  it("RULE-053 a well-formed state decodes successfully", () => {
    const r = decodeEngineState(validRaw)
    expect(Either.isRight(r)).toBe(true)
    if (Either.isRight(r)) expect(r.right.baselineSha).toBe("a".repeat(40))
  })

  it("RULE-053 a non-40-hex baselineSha is StateInvalid", () => {
    const r = decodeEngineState({ ...validRaw, baselineSha: "deadbeef" })
    expect(Either.isLeft(r)).toBe(true)
    if (Either.isLeft(r)) expect(r.left).toBeInstanceOf(StateInvalid)
  })

  it("RULE-053 a non-integer iter is StateInvalid", () => {
    const r = decodeEngineState({ ...validRaw, iter: 1.5 })
    expect(Either.isLeft(r)).toBe(true)
  })

  it("RULE-053 the SCORER and orchestrator share this decoder (CWE-502 fix) — no raw cast", () => {
    // A hand-edited malformed state is rejected, not trusted, by the single reader.
    const r = decodeEngineState({ baselineSha: 123, iter: "x" })
    expect(Either.isLeft(r)).toBe(true)
  })

  it("RULE-053 a SHA that resolves back to itself reconciles", () => {
    const state = Either.getOrThrow(decodeEngineState(validRaw))
    const r = reconcileSha(state, "a".repeat(40))
    expect(Either.isRight(r)).toBe(true)
  })

  it("RULE-053 a SHA mismatch ⇒ StateStale (exit 1, not silent re-init)", () => {
    const state = Either.getOrThrow(decodeEngineState(validRaw))
    const r = reconcileSha(state, "b".repeat(40))
    expect(Either.isLeft(r)).toBe(true)
    if (Either.isLeft(r)) {
      expect(r.left).toBeInstanceOf(StateStale)
      expect(r.left.expectedSha).toBe("a".repeat(40))
      expect(r.left.resolvedSha).toBe("b".repeat(40))
    }
  })
})
