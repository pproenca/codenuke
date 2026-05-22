# Autoresearch Refactoring Loop Conformance Matrix

Source of truth: `docs/spec.md`.

Command names follow the Product Contract exactly: `fence`, `run`, `score`, `changecost`,
`calibrate`, `doctor`, `init`, `accept`, `revert`, `status`, and `cleanup`.

## Deterministic Testing Convention

Conformance tests must not depend on model output. Mathematical checks, positive controls,
loop tests, fence-raising tests, and change-cost tests use scripted `CN_PROPOSER` and
`CN_IMPLEMENTER` commands. The real `claude -p` adapter receives smoke coverage for command
construction, allowed tools, budget, and no shell/git access.

Determinism follows `docs/spec.md` INV-5: `fence`, `score`, and `calibrate` produce identical
numeric output for the same inputs and seed. `changecost` is deterministic with a fixed scripted
`CN_IMPLEMENTER`; LLM-backed runs are interpreted through paired comparison rather than exact
numeric replay.

## Invariants

| Spec item                  | Owning issue                                                                                                                                                                                                                                      | Proof surface                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| INV-1 isolation            | `11-prove-worktree-isolation-and-scorer-immutability`                                                                                                                                                                                             | Integration tests run each command from clean and dirty repos, then compare user repo status, branch, and HEAD.                                   |
| INV-2 worktree confinement | `11-prove-worktree-isolation-and-scorer-immutability`                                                                                                                                                                                             | Integration tests assert tests, mutations, proposals, and benchmark implementations happen in `/tmp` worktrees and state is outside the worktree. |
| INV-3 scorer immutability  | `11-prove-worktree-isolation-and-scorer-immutability`                                                                                                                                                                                             | Adapter smoke test asserts no shell/git tools and no benchmark/scorer access; malicious scripted proposer attempts are rejected.                  |
| INV-4 green precondition   | `03-establish-zero-config-baseline-detection`, `05-score-candidate-reductions-with-immutable-gates`, `09-measure-change-cost-benchmark-ground-truth`                                                                                              | Red-baseline fixtures abort before scoring, fencing, running, or benchmarking.                                                                    |
| INV-5 determinism          | `01-codify-conformance-validation-matrix`, `04-calibrate-behavior-fence-with-wilson-bounds`, `05-score-candidate-reductions-with-immutable-gates`, `06-derive-per-repo-value-calibration-scales`, `09-measure-change-cost-benchmark-ground-truth` | Repeat runs compare numeric output; change-cost repeatability uses scripted `CN_IMPLEMENTER`.                                                     |
| INV-6 fail-closed          | `03-establish-zero-config-baseline-detection`, `04-calibrate-behavior-fence-with-wilson-bounds`, `05-score-candidate-reductions-with-immutable-gates`                                                                                             | Missing prerequisites, missing fence artifacts, and unmeasured regions report not-ready or blocked and never become admissible.                   |

## Step Contracts

| Spec item                       | Owning issue                                                                                              | Proof surface                                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Loop preconditions              | `07-run-autoresearch-loop-across-detected-regions`                                                        | Integration fixture requires fence artifact, green branch tip, and non-empty in-scope region set.                        |
| Loop propose postcondition      | `07-run-autoresearch-loop-across-detected-regions`, `08-raise-weak-behavior-fences-with-monotonic-replay` | Scripted proposer attempts inside and outside allowed paths; outside scope is rejected and reverted.                     |
| Loop score postcondition        | `05-score-candidate-reductions-with-immutable-gates`                                                      | `score --json` emits `ScoreVerdict`; `keep` is equivalent to `admissible && loss < 0`.                                   |
| Loop keep/revert postconditions | `07-run-autoresearch-loop-across-detected-regions`                                                        | Kept iterations create one commit with green suite and `dL > 0`; rejected iterations leave clean worktree at branch tip. |
| Loop kept-iteration invariant   | `07-run-autoresearch-loop-across-detected-regions`                                                        | Multi-iteration scripted run asserts green tip and non-decreasing cumulative reduction after kept commits.               |
| Loop termination                | `07-run-autoresearch-loop-across-detected-regions`                                                        | Iteration budget, interrupt/no-work fixtures, and no-region fixtures halt with documented status.                        |
| Fence audit pre/post            | `04-calibrate-behavior-fence-with-wilson-bounds`                                                          | Red baseline aborts; green baseline writes complete per-region Wilson artifact with AST-aware survivor specs.            |
| Fence replay pre/post           | `08-raise-weak-behavior-fences-with-monotonic-replay`                                                     | Replay fixture starts with source identical to baseline plus tests, then proves monotone caught/survivor updates.        |
| Change-cost precondition        | `09-measure-change-cost-benchmark-ground-truth`                                                           | Red baseline and empty benchmark fixtures abort.                                                                         |
| Change-cost per-delta contract  | `09-measure-change-cost-benchmark-ground-truth`                                                           | Each delta starts from the same ref, gates on hidden accept test plus suite, measures cost, then cleans worktree.        |
| Change-cost invariant           | `09-measure-change-cost-benchmark-ground-truth`                                                           | `edit >= 0`, `verify in [0, 1]`, fixed delta comparability, and hidden accept-test correctness are asserted.             |

## Acceptance Criteria

| Spec item                            | Owning issue                                                                                           | Proof surface                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| AC-L1 size invariance                | `02-implement-deterministic-metric-primitives`, `05-score-candidate-reductions-with-immutable-gates`   | Pure metric test plus score fixture for format/local-rename `dL = 0`.                           |
| AC-L2 size additivity                | `02-implement-deterministic-metric-primitives`                                                         | Pure metric test over disjoint file sets.                                                       |
| AC-L3 size strictness                | `02-implement-deterministic-metric-primitives`                                                         | Pure metric fixture proves deleting a statement strictly decreases `L`.                         |
| AC-W1 Wilson formula                 | `02-implement-deterministic-metric-primitives`                                                         | Unit test for `wilson(56, 60)` and `wilson(0, 0)`.                                              |
| AC-W2 Wilson bounds and monotonicity | `02-implement-deterministic-metric-primitives`                                                         | Unit test over fixed `n` ranges.                                                                |
| AC-W3 Wilson reachability            | `02-implement-deterministic-metric-primitives`                                                         | Unit test for `wilson(34,34)` and `wilson(35,35)`.                                              |
| AC-E1 edit no-op                     | `02-implement-deterministic-metric-primitives`, `09-measure-change-cost-benchmark-ground-truth`        | Pure edit-cost test for formatting-only change.                                                 |
| AC-E2 LCS correctness                | `02-implement-deterministic-metric-primitives`                                                         | Unit test for insertions/deletions, symmetry, identity, and empty inputs.                       |
| AC-E3 edit amplification             | `02-implement-deterministic-metric-primitives`                                                         | Duplicated-vs-deduplicated positive control with ratio at least 2.5.                            |
| AC-V1 value monotonicity             | `05-score-candidate-reductions-with-immutable-gates`                                                   | Score-verdict test increases each reduction component independently and observes greater value. |
| AC-V2 keep rule                      | `05-score-candidate-reductions-with-immutable-gates`                                                   | Public `score --json` fixture proves equivalences.                                              |
| AC-V3 self-policing                  | `05-score-candidate-reductions-with-immutable-gates`                                                   | Behavior-break and reformat fixtures never keep.                                                |
| AC-F1 fence admissibility            | `04-calibrate-behavior-fence-with-wilson-bounds`, `05-score-candidate-reductions-with-immutable-gates` | Fence artifact and scorer fixtures prove `lo >= fenceLB` and fail-closed unmeasured regions.    |
| AC-F2 AST-aware mutation             | `04-calibrate-behavior-fence-with-wilson-bounds`                                                       | Mutation-site fixture includes operators in strings/comments and real AST operators.            |
| AC-F3 monotone replay                | `08-raise-weak-behavior-fences-with-monotonic-replay`                                                  | Scripted raise fixture proves monotone caught/lo and shrinking survivor set.                    |
| AC-C1 change-cost discrimination     | `09-measure-change-cost-benchmark-ground-truth`                                                        | Scripted benchmark shows deduplicated `Vhat` lower than duplicated for the same delta.          |
| AC-C2 change-cost form               | `09-measure-change-cost-benchmark-ground-truth`                                                        | Unit/integration checks `cost = edit + beta * verify`, `edit >= 0`, `verify in [0,1]`.          |
| AC-K1 calibration positive scales    | `06-derive-per-repo-value-calibration-scales`                                                          | Git-history fixture derives positive `sL`, `sCx`, and `sDup`, or records fallback defaults.     |
| AC-K2 calibration determinism        | `06-derive-per-repo-value-calibration-scales`                                                          | Repeat calibration on the same baseline yields identical scales.                                |
| AC-D1 non-empty detection            | `03-establish-zero-config-baseline-detection`                                                          | Layout fixtures for `src` subdirs, flat `src`, `lib`, `app`, `source`, and repo root.           |
| AC-D2 fence/run alignment            | `04-calibrate-behavior-fence-with-wilson-bounds`, `07-run-autoresearch-loop-across-detected-regions`   | Fence keys equal run region set; scripted run performs non-`raise-skip` action.                 |
| AC-I1 tree untouched                 | `11-prove-worktree-isolation-and-scorer-immutability`                                                  | Clean and dirty repo integration tests assert unchanged user branch, HEAD, and tracked paths.   |
| AC-I2 proposer sandbox               | `11-prove-worktree-isolation-and-scorer-immutability`                                                  | Adapter smoke and malicious proposer fixtures prove no shell/git and reject out-of-scope edits. |

## Release Criteria

| Spec item                                                                 | Owning issue                                                                                                | Proof surface                                                                                     |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Global install exposes `codenuke` on Node >= 22 with runtime `typescript` | `12-package-v0-1-with-release-conformance`                                                                  | Package smoke test installs/executes packed artifact.                                             |
| `doctor` reports readiness or precise gaps                                | `03-establish-zero-config-baseline-detection`                                                               | Fresh-repo readiness/not-ready fixtures.                                                          |
| Detection works across layouts                                            | `03-establish-zero-config-baseline-detection`                                                               | Layout fixture suite.                                                                             |
| `fence` runs zero-config and writes detected-region artifact              | `04-calibrate-behavior-fence-with-wilson-bounds`                                                            | Integration fixture invokes CLI and inspects artifact keys.                                       |
| `run` is not a no-op on a fresh repo                                      | `07-run-autoresearch-loop-across-detected-regions`, `08-raise-weak-behavior-fences-with-monotonic-replay`   | Scripted proposer fixture records raise/reduce action and results row.                            |
| `calibrate` derives per-repo value scales                                 | `06-derive-per-repo-value-calibration-scales`                                                               | Git-history fixture and artifact check.                                                           |
| Scorer immutable from proposer; benchmark hidden                          | `11-prove-worktree-isolation-and-scorer-immutability`                                                       | Adapter and malicious proposer/implementer fixtures.                                              |
| Worktree isolation and manual preflight guidance                          | `05-score-candidate-reductions-with-immutable-gates`, `11-prove-worktree-isolation-and-scorer-immutability` | Out-of-order scorer commands fail with guidance; user tree remains unchanged.                     |
| Value proxy validates against change-cost with rho >= 0.6                 | `10-validate-value-proxy-tracks-change-cost`                                                                | Correlation report/test over agreed corpus.                                                       |
| CI green and docs aligned                                                 | `12-package-v0-1-with-release-conformance`                                                                  | `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, plus `pnpm eval` and `pnpm pack:smoke`. |
