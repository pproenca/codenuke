Status: ready-for-agent

# Validate the value proxy tracks change-cost

## What to build

Add the conformance path that proves the cheap inner-loop value proxy tracks the held-out Change-Cost Benchmark before large unattended runs are recommended. This slice should run proxy measurements and `Vhat` measurements over an agreed corpus, compute Spearman rank correlation, and report whether the release criterion `rho >= 0.6` is satisfied.

## Acceptance criteria

- [ ] The validation command or test fixture computes both the scorer value proxy and `Vhat` over the same ordered candidate corpus.
- [ ] Spearman rank correlation is computed deterministically and tested on known positive, negative, and tied-ranking examples.
- [ ] The report includes the corpus identity, candidate count, per-candidate proxy value, per-candidate `Vhat`, `rho`, and pass/fail against `rho >= 0.6`.
- [ ] The validation fails closed when the corpus is too small to support a meaningful rank correlation.
- [ ] The release documentation distinguishes proven local deterministic proxy validation from any future LLM-backed or multi-repo claims.

## Blocked by

- `.scratch/autoresearch-refactoring-loop/issues/01-codify-conformance-validation-matrix.md`
- `.scratch/autoresearch-refactoring-loop/issues/05-score-candidate-reductions-with-immutable-gates.md`
- `.scratch/autoresearch-refactoring-loop/issues/06-derive-per-repo-value-calibration-scales.md`
- `.scratch/autoresearch-refactoring-loop/issues/09-measure-change-cost-benchmark-ground-truth.md`
