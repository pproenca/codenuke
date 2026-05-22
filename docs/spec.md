# codenuke — specification

How codenuke decides what to keep. codenuke runs an autonomous loop — an agent proposes a
refactor, an immutable metric judges it, the change is kept only if it is genuinely smaller
**and** behavior-preserved, else reverted — the refactoring analog of
[Karpathy's `autoresearch`](https://github.com/karpathy/autoresearch) (`train.py` + an
immutable `val_bpb`).

## The objective

The goal is **not minimal code** — it is **lower future-change cost**: future edits that are
cheaper, safer, and clearer. Less code is a _means_, and only sometimes: the
maximally-compressed program is the most fragile (every line load-bearing, maximal
coupling), so size-minimization overshoots. Precisely, the objective is the **conditional
description length of the next version given this one** — a codebase is good to the extent
it makes its own likely future changes cheap to express. codenuke optimizes this with a
cheap, gated, deterministic metric per refactor, and _measures_ it directly with a change
benchmark.

## The loop

```
        ┌──────── isolated git worktree @ your baseline (your tree untouched) ────────┐
propose │  an agent edits ONLY source (its toolset has no shell/git → cannot game)    │
        └────────────────────────────────────┬───────────────────────────────────────┘
                                              ▼
  score (immutable judge)  ─ lexicographic: gates ≻ value ─
                                              ▼
  keep (commit, advance)  ── or ──  revert (git reset)  ──▶ log to .codenuke/results.tsv
```

## The metric: gates ≻ value

A change `C → C'` is **admissible** iff all gates hold (hard constraints, lexicographic):

- **G1 — behavior.** The pinned test suite is green, and was green at the baseline.
- **G1′ — fence fidelity.** Every region the change touches has a behavior fence trusted to
  catch behavior changes: its mutation-score 95% CI lower bound ≥ `0.90` (see below).
- **G3 — types.** No new type errors (`tsc --noEmit`); skipped if the repo isn't typechecked.
- **G4 — size.** Net source AST nodes strictly decrease — counted on the AST, so reformatting
  and renames are `Δ = 0` (no reward for cosmetic churn).

For admissible changes, **value** is the z-scored reduction (AST size + complexity), and the
change is **kept iff `loss = risk − value < 0`**:

```
value = wL·ẑΔAST + wC·ẑΔcomplexity                keep iff loss < 0
risk  = ε·diffsize + (1 − fence_fidelity_region)   (a weakly-fenced region is riskier to touch)
```

A behavior break has `loss = +∞` — rejected regardless of how much code it removes. That
lexicographic structure is how codenuke is **self-policing**: you cannot improve the score by
degrading behavior, because behavior is a constraint, not a weighted term.

## The behavior fence — measured, not assumed

Tests are an _approximate_ behavior oracle: some behavior changes slip through. `codenuke
fence` mutation-tests each region — injecting behavior-changing mutations (AST-aware: real
operators, not string literals) and measuring the fraction the suite catches, with a Wilson
95% CI. A region is **admissible only when its CI lower bound clears `0.90`**. Mutation
testing is expensive, so it is a **periodic calibration**, not part of the inner loop; runs
are deterministic (seeded) and reproducible.

Where a region is too weakly fenced to refactor, the loop's **fence-raising move** earns the
right to: the agent writes _characterization tests_ that pin current behavior until the
mutants are caught, the fence is re-measured (monotonic replay of just the survivors), and —
once the CI clears `0.90` — the loop switches to reducing. "Blocked, or given tests until it
clears" is automated.

## The value ground truth — change-cost

The cheap inner-loop value (AST + complexity) is a _proxy_ for future-change cost. `codenuke
changecost` measures the real thing: against a fixed, held-out benchmark of change-requests
(`codenuke.benchmark/<id>/{meta.json,accept.test.ts}`) it implements each change and reports

```
cost(δ, C) = edit(δ, C)                +  β · verify(δ, C)
             token-diff of a correct       1 − fence fidelity of the
             implementation (formatting-   regions the change touched
             invariant; cheaper + clearer) (safer = cheaper to verify)
𝒱̂(C)      = mean over the benchmark
```

`cheaper`, `safer`, and `clearer` are not separate axes — they are components of one measured
quantity (the effort of the next change), which makes the objective a single comparable
number. A refactor `C → C'` is genuinely good when `𝒱̂(C') < 𝒱̂(C)` on the same benchmark.
The realized edit size is a computable upper bound on the conditional description length of
the change (as cross-entropy upper-bounds entropy) — the honest analog of `val_bpb`.

## Why it stays honest (self-policing)

- **The scorer is immutable.** The proposer edits only source (no shell/git in its toolset),
  so it cannot rewrite or read-around the judge. Improving the score _requires_ improving the
  code — the property that makes `val_bpb` trustworthy, reproduced here.
- **The benchmark is hidden from the proposer.** The change-cost benchmark is run by the
  scorer, never seen by the proposer, so the loop cannot overfit it — only structural
  improvements that generalize lower the cost.
- **Safety is lexicographically prior to value.** No amount of reduction buys a behavior
  break or a type regression.

## Determinism & cost

The inner loop (gates + cheap value) is deterministic and runs in seconds on a change. The
two ground-truth audits — mutation fence and change-cost — are expensive and run
periodically; both are seeded and reproducible. The cheap inner-loop value is trusted to
drive the unattended loop only once it is validated to track the measured change-cost.

---

_This repository's own `src/` is the worked example — the codebase the loop runs on, the way
[`autoresearch`](https://github.com/karpathy/autoresearch) ships `train.py` as the thing
being optimized._
