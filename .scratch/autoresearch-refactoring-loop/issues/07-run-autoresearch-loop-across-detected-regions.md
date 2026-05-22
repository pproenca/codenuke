Status: ready-for-agent

# Run the Autoresearch Refactoring Loop across detected regions

## What to build

Implement `codenuke run [iterations=5]` as the unattended Autoresearch Refactoring Loop over all in-scope detected regions. The loop should share region keys with `fence`, raise blocked regions before reducing admissible ones, keep only scored reductions that pass the immutable scorer, revert rejected reductions, and append every iteration to `.codenuke/results.tsv`.

Deterministic loop tests should use scripted `CN_PROPOSER`; the real `claude -p` adapter should receive smoke coverage for command construction and tool restrictions.

## Acceptance criteria

- [ ] `run` requires an existing fence artifact and a green branch-tip suite before scoring or proposing changes.
- [ ] `run` iterates the detected region set filtered by `target`; it does not synthesize a separate single target region that can diverge from the fence artifact.
- [ ] On layout fixtures, `run` performs a non-`raise-skip` action when source and fence data exist.
- [ ] Blocked regions select `raise`; admissible regions with reduction headroom select `reduce`.
- [ ] A kept reduce iteration creates exactly one commit on `autoresearch/<tag>`, leaves the suite green, and has `dL > 0`.
- [ ] A rejected reduce iteration resets the worktree to the branch tip and records `revert`.
- [ ] `results.tsv` records only statuses from the spec enum, including `keep`, `revert`, `raise`, `raise-nogain`, `raise-skip`, `raise-badtest`, `raise-error`, `crash`, and `noop`.
- [ ] Proposer timeout or failure records `crash`, reverts dirty work, and does not stop later iterations from running.

## Blocked by

- `.scratch/autoresearch-refactoring-loop/issues/01-codify-conformance-validation-matrix.md`
- `.scratch/autoresearch-refactoring-loop/issues/03-establish-zero-config-baseline-detection.md`
- `.scratch/autoresearch-refactoring-loop/issues/04-calibrate-behavior-fence-with-wilson-bounds.md`
- `.scratch/autoresearch-refactoring-loop/issues/05-score-candidate-reductions-with-immutable-gates.md`
- `.scratch/autoresearch-refactoring-loop/issues/06-derive-per-repo-value-calibration-scales.md`
