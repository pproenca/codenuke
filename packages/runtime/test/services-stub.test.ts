import { describe, expect, it } from "@effect/vitest"
import {
  proposerThreadKey,
  selectProposerThread,
  upsertProposerThread,
  type ThreadState,
} from "../src/proposer/thread-state.ts"

/**
 * Stubbed acceptance tests for the effectful services scaffolded in this wave.
 * Each name starts with its RULE id so the traceability map stays complete; the
 * bodies are filled in wave 2 when the Live service implementations land.
 */

describe("git service — worktree lifecycle (stubbed)", () => {
  it.skip("RULE-045 worktree add links node_modules + adds it to info/exclude (invariant)", () => {})
  it.todo("RULE-045 removeWorktree unlinks then `worktree remove --force` then prune (tolerant)")
  it.skip("RULE-050 every worktree read routes through the ONE safe-path guard (realpath + lstat)", () => {})
})

describe("proposer service — subprocess / continuity / budget (stubbed)", () => {
  it.skip("RULE-047 proposer timeout ⇒ SIGTERM then SIGKILL after 1000ms ⇒ crash-timeout", () => {})
  it.skip("RULE-047 a 'maximum budget' output ⇒ failure class crash-budget; else crash", () => {})
  it.skip("RULE-058 the proposer budget is passed to the provider; overrun classified crash-budget", () => {})
})

describe("proposer thread state — RULE-057", () => {
  const state: ThreadState = {
    schemaVersion: 1,
    provider: "codex-sdk",
    threads: {
      "reduce:src": {
        threadID: "thread-reduce-src",
        createdAt: "2026-05-27T00:00:00.000Z",
        lastUsedAt: "2026-05-27T00:00:00.000Z",
        baselineSha: "a".repeat(40),
      },
    },
  }

  it("resumes a thread for the same mode, region target, and baseline", () => {
    expect(proposerThreadKey("reduce", "src")).toBe("reduce:src")
    expect(selectProposerThread(state, "reduce:src", "a".repeat(40))).toBe("thread-reduce-src")
    expect(selectProposerThread(state, "raise-fence:src", "a".repeat(40))).toBeUndefined()
  })

  it("invalidates a stored thread when the baseline SHA changes", () => {
    expect(selectProposerThread(state, "reduce:src", "b".repeat(40))).toBeUndefined()
  })

  it("does not resume legacy entries without baseline metadata", () => {
    const legacy: ThreadState = {
      schemaVersion: 1,
      provider: "codex-sdk",
      threads: {
        "reduce:src": {
          threadID: "legacy-thread",
          createdAt: "2026-05-27T00:00:00.000Z",
          lastUsedAt: "2026-05-27T00:00:00.000Z",
        },
      },
    }
    expect(selectProposerThread(legacy, "reduce:src", "a".repeat(40))).toBeUndefined()
  })

  it("upserts lastUsedAt while preserving createdAt", () => {
    const next = upsertProposerThread({
      state,
      key: "reduce:src",
      threadID: "thread-next",
      baselineSha: "a".repeat(40),
      now: "2026-05-27T01:00:00.000Z",
    })
    expect(next.threads["reduce:src"]).toEqual({
      threadID: "thread-next",
      createdAt: "2026-05-27T00:00:00.000Z",
      lastUsedAt: "2026-05-27T01:00:00.000Z",
      baselineSha: "a".repeat(40),
    })
  })
})

describe("periodic services — artifact IO (stubbed)", () => {
  it.skip("RULE-010 calibrate fetches `rev-list --first-parent --max-count=80` and writes calibration.json", () => {})
  it.skip("RULE-024 value-proxy reads candidates, validates, writes value-proxy-validation.json", () => {})
  it.skip("RULE-055 changecost implementer-surface guard ⇒ impl-bad-surface excluded from 𝒱̂", () => {})
})
