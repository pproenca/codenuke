# codenuke — Specification

**Autoresearch for behavior-preserving code reduction.**

> Status: this supersedes the earlier "refactor-thesis / hypothesis-first" v0. Our
> experiments showed that design over-built the search; the working shape is
> Karpathy's autoresearch loop (immutable metric + one mutable target + an agent
> that proposes from history + keep-or-reset) applied to refactoring. Metric details
> live in `METRIC.md`; all empirical claims are backed in `experiments/*/RESULTS.md`.

## 1. Thesis

codenuke runs an **autonomous loop** that makes a codebase smaller without changing
its behavior. An agent proposes a refactor, an **immutable metric** judges it, and
the change is **kept only if it genuinely reduces code while the behavior fence
holds** — otherwise it is reverted. Run indefinitely, the kept commits accumulate
into real, stacked reductions. This is the refactoring analog of nanochat
autoresearch (propose → measure `val_bpb` → keep/reset → repeat).

## 2. Why a loop, not a prompt / `/goal` / tool

A prompt is windowed and asserts behavior preservation; a `/goal` Goodharts a
scalar; tools are syntactic. The loop beats all three because the **metric is an
immutable, faithful ground-truth-style judge the agent cannot game** — exactly the
property that made `val_bpb` trustworthy. (Full argument: prior revisions; not
repeated here.)

## 3. Architecture (mapped to Karpathy's autoresearch)

| autoresearch | codenuke |
|---|---|
| `prepare.py` / `evaluate_bpb` (immutable metric) | **the scorer** — immutable, single command, agent cannot edit it |
| `train.py` (single mutable file) | **the repo source** in an isolated git worktree |
| `program.md` (agent skill) | **`program.md`** — the refactoring proposer's instructions |
| `val_bpb` (lower = better) | **loss** = `+∞` if inadmissible, else `risk − value` (lower = better) |
| keep-if-better / `git reset` | keep-if-`loss<0` / revert |
| `results.tsv`, branch `autoresearch/<tag>` | same |

### 3.1 The immutable scorer (the `val_bpb` analog)
A single command that scores the current worktree diff against the branch baseline
and emits `{ admissible, value, risk, loss, components }`. **The proposer may edit
only repo source; it must never be able to edit or read-around the scorer.**
Immutability *is* the integrity guarantee (a bad change cannot win by rewriting the
judge). See `METRIC.md` §1–§3.

### 3.2 The mutable target
The repo source, checked out in an isolated worktree (`autoresearch/<tag>`), so the
user's tree is never touched and reverts are a `git reset`.

### 3.3 `program.md` (the proposer's skill)
Human-authored instructions: the objective (reduce code), the hard constraints
(behavior preserved, types clean), the keep rule, the **simplicity criterion**
("remove code while keeping results; reject marginal gains that add ugly
complexity"), what kinds of reductions to attempt, and "never ask, run until
interrupted."

### 3.4 The loop
On branch `autoresearch/<tag>`, indefinitely:
1. Read state (`results.tsv` + the repo).
2. Propose a behavior-preserving reduction (edit source only).
3. Run the **scorer** (gates + value).
4. **Keep** (commit, advance baseline) iff `loss < 0`; else **revert** (`git reset`).
5. Append a row to `results.tsv`.
6. Repeat. No human in the loop during a run.

### 3.5 State
`results.tsv`: `commit | dAST | dCx | behavior | mfence_region | loss | status | description`
(`status ∈ keep|revert|crash`). The kept commits on the branch are the trajectory.

## 4. The metric (summary; full spec in `METRIC.md`)

**Lexicographic: gates (hard constraints) ≻ value.** A change is **admissible** iff:
- **G1 Behavior fence** — the pinned test suite was green on the baseline and is
  still green (behavior preserved).
- **G1′ Fence-fidelity gate** — the touched region's measured mutation score clears
  a threshold; weakly-fenced regions are **inadmissible** until characterization
  tests are added. *(This is the safety fix that makes 80%-faithful fences safe to
  run autonomously — see §6.)*
- **G3 Types** — `tsc --noEmit` introduces no new errors and no new `any`.
- **G4 Size** — net non-test AST nodes strictly decrease (at completion).

For admissible changes, **value** is z-scored reduction (size + complexity; clone
mass demoted), **keep iff `loss = risk − value < 0`**. The risk term includes
`(1 − mfence_region)`. Components must be z-scored — raw units make value ≈ ΔL
alone (corr 1.000).

**Locator/prioritizer is optional.** Karpathy's loop has no "where to look" oracle —
the agent proposes; the metric judges. codenuke needs none to be correct; a
validated prioritizer only improves experiment *efficiency*.

## 5. What is validated (with statistics)

| layer | status | evidence |
|---|---|---|
| Behavior fence (G1) | **validated** — catches a real mutation; mutation score **80%, 95% CI [66,89] (n=45)** | experiments/mutation, transition |
| Type / size gates | **exact, zero variance** | experiments/metric-separation |
| Self-policing | **validated** — a higher-reduction-but-behavior-breaking change is rejected (N2; loop REJECT) | metric-separation, loop |
| Complexity density (value/quality) | **significant** state discriminator (p=1.4e-4) + **promising** temporal predictor (codenuke AUC 0.80, p=0.007) | experiments/stats |
| Co-change (value/locator) | **FALSIFIED** — no predictive validity, worse than churn | experiments/stats |
| Clone mass / dup rate (value) | **not significant** (p=0.51) | experiments/stats, real-validation |

## 6. What is missing (prioritized)

> **Status (updated):** items 1–3 are now BUILT + verified; the gap is now a valid
> *substrate* and the loop's fence-raising move. See `experiments/loop/RESULTS.md`
> (M3) and `experiments/mutation/RESULTS.md` (M1).

1. ~~**The autonomous proposer loop (core mechanism).**~~ **DONE** — `autoloop.mjs`
   drives propose (`claude -p`, edit-only) → score → keep/revert → log, no human; a
   real LLM proposer kept a reduction unattended.
2. ~~**Fence-fidelity gate (safety blocker).**~~ **DONE (gate)** — G1′ wired (per-region
   admissibility, Wilson CI-LB ≥ 0.90, fail-closed). But re-measurement found the fence
   is **60% [55,65]** (the "80%" was optimistic) and **0/6 regions clear 0.90**, so the
   gate currently blocks everything on codenuke. Open: characterization tests / the bar.
3. ~~**Plumbing.**~~ **MOSTLY DONE** — immutable scorer command (`loop.mjs score --json`),
   `program.md`, `results.tsv`. TODO: dedicated `autoresearch/<tag>` branch.
4. **Valid substrate + fence-raising move (the new top gap).** codenuke is tidy + weakly
   fenced → the loop correctly keeps nothing. Need a headroom repo with a strong suite,
   and/or a loop move that auto-adds characterization tests to clear a region before
   refactoring it.
5. **(Optional) Validated prioritizer:** finish the complexity value-signal
   out-of-sample (opencode with blobs + a 3rd repo, ≥30 positives, churn-controlled)
   so the agent spends experiments where value is likeliest.

## 7. The honest ceiling

Karpathy optimizes **ground truth** (`val_bpb` *is* model quality). codenuke
optimizes a **proxy**: "less code with tests passing." The objective (size) is
measured faithfully; the constraint (behavior) is 80% faithful; and "less code"
itself is only a proxy for the real goal (lower future-change cost), which we showed
is hard to measure (co-change failed). So a working codenuke reliably produces
**smaller, behavior-preserving, type-clean code** — a good but not ground-truth
proxy for "better." This ceiling is stated, not hidden.

## 8. Safety (retained)

Report/score never mutates the user tree (worktree isolation). Refuses dirty
worktrees. Never commits/pushes to the user's branch; the loop lives on
`autoresearch/<tag>`. Append-only `results.tsv`; a run resumes from its branch HEAD.

## 9. Non-goals

No tiny refactors (sub-floor reductions rejected by `loss<0`). No bug hunting. No
"cleaner" without measured reduction. No autonomous landing to the user's branch.
No single-scalar LOC target (the gates prevent Goodharting). No DB (files + git).
