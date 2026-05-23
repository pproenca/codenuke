Status: done

# Measure Change-Cost Benchmark ground truth

## What to build

Implement `codenuke changecost [ref=baseline]` as the held-out ground-truth audit for future-change cost. The command should independently apply each benchmark delta in an isolated worktree, gate correctness on the hidden accept test plus the full suite, measure formatting-invariant edit cost plus verification cost, and write `.codenuke/changecost.json`.

Deterministic tests and positive controls should use scripted `CN_IMPLEMENTER`; the real LLM-backed implementer receives smoke coverage only and should not be required for CI correctness.

## Acceptance criteria

- [x] `changecost` aborts on a red baseline and on an empty benchmark directory.
- [x] Each benchmark delta starts from the same clean ref, writes its hidden accept test into the worktree, and cleans the worktree before the next delta.
- [x] A delta is `done` only when the hidden accept test and full suite are green.
- [x] Cost is computed as `edit + beta * verify`, with `edit >= 0` and `verify` in `[0, 1]`.
- [x] Verification cost uses Behavior Fence fidelity for touched regions and fails closed when no fence data exists.
- [x] The duplicated-vs-deduplicated positive control satisfies `Vhat(deduplicated) < Vhat(duplicated)` for the same change request.
- [x] With scripted `CN_IMPLEMENTER`, the same ref, benchmark, fence artifact, and beta produce identical `Vhat` and per-delta results.

## Evidence

- Unit/integration coverage: `loop/changecost.test.mjs`.
- Real-repo exercise:
  `.scratch/autoresearch-refactoring-loop/proxy-validation-codecharter-2026-05-22.md`
  includes three `codenuke changecost <ref>` runs on a detached codecharter temp worktree,
  each completing `done=2/2` hidden deltas with a scripted `CN_IMPLEMENTER`.

## Blocked by

- `.scratch/autoresearch-refactoring-loop/issues/01-codify-conformance-validation-matrix.md`
- `.scratch/autoresearch-refactoring-loop/issues/02-implement-deterministic-metric-primitives.md`
- `.scratch/autoresearch-refactoring-loop/issues/03-establish-zero-config-baseline-detection.md`
- `.scratch/autoresearch-refactoring-loop/issues/04-calibrate-behavior-fence-with-wilson-bounds.md`
