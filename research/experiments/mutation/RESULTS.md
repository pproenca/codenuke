# M1 — per-region fence-fidelity gate (SPEC §4 G1′; GOAL.md M1)

Run: `node experiments/mutation/fidelity.mjs [cap=60] [seed=1337]` (isolated worktree
@ green `2d81f6c`). Emits the pinned artifact `fence-fidelity.json` the scorer reads.
**Replaces the global `mfence` (one number) with a per-region mutation score + Wilson
95% CI, so admissibility is decided per region** — `loop.mjs` now applies G1′: a
transition is inadmissible unless every touched region's fence has CI lower bound ≥ 0.90.

## Result — 0 / 6 regions admissible (382 mutants, deterministic seeded sample)

| region | caught/total | score | Wilson 95% CI | admissible (lo ≥ 0.90) |
|---|---|---|---|---|
| mappers (loop target) | 56/90 | 62% | [51.9, 71.5] | **no** |
| workflow | 32/60 | 53% | [40.9, 65.4] | **no** |
| platform | 39/60 | 65% | [52.4, 75.8] | **no** |
| mapping | 32/60 | 53% | [40.9, 65.4] | **no** |
| provider | 33/60 | 55% | [42.5, 66.9] | **no** |
| cli | 37/52 | 71% | [57.7, 81.7] | **no** |
| **global** | 229/382 | **60%** | [55.0, 64.7] | — |

**M1 gate is wired and re-measured (not assumed).** Its exit — "a region is admissible
iff its mutation score's 95% CI lower bound ≥ 0.90" — is *implemented*; **no current
region clears the bar**, so under G1′ the loop has **zero admissible regions** until
weakly-fenced files get characterization tests and the fence is re-audited. This is the
correctness gap M1 was built to expose (START_HERE: "~1 in 5 behavior changes slip"),
now quantified per region with CIs — and it is worse than the old global number implied.

## The "80% fence" was an optimistic artifact

The earlier audits reported **global 80% [66,89]**; this one finds **60% [55, 65]**. Two
sampling biases inflated the old figure: the old `TARGETS` list was hand-picked "files
with real test coverage", and it took only the **first match per operator** (top-of-file
guards, which are better tested). `fidelity.mjs` samples uniformly across **all** mutable
sites in **all** non-test files per region — more representative, and materially lower.
The regions the loop actually refactors are 53–65%, not 80%.

## End-to-end gate demo (same diff, verdict flips on the data)

A genuine behavior-preserving reduction in `mappers/node.ts` (`x === true` → `x` inside an
`if`; ΔL=3; **G1 behavior ✓, G3 types ✓, G4 size↓ ✓**):
- **real artifact** (mappers lo=51.9%) → G1′ ✗ → **REJECT** (risk 0.38, dominated by
  `1−mfence = 1−0.62`).
- **fixture** flipping mappers to lo=0.93 → G1′ ✓ → **KEEP** (loss −0.014, risk `1−0.97`).

So G1′ is a real *data-driven* hard gate (not a blanket reject), and the per-region
`mfence` now feeds `risk = r1·diffsize + r3·(1−mfence_region)` — replacing the hardcoded
`0.2`. Unmeasured regions / a missing artifact **fail closed**.

## How a region clears the bar (path off the blocked-list)

`fence-fidelity.json` carries a per-file survivor map. Add characterization tests
targeting those survivors, re-run `fidelity.mjs`, and a region clears when its Wilson lo
crosses 0.90. The bar is demanding by construction: at n=60 a region tolerates ~1
survivor; at n=90 (mappers) ~2 — i.e. it needs ≈100% of a ≥35-mutant sample caught.

## Caveats (honest bounds on the number)
- **Equivalent/trivial mutants** (e.g. operator flips inside data-table literals in the
  mapper files) survive without changing observable behavior, so the true fence power is
  *somewhat* higher than 60%. Counting them as survivors is conservative — the safe
  direction for a *safety* gate.
- **Operator family is 12** (relational/equality/logical/boolean-return/startsWith↔endsWith).
  Richer operators (statement deletion, boundary conditions) would probe more.
- A synchronous infinite loop from a flipped loop condition defeats vitest's per-test
  timer; `fidelity.mjs` uses a 45 s wall-clock SIGKILL and counts a hang as **caught**
  (in CI a hang times out → fails → caught). 2 such hangs occurred; both counted caught.

---

# Fence audit (mutation testing) — results

Hardening task #3. Run: `node experiments/mutation/audit.mjs` (isolated worktree).
Replaces the stubbed `mfence = 1` with a measured fence-power score.

## Mutation score = 12/15 = 80%

Injected behavior mutations (operator flips, boolean flips, startsWith→endsWith)
across 8 covered files; ran codenuke's real test suite per mutant.

| outcome | count |
|---|---|
| CAUGHT (test failed) | 12 |
| SURVIVED (all green despite behavior change) | 3 |

**Fence has teeth: 80% of behavior changes are caught.**

## Survivors = fence blind spots (where a refactor could change behavior undetected)
- `workflow/selection.ts` [startsWith → endsWith]
- `mapping/heuristic.ts` [=== → !==]
- `mapping/heuristic.ts` [startsWith → endsWith]

`heuristic.ts` is the weakest-fenced module (2 survivors). A refactor there is
riskier than the global 80% suggests.

## Metric implication
- `mfence` is now a real, measurable quantity (global 80%), and the audit yields a
  **per-module** blind-spot map.
- The risk term `r3·(1 − mfence)` should use the **per-region** mutation score, not
  a global constant: refactors in well-fenced regions (selection, json, reporting)
  carry low fence-risk; refactors in `heuristic.ts` carry high fence-risk and
  should require new characterization tests before they are admissible.
- This operationalizes the earlier "fence boundary = refactor boundary" finding:
  the mutation audit *measures* where the boundary is.

## Caveats
- Small sample (15 mutants, first-match-per-op). A production audit (StrykerJS)
  would mutate exhaustively for stable per-file scores.
- Mutation score measures fence power against *these* operators; richer operators
  (statement deletion, boundary conditions) would probe more.
