import { describe, it } from "@effect/vitest"

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
  it.skip("RULE-057 thread continuity: resume threadId for mode:regionTarget; fresh for a new key", () => {})
  it.todo("RULE-057 (fix) a changed baseline SHA invalidates the resumed thread")
  it.skip("RULE-058 the proposer budget is passed to the provider; overrun classified crash-budget", () => {})
})

describe("periodic services — artifact IO (stubbed)", () => {
  it.skip("RULE-010 calibrate fetches `rev-list --first-parent --max-count=80` and writes calibration.json", () => {})
  it.skip("RULE-024 value-proxy reads candidates, validates, writes value-proxy-validation.json", () => {})
  it.skip("RULE-055 changecost implementer-surface guard ⇒ impl-bad-surface excluded from 𝒱̂", () => {})
})
