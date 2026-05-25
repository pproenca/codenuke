import { describe, expect, it } from "@effect/vitest"
import { allowlistEnv } from "@codenuke/core"
import { Effect, Stream } from "effect"
import { resolveProposerConfig } from "../src/config/config.ts"
import { codexSdkEnv, codexThreadOptions } from "../src/proposer/codex-agent.ts"
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

describe("proposer — Codex SDK options/env boundary", () => {
  it("passes CN_REASONING_EFFORT through resolved Codex thread options", () => {
    const config = resolveProposerConfig({
      CN_MODEL: "gpt-5-codex",
      CN_REASONING_EFFORT: "medium",
      CN_CODEX_SANDBOX: "workspace-write",
      CN_CODEX_APPROVAL_POLICY: "never",
    })
    if (config instanceof Error) throw config
    expect(codexThreadOptions(config, "/tmp/worktree")).toMatchObject({
      workingDirectory: "/tmp/worktree",
      model: "gpt-5-codex",
      modelReasoningEffort: "medium",
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
    })
  })

  it("keeps Codex SDK env separate from subprocess allowlist env", () => {
    const parent = {
      PATH: "/usr/bin",
      HOME: "/home/user",
      CN_REASONING_EFFORT: "medium",
      OPENAI_API_KEY: "secret",
      CODEX_HOME: "/tmp/codex",
      UNRELATED_SECRET: "nope",
    }
    expect(allowlistEnv(parent)).toEqual({ PATH: "/usr/bin", HOME: "/home/user" })
    expect(codexSdkEnv(parent)).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/user",
      OPENAI_API_KEY: "secret",
      CODEX_HOME: "/tmp/codex",
    })
  })
})
