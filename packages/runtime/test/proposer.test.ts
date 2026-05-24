import { describe, expect, it } from "@effect/vitest"
import { Effect, Stream } from "effect"
import {
  fakeProposerStream,
  type ProposerEvent,
  ProposerFailed,
} from "../src/proposer/proposer.ts"

describe("proposer — FakeProposer (deterministic test double)", () => {
  it.effect("RULE-046 FakeProposer emits a scripted CommandExecution→FileChange→AgentMessage→TurnCompleted stream", () =>
    Effect.gen(function* () {
      const events = yield* Stream.runCollect(
        fakeProposerStream({
          commands: ["ls"],
          fileChanges: ["src/a.ts", "src/b.ts"],
          finalMessage: "done",
          usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 0 },
        }),
      )
      const tags = Array.from(events).map((e: ProposerEvent) => e._tag)
      expect(tags).toEqual(["CommandExecution", "FileChange", "FileChange", "AgentMessage", "TurnCompleted"])
    }),
  )

  it.effect("RULE-047 a scripted failure surfaces ProposerFailed (failureClass 'crash')", () =>
    Effect.gen(function* () {
      const exit = yield* Stream.runDrain(fakeProposerStream({ fail: "boom" })).pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
    }),
  )

  it("RULE-047 a scripted failure stream's error is a ProposerFailed value", () =>
    Effect.runSync(
      Stream.runDrain(fakeProposerStream({ fail: "boom" })).pipe(
        Effect.match({
          onFailure: (e) => {
            expect(e).toBeInstanceOf(ProposerFailed)
            return true
          },
          onSuccess: () => {
            throw new Error("expected failure")
          },
        }),
      ),
    ))
})
