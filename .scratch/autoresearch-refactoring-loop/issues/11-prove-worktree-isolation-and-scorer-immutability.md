Status: ready-for-agent

# Prove worktree isolation and scorer immutability

## What to build

Add the safety harness that proves codenuke commands do not modify the user's working tree or current branch, and that the proposer cannot game the scorer or hidden benchmark. This slice should cover clean and dirty repositories, manual scorer operations, autonomous loop operations, Behavior Fence calibration, and Change-Cost Benchmark runs.

## Acceptance criteria

- [ ] After every command, tracked non-`.codenuke/` paths in the user's repo are unchanged and the user's `HEAD` and current branch are unchanged.
- [ ] Isolation checks run from both clean and dirty user worktrees.
- [ ] Builds, tests, mutations, proposed edits, and benchmark implementations run only inside the configured `/tmp` worktree.
- [ ] Loop state lives outside the worktree and is not committed or removed by worktree git resets.
- [ ] The default proposer command exposes no shell or git tool and cannot read the scorer or change-cost benchmark.
- [ ] A proposer edit outside `srcDir`, or outside test files during `raise`, is rejected and reverted.
- [ ] `fix`, `run`, scorer operations, and benchmark commands do not commit, push, open PRs, or land changes outside their explicit spec surface.

## Blocked by

- `.scratch/autoresearch-refactoring-loop/issues/01-codify-conformance-validation-matrix.md`
- `.scratch/autoresearch-refactoring-loop/issues/05-score-candidate-reductions-with-immutable-gates.md`
- `.scratch/autoresearch-refactoring-loop/issues/07-run-autoresearch-loop-across-detected-regions.md`
- `.scratch/autoresearch-refactoring-loop/issues/09-measure-change-cost-benchmark-ground-truth.md`
