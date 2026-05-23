Status: done

# Validate the value proxy tracks change-cost

## What to build

Add the conformance path that proves the cheap inner-loop value proxy tracks the held-out Change-Cost Benchmark before large unattended runs are recommended. This slice should run proxy measurements and `Vhat` measurements over an agreed corpus, compute Spearman rank correlation, and report whether the release criterion `rho >= 0.6` is satisfied.

## Acceptance criteria

- [x] The validation command or test fixture computes both the scorer value proxy and `Vhat` over the same ordered candidate corpus.
- [x] Spearman rank correlation is computed deterministically and tested on known positive, negative, and tied-ranking examples.
- [x] The report includes the corpus identity, candidate count, per-candidate proxy value, per-candidate `Vhat`, `rho`, and pass/fail against `rho >= 0.6`.
- [x] The validation fails closed when the corpus is too small to support a meaningful rank correlation.
- [x] The release documentation distinguishes proven local deterministic proxy validation from any future LLM-backed or multi-repo claims.

## Evidence

- Unit/CLI coverage: `loop/value-proxy.test.mjs`.
- Runtime gate: `loop/autoloop.mjs` requires a passing
  `.codenuke/value-proxy-validation.json` before long unattended runs.
- Real-repo deterministic validation:
  `.scratch/autoresearch-refactoring-loop/proxy-validation-codecharter-2026-05-22.md`.
  The codecharter temp-worktree corpus measured three scored candidates and two held-out
  `changecost` deltas per candidate, then passed `codenuke validate-proxy` with
  `rho=0.866` and `minimumRho=0.6`.

## Blocked by

- `.scratch/autoresearch-refactoring-loop/issues/01-codify-conformance-validation-matrix.md`
- `.scratch/autoresearch-refactoring-loop/issues/05-score-candidate-reductions-with-immutable-gates.md`
- `.scratch/autoresearch-refactoring-loop/issues/06-derive-per-repo-value-calibration-scales.md`
- `.scratch/autoresearch-refactoring-loop/issues/09-measure-change-cost-benchmark-ground-truth.md`
