/**
 * The error ADT — every failure mode in @codenuke/core (and its consumers) is a
 * `Data.TaggedError`. No thrown exceptions, no `null`-as-error in the effectful
 * shell. The CLI maps these tags → POSIX exit codes (see REIMAGINED_ARCHITECTURE
 * §8). Each carries enough structured context for the renderer and exit-code map.
 */
import { Data } from "effect";
import type { GateName } from "../domain/index.ts";

/** A safety gate failed (carries every failing gate — RULE-063 fix). */
export class GateFailed extends Data.TaggedError("GateFailed")<{
  readonly failedGates: readonly GateName[];
  readonly message?: string;
}> {}

/** A required artifact is absent (RULE-022/023/024/030). */
export class ArtifactMissing extends Data.TaggedError("ArtifactMissing")<{
  readonly artifact: string;
  readonly path?: string;
}> {}

/** An artifact is present but its baseline drifted (RULE-022/023). */
export class ArtifactStale extends Data.TaggedError("ArtifactStale")<{
  readonly artifact: string;
  readonly reason: string;
}> {}

/** Anti-tamper failed: a re-derived value (Wilson/ρ/cost) disagrees with the
 *  stored one beyond tolerance (RULE-022/024/054). */
export class ArtifactTampered extends Data.TaggedError("ArtifactTampered")<{
  readonly artifact: string;
  readonly reason: string;
}> {}

/** An artifact failed shape/metadata/provenance validation (RULE-022/023/024). */
export class ArtifactInvalid extends Data.TaggedError("ArtifactInvalid")<{
  readonly artifact: string;
  readonly reason: string;
}> {}

/** Config resolution failed shape/bounds checks (RULE-049). */
export class ConfigInvalid extends Data.TaggedError("ConfigInvalid")<{
  readonly key?: string;
  readonly reason: string;
}> {}

/** A legacy shell-string command was supplied (RULE-048). */
export class ShellStringRejected extends Data.TaggedError("ShellStringRejected")<{
  readonly key: string;
  readonly reason: string;
}> {}

/** A worktree-relative path escaped the root (RULE-050) — CWE-22/59. */
export class PathEscape extends Data.TaggedError("PathEscape")<{
  readonly path: string;
  readonly reason: string;
}> {}

/** A git invocation failed (RULE-052/061). */
export class GitFailed extends Data.TaggedError("GitFailed")<{
  readonly command: string;
  readonly reason: string;
}> {}

/** A proposer turn exceeded its timeout (RULE-047). */
export class ProposerTimeout extends Data.TaggedError("ProposerTimeout")<{
  readonly timeoutMs: number;
}> {}

/** A generic command (test/typecheck/fence-mutant) exceeded its timeout. */
export class CommandTimeout extends Data.TaggedError("CommandTimeout")<{
  readonly command: string;
  readonly timeoutMs: number;
}> {}

/** A proposer run exceeded its USD budget (RULE-058). */
export class ProposerBudgetExceeded extends Data.TaggedError(
  "ProposerBudgetExceeded",
)<{
  readonly budgetUsd: string;
}> {}

/** The worktree had uncommitted changes when it had to be clean (RULE-046). */
export class WorktreeDirty extends Data.TaggedError("WorktreeDirty")<{
  readonly worktree: string;
  readonly disallowed: readonly string[];
}> {}

/** A fence replay precondition failed (RULE-051). */
export class ReplayPreconditionFailed extends Data.TaggedError(
  "ReplayPreconditionFailed",
)<{
  readonly region: string;
  readonly reason: string;
}> {}

/** The value-proxy corpus was below the minimum (RULE-027). */
export class CorpusTooSmall extends Data.TaggedError("CorpusTooSmall")<{
  readonly candidates: number;
  readonly minimum: number;
}> {}

/** Spearman ρ was non-finite (zero-variance / n<2) (RULE-014/028). */
export class RankCorrelationUndefined extends Data.TaggedError(
  "RankCorrelationUndefined",
)<{
  readonly reason: string;
}> {}

/** Engine state failed shape validation or SHA reconcile (RULE-053). */
export class StateStale extends Data.TaggedError("StateStale")<{
  readonly reason: string;
}> {}
