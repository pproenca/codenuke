# codenuke autoresearch — Goal

> The operational target that drives iteration. The rule: **do not advance a
> milestone until its exit criterion is *measured*, not asserted.** Every claim gets
> a CI or p-value (the co-change falsification is the model — rigor over hope).

## North star

A working refactoring autoresearch loop: an autonomous agent that, on a real
TypeScript repo, proposes behavior-preserving refactors judged by an immutable,
faithful metric, keeping only genuine net reductions — the refactoring analog of
nanochat autoresearch (Karpathy: ~700 experiments, ~20 kept, +11% on the leaderboard
metric, additive and transferable).

## Definition of "working" — the success metric (the leaderboard-entry analog)

On a real mid-size TS repo, a single **unattended** run satisfies ALL of:

- **R1 — Reduction.** ≥ **10%** net reduction in non-test AST nodes, cumulative
  across kept commits.
- **R2 — Behavior preserved.** The pinned test suite is green at *every* kept
  commit, AND an **independent** characterization-test audit on a random sample of
  ≥10 kept commits finds **zero** behavior regressions. (Independent = tests written
  by a process other than the proposer.)
- **R3 — Genuine.** ≥ **90%** of kept reductions pass **blind review** as "real
  reduction," not churn / abstraction-shuffling / golf.
- **R4 — Additive.** Cumulative reduction ≈ Σ of individual kept reductions
  (stacking holds within ~15%) — Karpathy's additivity property.
- **R5 — Autonomous.** ≥ **50** kept iterations with **zero** human intervention
  during the run.

When R1–R5 hold on one real repo, codenuke autoresearch is "working."

## Milestone ladder (iterate until each EXIT passes)

**M1 — Close the safety measurement (BLOCKER).**
Wire the per-region fence-fidelity gate (SPEC §4 G1′).
*Exit:* a region is admissible iff its measured mutation score has 95% CI lower
bound ≥ **0.90**; weakly-fenced regions (`change-audit.ts`, `detect.ts`, …) are
blocked or given characterization tests until they clear it. Re-measured, not
assumed.

**M2 — Immutable harness + plumbing.**
Package the scorer as one immutable command; write `program.md`; adopt
`results.tsv` + `autoresearch/<tag>`.
*Exit:* `codenuke score` runs on a worktree diff and emits `{admissible,value,risk,
loss}`; the proposer demonstrably cannot edit the scorer; every iteration is logged.

**M3 — Autonomous loop runs.**
An LLM proposer drives propose → score → keep/reset → log, unattended.
*Exit:* one command runs ≥ **10 kept iterations** end-to-end with no human input,
on a real repo, leaving a green branch.

**M4 — Validated run.**
On a real repo, a ≥20-iteration run is audited.
*Exit:* **R2** (independent characterization audit: zero regressions), **R3** (blind
review ≥90% genuine), and **R4** (additivity within ~15%) all hold.

**M5 — Hit the success metric.**
*Exit:* **R1–R5** all pass on a real mid-size TS repo.
*(Optional booster: a validated complexity prioritizer — out-of-sample AUC CI lower
bound > 0.5 on ≥2 repos — so the agent spends experiments where value is likeliest.)*

## Current state vs the ladder

- Metric gates: **validated** (type/size exact; self-policing shown). Fence: the
  global "80%" was an optimistic artifact — per-region random sampling gives **60%
  [55,65]** (regions 53–71%; experiments/mutation/RESULTS.md).
- Value signal: co-change **falsified**; complexity **promising** (not yet robust).
- M1: **gate WIRED + re-measured + ESCAPE PATH PROVEN.** `loop.mjs` applies G1′ (region
  admissible iff Wilson lo ≥ 0.90, pinned `fence-fidelity.json`, fail-closed). Initial
  re-measure: 0/6 regions clear the bar (60% [55,65]). But the loop's **fence-raising
  move now clears a region autonomously**: `cli` was driven 47%→**91% lo (ADMISSIBLE)** by
  LLM-written characterization tests + monotonic replay (experiments/loop/RESULTS.md §3).
  So "blocked OR given characterization tests until they clear it" is real, not aspirational.
- M2: **done.** Scorer is one command (`loop.mjs score --json`); immutable in practice
  (proposer toolset has no Bash/git); `program.md`, `results.tsv`, and the
  `autoresearch/<tag>` branch all in place.
- M3: **autonomous loop COMPLETE — both moves + mode-switch proven on the REAL fence.**
  `autoloop.mjs` runs `propose → score → keep/revert → log`, no human, choosing **raise**
  (add characterization tests to earn admissibility) when blocked and **reduce** when
  admissible. Proven: raise (cli 47%→91% lo), the mode-switch (→reduce on crossing 0.90),
  reduce self-policing (G3 reverts), and a kept reduction (ΔAST=34, mappers/shared.ts).
  **Exit (≥10 kept iters) NOT met:** needs a region that is *both* admissible *and* has
  reduction headroom (cli is admissible but type-tight; mappers has headroom but unraised).
- M4–M5: not started — need the headroom-and-raisable substrate + equivalent-mutant
  exclusion (regions with >10% equivalent mutants can't reach lo 0.90 by testing alone).

## Immediate next moves (the loop is COMPLETE; these drive it to the M5 exit)

The mechanism is done and proven on the real fence (raise + reduce + mode-switch +
self-policing). What remains is reaching the *quantitative* exits (R1–R5):

1. **Equivalent-mutant exclusion.** A region whose equivalent-mutant rate exceeds ~10%
   can never reach lo ≥ 0.90 by testing (e.g., cli's last `&&` survivor). Add a *reviewed*
   exclusion: the proposer may flag a survivor as equivalent **with justification**, but
   the exclusion is confirmed by an independent judge, never by the optimizer (Goodhart).
2. **Run on a headroom-and-raisable region.** Need one region that is *both* admissible
   (raisable to lo ≥ 0.90) *and* has reduction headroom. cli is admissible but type-tight;
   mappers has headroom but unraised. Either raise mappers, or point the loop at a
   mid-size TS repo with cruft + a real suite; then run `autoloop.mjs` for ≥10 kept iters.
3. **Then M4/M5:** audit a ≥20-iter run for R2 (independent characterization audit),
   R3 (blind review ≥90% genuine), R4 (additivity); ship when R1–R5 hold.

Hold every step to its measured exit. Keep negative results. Ship when R1–R5 pass.
