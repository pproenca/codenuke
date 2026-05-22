# The refactoring objective — construction and proofs

> The problem: build a metric that can be *the objective* of an autonomous loop (like
> Karpathy's `val_bpb`) for "same behavior, less code, structured so future change is
> cheaper/safer/clearer." This file constructs it and proves its structural properties.
> The boundary between what is *proved* (deductive) and what must be *measured*
> (empirical) is stated explicitly — it is the same boundary `val_bpb` lives on.

## 0. The reduction: refactoring is compressing the future

A program is a point `C` in AST space `P`. Behavioral equivalence `~` partitions `P`
into **fibers** `[C] = {C' : ∀ inputs i, C'(i)=C(i)}`. Refactoring = move within `[C]`.

Let `𝒟` be the (unknown) distribution of future change-requests `δ`. A change `δ` maps a
program to a post-change program `C_δ` (new behavior `B_δ`). Define the cost of `δ` at `C`
as the **conditional description length** of the next version given the current one:

```
cost(δ, C) = K(C_δ | C)            (bits to specify the next version, given this one)
𝒱(C)       = 𝔼_{δ~𝒟}[ K(C_δ | C) ] (expected cost of the next change)   ← THE objective
```

`K(·|·)` is conditional Kolmogorov complexity. This is the exact analog of `val_bpb`:

| Karpathy | refactoring |
|---|---|
| model `θ` | code `C` |
| held-out **data** | held-out **future edits** `δ~𝒟` |
| `val_bpb = −(1/bytes)·log₂ P_θ(data)` | `𝒱(C) = 𝔼_δ K(C_δ|C)` |
| "model that predicts its data cheaply" | "code that **absorbs its own future** cheaply" |

Both are *the conditional codelength of a held-out distribution under a model*. **A good
refactor trains the code to predict (cheaply encode) its own future.** That is the whole
idea, and it is mathematically the same object as language modeling.

## 1. Theorem T1 — necessity of `𝒟` (no code-only metric can be the objective)

**Claim.** No metric `M(C)` that is a function of the code alone (independent of `𝒟`) is a
valid change-cost objective: for any such `M` there is a refactor and two change
distributions on which `M` has the wrong sign.

**Proof (the dedup sign-flip).** Take a behavior with two features `f₁,f₂` whose code
shares an identical-looking subroutine `g`. Two representatives in the **same fiber**:

- `C_dup`: `g` written out in both (`L` larger).
- `C_abs`: `g` factored into one shared `h`, both call it (`L` smaller).

Consider two change distributions:

- `𝒟_coupled` — changes edit `g`'s logic uniformly for both features.
  `cost(δ,C_dup)=2·|patch|` (two sites), `cost(δ,C_abs)=|patch|` (one site).
  ⇒ `𝒱(C_abs) < 𝒱(C_dup)`. Dedup helps. (`L` agrees.)
- `𝒟_decoupled` — changes edit `f₁`'s variant independently of `f₂`.
  `cost(δ,C_dup)=|patch to f₁|` (local). In `C_abs` you must parameterize/splice `h` and
  fix `f₂`'s call site ⇒ the edit is non-local: `cost(δ,C_abs) > cost(δ,C_dup)`.
  ⇒ `𝒱(C_dup) < 𝒱(C_abs)`. Dedup **hurts**. (`L` still says dedup is better — wrong.)

The same refactor `C_dup→C_abs` lowers `𝒱` under `𝒟_coupled` and raises it under
`𝒟_decoupled`. A code-only `M` returns the same verdict for both ⇒ wrong for one. ∎

**Corollary (why every static/historical proxy codenuke tried failed).** "Less code,"
clone-mass, complexity-alone are code-only ⇒ invalid by T1. Co-change tried to *estimate*
`𝒟` from git history and was falsified out-of-sample (biased, sparse, backward,
reflexive). **T1 says you cannot avoid `𝒟`; the falsification says you cannot read it off
history. The only remaining move is to *fix* `𝒟` as a held-out benchmark (a val-set).**
This also explains the opencode result exactly: `PluginV2.define ×33` is `𝒟_decoupled`
(33 independently-evolving plugins) — the "duplication" is correct; deduping it would
couple 33 independent things and raise `𝒱`.

## 2. Theorem T2 — the objective is U-shaped in size; `L`-minimization overshoots

**Claim.** Under the realistic assumption that `𝒟` is **concept-local** (its mass is on
changes confined to single concepts), `𝒱` is non-monotone in code size `L`: it has an
interior minimum at a **modular, slack-bearing** representative, and *strictly increases*
as `C` is compressed toward the Kolmogorov-minimal representative `C*`.

**Proof.** Two walls of the U, one mechanism (T1's sign-flip):

- *Left wall (under-compression).* A duplicated concept (`k` copies) makes every
  `𝒟_coupled` change cost `∝ k`. Compressing toward one copy lowers `𝒱`. So below the
  optimum, `L↓ ⇒ 𝒱↓`.
- *Right wall (over-compression).* `C*` has, by minimality, **no redundancy**: every bit
  participates in producing `B`, so concepts that share substructure are *entangled* in
  one representation. For a concept-local change `δ` (mass of `𝒟` by assumption), the
  minimal edit cannot be confined to the concept — it must touch shared machinery, so
  `K(C*_δ | C*) ≥ K(C_mod,δ | C_mod)` for any representative `C_mod` that isolates the
  concept in a module, with **strict** inequality whenever `𝒟` has ≥2 separable concepts
  that minimality entangles (generic). So above the optimum, `L↓ ⇒ 𝒱↑`.

The right wall is exactly T1's `𝒟_decoupled` case taken to the compression limit:
minimality merges every shared form, including the `𝒟`-decoupled ones. Hence `𝒱` has an
interior minimizer `C_opt` with `L(C_opt) > L(C*)`. ∎

**Consequence.** The Kolmogorov-minimal program is **maximally fragile** (maximal change
cost). "Make the code as small as possible" provably overshoots the maintainability
optimum. The target is *minimal description of the future*, `𝔼K(C_δ|C)`, **not** minimal
description of the present, `K(C)`. They coincide only on the shared redundancy term.

## 3. Theorem T3 — commensuration: cheaper/safer/clearer collapse to one observable

The triple looked like an incommensurable partial order (no scalar IS the objective).
It is not — the three are **components of a single quantity**, the effort to make the next
change, once you measure the *downstream* quantity instead of static proxies:

```
cost(δ, C) = edit(δ, C)              +  β · verify(δ, C)
           = |minimal correct patch|    + (residual risk it broke something)
             └ cheaper (size of edit)    └ safer (verification effort)
             └ clearer (comprehension is prerequisite to a *correct minimal* patch)
```

- **cheaper** = small `edit` (few sites, low ripple) = the cut/redundancy story of §0–2.
- **clearer** = you cannot produce a *correct minimal* patch to code you cannot
  understand; comprehension cost is inside `edit`.
- **safer** = small `verify`: effort/risk to confirm no regression. This is a property of
  the **fence**, not the source — `verify(δ,C) ∝ (1 − fence-fidelity near δ)`. A
  well-fenced region is cheap to change *safely*; a refactor that raises the fence where
  future changes land lowers `verify` = genuine value.

All three are in one currency — **effort (bits)** — so the partial order becomes a total
order and "keep if better" is well-defined again. This is precisely Karpathy's move:
`val_bpb` commensurates architecture/optimizer/batch-size into one number by measuring the
actual downstream quantity (held-out compression). We commensurate cheaper/safer/clearer
into one number by measuring the actual downstream quantity (cost of the next change). The
weights aren't arbitrary `w_i` — they are summed effort. *(This is the one definitional /
modeling step, not a deductive theorem: it asserts effort is the common currency. It is
standard and, crucially, it is the same status as the claim "`val_bpb` = model quality.")*

## 4. The construction — `evaluate_changecost` (the val-set move, made exact)

**The missing `prepare.py`.** Fix a held-out, immutable benchmark of change-requests
`Δ = {δ₁,…,δ_m}`, each with an acceptance test `T_j` defining "done correctly." Sources:
(a) synthetic controlled change-axes (inject a known future, e.g. "add a 4th provider"),
(b) curated real change-requests. `Δ` is the val-set; it is **fixed** and **the proposer
never sees it** (only the scorer runs it).

**Ground-truth value (periodic, observable).**
```
𝒱̂(C) = (1/m) Σ_j [ edit(δ_j, C) + β · verify(δ_j, C) ]
   edit(δ_j,C)   = AST-diff size of a *correct* implementation of δ_j on C (gated by T_j)
   verify(δ_j,C) = 1 − mutation_score(region touched by δ_j, after implementing it)
```
A refactor `C→C'` is **good iff `𝒱̂(C') < 𝒱̂(C)`** on the *same* `Δ`.

**Inner loop (cheap, deterministic).** A static proxy `m̂(C)` = duplication-amplification
of touched concepts + complexity-density + size, behind the **behavior + fence gate**,
**validated** to rank-correlate with `𝒱̂` out-of-sample (Spearman `ρ ≥ 0.6`). This mirrors
exactly the safety stack that already works: cheap fence (inner loop) calibrated by
periodic mutation testing (ground truth). Here: cheap `m̂` (inner loop) calibrated by
periodic `𝒱̂` (ground truth).

### Theorem T4 — observability & comparability (the `val_bpb` recovery)
1. `edit(δ_j,C)` is a **computable upper bound** on `K(C_{δ_j}|C)` (any concrete correct
   edit is a description of `C_δ` given `C`). Exactly as cross-entropy ≥ entropy: you
   minimize a computable upper bound on an uncomputable ideal.
2. Measured on a **fixed** `Δ`, differences `𝒱̂(C')−𝒱̂(C)` are comparable across candidates
   even though the absolute value over-estimates `𝒱`. (The `val_bpb` "fixed val-set"
   property.) ∎

### Theorem T5 — self-policing (cannot be improved by degrading the objective)
Assume (i) the proposer is **blind** to `Δ` and to the scorer (no read access — in
codenuke, no Bash/git/file-read of the benchmark), (ii) each `δ_j` is admitted only if it
passes `T_j`, (iii) the refactor is admitted only inside the behavior+fence gate
(`C'~_Φ C`, fence-fidelity ≥ τ). Then no admissible move lowers `𝒱̂` by degrading the true
objective:
- *Break behavior to cut edit cost* → blocked by the gate and by every `T_j`.
- *Over-abstract / golf to cut size* → `𝒱̂` **measures the resulting change cost**, which
  over-abstraction raises (T2); the metric self-corrects where size-metrics are fooled.
- *Special-case the benchmark* (overfit the val-set) → impossible: the proposer cannot see
  `Δ`, so it can only make structural changes that generalize. (This is why Karpathy's
  agent edits `train.py` but never sees the val data.)
∎ Self-policing holds **iff the benchmark is held out from the optimizer** — the same
condition that makes `val_bpb` honest.

### Theorem T6 — additivity / transfer (kept changes stack)
Let refactors `R₁,R₂` have AST supports `A₁,A₂`. Partition `Δ` by which supports each
change's edit touches. If **no benchmark change spans both** (`Δ₁₂ = ∅`, the
disjoint-change-support condition), then
```
𝒱̂(C) − 𝒱̂(R₂R₁C) = [𝒱̂(C) − 𝒱̂(R₁C)] + [𝒱̂(C) − 𝒱̂(R₂C)]
```
because each `δ`'s cost depends only on the structure of the region it touches. ∎ This is
the parallelism license (disjoint supports run concurrently) and the stacking property —
the analog of Karpathy's ~20 kept changes summing to ≈+11%. When `Δ₁₂ ≠ ∅` there is an
interaction term (changes spanning both regions), sub- or super-additive as the refactors
jointly help or hurt cross-region changes.

## 5. What is proved vs what must be measured (the honest boundary)

**Proved (deductive):** T1 (static metrics are invalid — you must condition on `𝒟`),
T2 (the objective is conditional future-codelength, U-shaped; less-code overshoots),
T4 (the benchmark estimator is a computable, comparable upper bound),
T5 (self-policing under proposer-blindness),
T6 (additivity under disjoint supports).

**Definitional (modeling):** T3 (effort is the common currency commensurating the triple)
— same status as "`val_bpb` = model quality."

**Empirical (must be run, cannot be proved):** that the cheap proxy `m̂` tracks `𝒱̂`
out-of-sample (`ρ ≥ 0.6` on ≥2 repos), and that `Δ` is representative of the true `𝒟`.
This is exactly the status of `val_bpb`'s own validity (its identity with "quality" is
definitional + empirical, never proved). **We have not removed the empirical step —
we have moved it to the right place:** from "does *less code* mean lower cost?" (false by
T1) to "does our cheap proxy track *measured* change cost?" (answerable, honest).

## 6. Why this is the solution

The error was scoring the code. The objective with Karpathy's properties — observable,
comparable, self-policing, additive — is the **conditional codelength of the future**,
and it becomes all four the moment you (a) **fix a held-out change-benchmark** (so `𝒟` is
observable and comparable, sidestepping the falsified historical estimator), (b) **measure
realized edit+verify cost** on it (so the metric *is* the objective, not a correlate),
(c) **hide the benchmark from the proposer** (so optimizing it can't be gamed and can't
overfit), and (d) keep the cheap static proxy only as a *validated* inner-loop accelerator.
Less code stops being the goal and becomes one term (shared redundancy) of a measured
cost. Safer and clearer stop being separate axes and become the `verify` and
comprehension components of the same measured cost.

## 7. Mapping to codenuke (what to build)

- **Build the benchmark `Δ`** — this is the real missing `prepare.py`/`evaluate_bpb`. Start
  with synthetic controlled change-axes (SPEC §4.1b, run *forward* as the metric, not
  backward as validation) + a few curated real change-requests, each with an acceptance test.
- **`evaluate_changecost`** = implement each `δ_j` (a *blind* sub-agent), score
  `edit` (paired AST-diff: same agent+seed on `C` and `C'` to cancel idiosyncrasy) +
  `β·verify` (mutation score on the changed region — reuse `fidelity.mjs`).
- **Demote `L`** from objective to one component of the validated inner-loop proxy `m̂`;
  add the **change-coupling cut** measured from `Δ` (which `δ_j` touch which atoms), *not*
  from imports (`κ` uses the wrong graph) or history (falsified).
- **Credit fence-raising as value** (it lowers `verify`), not merely as a gate-opener.
- **Validate** `ρ(m̂, 𝒱̂) ≥ 0.6` held-out before letting `m̂` drive the loop unattended;
  re-audit `𝒱̂` periodically (the calibration cadence the fence already uses).
