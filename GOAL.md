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
- M1: **gate WIRED + re-measured; exit NOT met.** `loop.mjs` applies G1′ (region
  admissible iff Wilson lo ≥ 0.90, read from pinned `fence-fidelity.json`, fail-closed).
  Re-measured: **0/6 regions clear the bar** (mappers 62% [51.9,71.5] … cli 71%
  [57.7,81.7]) → the loop currently has **zero admissible regions** until weak fences
  get characterization tests + re-audit. Gate proven data-driven end-to-end (same diff:
  REJECT on real artifact, KEEP on a fixture flipping the region admissible).
- M2: **mostly done.** Scorer is a single command (`loop.mjs score --json`); immutable in
  practice (the proposer's toolset has no Bash/git, so it can't touch the judge);
  `program.md` written; `results.tsv` adopted. TODO: a dedicated `autoresearch/<tag>`
  branch (today the worktree commits are the trajectory).
- M3: **autonomous loop BUILT + verified** (`autoloop.mjs`: propose via `claude -p` →
  score → keep/revert → log, no human). A real LLM proposer kept a ΔAST=34 reduction
  unattended (`mappers/shared.ts`, loss −0.568). **Exit (≥10 kept iters on a real repo)
  NOT met:** codenuke has no admissible region (fence too weak) *and* no headroom — needs
  a headroom substrate or the loop's fence-raising move. See experiments/loop/RESULTS.md.
- M4–M5: not started.

## Immediate next two moves

1. **M1 finish** — the gate is wired + measured but **no region is admissible**. To
   clear the exit, add characterization tests targeting the per-file survivors in
   `fence-fidelity.json` (start with mappers, the loop target), re-run `fidelity.mjs`,
   and get ≥1 region's Wilson lo over 0.90. *Open question this surfaced:* the 0.90-CI-LB
   bar may be too strict for any region to clear at a feasible mutant budget — decide
   whether to keep it, soften to a point estimate, or coarsen regions.
2. **M3 exit (loop is BUILT)** — `autoloop.mjs` runs propose→score→keep/revert→log
   unattended (verified with a real `claude -p` proposer). To hit the *exit* (≥10 kept
   iters), stand up a **headroom** TS repo with a strong test suite, measure its
   fence-fidelity (`fidelity.mjs`), and run `autoloop.mjs` there. Optionally add the
   **fence-raising move** (loop auto-adds characterization tests to clear a region, then
   refactors) so it can earn admissibility on weaker substrates autonomously.

Hold every step to its measured exit. Keep negative results. Ship when R1–R5 pass.
