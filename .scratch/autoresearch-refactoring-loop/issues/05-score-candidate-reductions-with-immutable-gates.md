Status: ready-for-agent

# Score candidate reductions with immutable gates

## What to build

Implement `score --json` and the manual scorer operations around an immutable `ScoreVerdict`. Scoring should judge the current isolated worktree change against the branch baseline using lexicographic gates before value, and it should be impossible for a larger or behavior-breaking change to win because of the value term.

This slice consumes the AST size `L` primitives from the foundational metric issue and owns their application to `dL`, G4, and the value calculation.

## Acceptance criteria

- [ ] `score --json` emits exactly one machine-readable `@@JSON@@` line with the `ScoreVerdict` shape from `docs/spec.md`.
- [ ] `admissible` is true if and only if `G1 && G1prime && G3 && G4`.
- [ ] `keep` is true if and only if `admissible && loss < 0`.
- [ ] Behavior failure makes `G1 = false`, `loss = +Infinity` / JSON `null`, and `keep = false` regardless of `dL`.
- [ ] Missing fence artifacts, unmeasured touched regions, or blocked touched regions fail G1 prime closed.
- [ ] Type regressions fail G3 when a typecheck command exists and are skipped explicitly when no typecheck command exists.
- [ ] Reformat-only and rename-only changes produce `dL = 0`, `value = 0`, fail G4, and are not kept.
- [ ] `init`, `score`, `accept`, `revert`, `status`, and `cleanup` fail fast with user guidance rather than stack traces when run out of order.

## Blocked by

- `.scratch/autoresearch-refactoring-loop/issues/01-codify-conformance-validation-matrix.md`
- `.scratch/autoresearch-refactoring-loop/issues/02-implement-deterministic-metric-primitives.md`
- `.scratch/autoresearch-refactoring-loop/issues/03-establish-zero-config-baseline-detection.md`
- `.scratch/autoresearch-refactoring-loop/issues/04-calibrate-behavior-fence-with-wilson-bounds.md`
