/**
 * @codenuke/runtime — the effectful shell.
 *
 * Config resolution, git/worktree, the code-SDK proposer port, the progress
 * Stream, the loop orchestrator (+doctor), and the periodic-artifact contexts
 * (calibrate / value-proxy / changecost).
 *
 * Pure rules are implemented for real; effectful services ship as Layer stubs
 * (`Effect.die("unimplemented: RULE-xxx")`) for wave 2.
 */
export * from "./config/config.ts"
export { readArtifactBundle } from "./artifacts/artifact-readiness.ts"
export type { ArtifactBundle } from "./artifacts/artifact-readiness.ts"
export * from "./git/git.ts"
export * from "./score/score.ts"
export * from "./fence/fence-run.ts"
export * from "./loop/loop.ts"
export * from "./loop/lifecycle.ts"
export * from "./proposer/proposer.ts"
export * from "./progress/progress.ts"
export * from "./orchestrator/state.ts"
export * from "./orchestrator/orchestrator.ts"
export * from "./periodic/calibrate.ts"
export * from "./periodic/value-proxy.ts"
export * from "./periodic/changecost.ts"
export * from "./periodic/periodic-run.ts"
export * from "./periodic/changecost-run.ts"
export * from "./proposer/codex-agent.ts"
