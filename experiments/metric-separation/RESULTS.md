# Metric separation check — results

Run: `node experiments/metric-separation/run.mjs` (only dep: `typescript`).
Corresponds to METRIC.md §5 step 3 (do the controls separate?).

## Outcome: SEPARATION ACHIEVED (15/15 assertions)

| kind | dL | dDup | G1 | G3 | G4 | admissible | gain | loss | note |
|---|---|---|---|---|---|---|---|---|---|
| positive (codec DRY) | 69 | 174 | Y | Y | Y | Y | 156.0 | −152.6 | best |
| positive-react (badge) | 68 | 99 | Y | Y | Y | Y | 114.5 | −111.3 | JSX path works |
| N1 reformat | 0 | 0 | Y | Y | · | · | 0.0 | +Inf | useless, not dangerous |
| N2 break (drops flac) | 77 | 174 | · | Y | Y | · | 164.0 | +Inf | **highest raw gain, rejected** |
| N3 churn | −38 | 0 | Y | Y | · | · | −38.0 | +Inf | extraction adds nodes |

## What this proves
- **P3 / self-policing:** N2 has the largest raw reduction yet is rejected by the
  behavior gate. Behavior cannot be traded for code reduction.
- **Dangerous vs useless:** N2 fails G1 (behavior); N1/N3 fail G4 (no reduction).
- **P5:** extract-method churn scores negative (AST nodes increase).
- **P1:** pure reformat yields dL = 0 (AST/rename invariant).
- React `.tsx` handled via a dependency-free JSX renderer + a `tsc` shim for `h`.

## Findings / metric refinements surfaced
- **Rank by loss, not gain.** gain only compares within the admissible set
  (lexicographic, §1.4); N2's gain > positive's gain, but its loss is +Inf.
- **`dDup` (clone mass) is the load-bearing duplication signal; `dX`
  (dominant clone-site count) is weak** — a refactor can swap a big clone for a
  small one (here: import boilerplate) and keep the max-window count, so dX≈0.

## What this does NOT yet prove (still required by METRIC.md §4 before driving a loop)
- **Construct validity** — no correlation against human/ground-truth labels on
  real refactors yet (synthetic controls only).
- **Reliability** — no test–retest CV measured.
- **Transfer** — module-scale → repo-scale not tested.
- **G2 (coverage) stubbed**, **mutation-score (`mfence`) stubbed = 1** — the
  fence-independence question is untested; here the probes are externally defined,
  not agent-written.
- **Weights illustrative, not fitted** (§4.4).
- Behavior fence executes pure functions / pure components only; side effects,
  async, hooks/effects, and opaque downstream state (FFmpeg-style) remain
  unfenceable except at an observable boundary (the fence-boundary = refactor-
  boundary rule).
