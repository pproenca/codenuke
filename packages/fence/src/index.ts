/**
 * @codenuke/fence — public surface.
 *
 * Pure cores (implemented for real):
 *   - RULE-006  isAdmissible / admissibleFromCounts / FENCE_LB_DEFAULT / Z_95 (+ re-exported `wilson`)
 *   - RULE-007  collectSites / OPERATORS
 *   - RULE-008  mulberry32 / sampleSites / DEFAULT_CAP / DEFAULT_SEED
 *   - RULE-009  classify / tally / survivesFromTestPassed
 *   - RULE-043  isStrictlyHigherLowerBound / recomputeReplay / EPSILON (the replay comparison)
 *   - RULE-050  safeWorktreePath / isSafeWorktreePath (pure path-guard)
 *
 * Effectful shell (stub):
 *   - Fence (Context.Tag) + FenceLive (Layer stub) — the audit/replay runner.
 */

// RULE-007 — mutation operators & site collection
export {
  OPERATORS,
  OPERATORS as MUTATION_OPERATORS,
  collectSites,
  type MutationSite,
  type Operator,
} from "./operators.ts";

// RULE-008 — deterministic sampling
export {
  DEFAULT_CAP,
  DEFAULT_SEED,
  mulberry32,
  samplePlanned,
  sampleSites,
  type PlannedMutation,
} from "./sampling.ts";

// RULE-009 — survivor classification
export { classify, isCaught, survivesFromTestPassed, tally, type MutantStatus } from "./survivor.ts";

// RULE-006 — Wilson admissibility bar
export {
  FENCE_LB_DEFAULT,
  Z_95,
  admissibleFromCounts,
  isAdmissible,
  wilson,
  type WilsonInterval,
} from "./wilson.ts";

// RULE-050 — pure worktree path guard
export { isSafeWorktreePath, safeWorktreePath } from "./path-guard.ts";

// RULE-043 — monotonic replay comparison (pure)
export { EPSILON, isStrictlyHigherLowerBound, recomputeReplay } from "./replay.ts";

// Effectful audit engine (RULE-006/007/008/009) + the MutationRunner port
export {
  Fence,
  FenceLive,
  fakeStatus,
  FakeMutationRunnerLive,
  MutationRunner,
  ReplayPreconditionFailed,
  type AuditInput,
  type AuditRegionRequest,
  type RegionFile,
  type RegionInput,
} from "./audit.ts";

// Real mutation runner (apply → test → restore) over @effect/platform
export { makeMutationRunnerLive } from "./runner.ts";
