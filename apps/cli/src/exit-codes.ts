/**
 * Tag → POSIX exit-code mapping (architecture §8).
 *
 * This table is owned by the `runMain` error handler (it is NOT free from
 * @effect/cli, which only gives parsing/help/completions). Agents branch on
 * these codes, so distinct tags get distinct codes.
 *
 *   0  success                       (and `doctor` ready)
 *   2  doctor "not ready" / usage    (unknown command, bad args)
 *   1  generic failure
 *   3  ConfigInvalid / ShellStringRejected
 *   4  GateFailed (startup gate / accept re-score)
 *   5  ArtifactMissing
 *   6  ArtifactStale
 *   7  ArtifactTampered / ArtifactInvalid
 *   8  StateStale / StateInvalid
 *   9  ProposerTimeout / ProposerBudgetExceeded / ProposerFailed
 *  10  GitFailed / PathEscape
 */
export const EXIT_OK = 0
export const EXIT_GENERIC = 1
export const EXIT_NOT_READY = 2
export const EXIT_CONFIG_INVALID = 3
export const EXIT_GATE_FAILED = 4
export const EXIT_ARTIFACT_MISSING = 5
export const EXIT_ARTIFACT_STALE = 6
export const EXIT_ARTIFACT_TAMPERED = 7
export const EXIT_STATE = 8
export const EXIT_PROPOSER = 9
export const EXIT_GIT = 10

/** Minimal tagged-error shape (Effect's Data.TaggedError all carry `_tag`). */
export interface TaggedLike {
  readonly _tag: string
}

/**
 * Map an error (by `_tag`) to a POSIX exit code. Pure & total: an unrecognized
 * tag (or a non-tagged value) maps to the generic failure code 1.
 */
export const exitCodeFor = (error: unknown): number => {
  const tag =
    error !== null && typeof error === "object" && "_tag" in error
      ? (error as TaggedLike)._tag
      : undefined

  switch (tag) {
    case "ConfigInvalid":
    case "ShellStringRejected":
    case "WeightOutOfBounds":
      return EXIT_CONFIG_INVALID
    case "GateFailed":
      return EXIT_GATE_FAILED
    case "ArtifactMissing":
      return EXIT_ARTIFACT_MISSING
    case "ArtifactStale":
      return EXIT_ARTIFACT_STALE
    case "ArtifactTampered":
    case "ArtifactInvalid":
      return EXIT_ARTIFACT_TAMPERED
    case "StateStale":
    case "StateInvalid":
      return EXIT_STATE
    case "ProposerTimeout":
    case "ProposerBudgetExceeded":
    case "ProposerFailed":
      return EXIT_PROPOSER
    case "GitFailed":
    case "PathEscape":
      return EXIT_GIT
    case "NotReady":
      return EXIT_NOT_READY
    default:
      return EXIT_GENERIC
  }
}
