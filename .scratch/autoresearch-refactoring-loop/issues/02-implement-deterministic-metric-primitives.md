Status: ready-for-agent

# Implement deterministic metric primitives

## What to build

Implement and test the pure deterministic primitives that make the scorer, Behavior Fence, and Change-Cost Benchmark mathematically auditable. This slice owns AST size `L`, Wilson confidence bounds, and formatting-invariant edit-size primitives so later slices can depend on proven calculations instead of duplicating formulas.

## Acceptance criteria

- [ ] `L(C) = L(format(C)) = L(rename_local(C))`; whitespace, comments, formatting, and local renames produce `dL = 0`.
- [ ] `L(A union B) = L(A) + L(B)` for file sets with disjoint paths.
- [ ] Deleting any statement from a valid source fixture strictly decreases `L`.
- [ ] `wilson(56, 60)` returns `lo` in `[0.840, 0.842]` and `hi` in `[0.973, 0.975]`; `wilson(0, 0)` returns `{ p: 0, lo: 0, hi: 1 }`.
- [ ] Wilson bounds always satisfy `0 <= lo <= p <= hi <= 1`, and `lo` is non-decreasing in `k` for fixed `n`.
- [ ] The reachability boundary is tested: `wilson(34, 34).lo < 0.90 <= wilson(35, 35).lo`.
- [ ] `editCost(C, format(C)).tokens = 0`; `lcsEditSize(a, b)` equals insertions plus deletions, is symmetric, and returns `0` for identical sequences.
- [ ] A duplicated-concept positive-control fixture costs at least `2.5x` as much to edit as the deduplicated variant for the same change.

## Blocked by

- `.scratch/autoresearch-refactoring-loop/issues/01-codify-conformance-validation-matrix.md`
