Status: ready-for-agent

# Raise weak Behavior Fences with monotonic replay

## What to build

Implement the fence-raising path for regions whose Behavior Fence is too weak for autonomous reduction. In `raise` mode, the proposer should add characterization tests only, the current source should remain unchanged, and replay should re-run only prior survivor mutations so the fence can improve monotonically.

Deterministic tests should use scripted `CN_PROPOSER`; the real `claude -p` adapter should receive a smoke check that the raise prompt and allowed tools match the spec.

## Acceptance criteria

- [ ] A raise proposal that touches non-test source is rejected as `raise-badtest` and reverted.
- [ ] Added characterization tests must pass against the current unmutated code before replay starts.
- [ ] Replay uses only prior `survivorSpecs` for the target region and does not resample new mutants.
- [ ] Replay preserves `total`, satisfies `caught_after >= caught_before`, and satisfies `survivorSpecs_after` is a subset of `survivorSpecs_before`.
- [ ] A raise that improves the Wilson lower bound records `raise`; a raise with no lower-bound gain records `raise-nogain`.
- [ ] Missing survivor specs record `raise-skip`; replay errors record `raise-error`; no changed tests record `raise-noop` or the chosen documented no-op status.
- [ ] Once the region lower bound clears `fenceLB`, later loop selection treats that region as admissible for `reduce`.

## Blocked by

- `.scratch/autoresearch-refactoring-loop/issues/01-codify-conformance-validation-matrix.md`
- `.scratch/autoresearch-refactoring-loop/issues/04-calibrate-behavior-fence-with-wilson-bounds.md`
- `.scratch/autoresearch-refactoring-loop/issues/07-run-autoresearch-loop-across-detected-regions.md`
