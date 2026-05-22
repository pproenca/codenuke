# codenuke — The Refactoring Loss Metric (TypeScript + React)

> Scope: TypeScript and React only, for now. The *framework* (gates ≻ objective,
> validation protocol) is language-general; the *operationalizations* (tooling)
> are TS/React-specific.
>
> Goal: a fitness/loss metric with the three properties that made Karpathy's val
> loss trustworthy enough to run an autonomous loop:
> 1. **Self-policing** — improving the metric cannot be achieved by degrading the
>    true objective (behavior). (discrete math)
> 2. **Cheap & deterministic** — runnable hundreds of times, same input → same
>    score. (computer science)
> 3. **Validated to transfer** — shown to track real refactoring quality on a
>    ground-truth corpus, with controls, before it is allowed to drive the loop.
>    (biology)
>
> A metric is **not allowed to drive the autoresearch loop until §4 passes.**

---

## 0. The latent construct (what we are actually measuring)

The trait codenuke optimizes is **future change cost**: the expected effort and
risk to make a *class* of change. It is unobservable directly — it is a
counterfactual about edits not yet made. So, as in biology, we measure
**phenotypes** (proxies) and must *validate* that the proxies track the latent
trait. Raw LOC is not the trait; it is one cheap, gameable phenotype of it.

---

## 1. Discrete-math layer — formal definition

### 1.1 Objects (all computed from the TS AST + type graph)

For a codebase state `C`:

- `L(C)` — **logical code size**, in AST-node units over non-test source.
  Counted on the parsed TypeScript AST, *not* on newlines. (See P1.)
- `Dup(C)` — **duplication mass**: total token-length of type-2/type-3 clones.
- `Gdep(C) = (V,E)` — module dependency graph (nodes = modules, edges = imports).
- `κ(C)` — **coupling**, measured at module granularity:
  `κ(C) = Σ_v fanin(v)·fanout(v)` over `Gdep`. (Module-level by design — see P5.)
- `Ref(C)` — symbol reference graph (exported symbols → references).
- `X(C, δ)` — **change amplification** for change-class `δ`: the size of the
  ripple set (modules/symbols that must change) to implement `δ`. Cheap static
  proxy for duplication-collapse: the number of clone sites.
- `Φ(C)` — **behavior fingerprint**: the pass/fail vector of the pinned
  characterization suite.
- `Cov(C,R)` — statement+branch coverage of region `R`.
- `Ty(C)` — type-soundness: `tsc --noEmit` diagnostic count + count of `any`
  introductions.
- `CRAP(C)`, complexity — at module granularity.

### 1.2 The metric is defined on a *transition* `C → C'` (a candidate refactor),
not a single state — refactoring quality is a property of the delta.

### 1.3 Admissibility (the gates — hard constraints)

`C → C'` is **admissible** iff ALL hold:

- **G1 Behavior invariance.** `Φ(C') = Φ(C)`, AND the suite was green on `C`
  (pinned to *observed* old behavior, not the agent's intention).
- **G2 Coverage non-decrease** on the refactored region `R`: `Cov(C',R) ≥ Cov(C,R)`.
- **G3 Type soundness.** `Ty(C')` introduces no new `tsc` errors and no new `any`.
  *(TS gift: the type checker is a free partial proof that interfaces are
  preserved — a behavioral constraint most languages don't give for free.)*
- **G4 Size monotonicity at completion.** `L(C') < L(C)`, evaluated when the
  refactor is complete (old shape deleted). Intermediate migration slices may
  grow `L`.

### 1.4 The loss

```
loss(C → C') =  +∞                              if inadmissible        (constraint dominance)
                -gain(C → C') + risk(C → C')    if admissible
```
Lower is better. The `+∞` for inadmissible transitions makes this a **constrained
optimization, lexicographic with safety ≻ value**: you maximize value *within*
the behavior-feasible region. Safety is never traded for value because it is a
constraint, not a weighted term. **This is how we reproduce val loss's
self-policing without a single magic number.**

```
gain(C → C') = w0·ΔXcochange + w1·ẑL + w2·ẑCx  (+ w3·ẑDup, weak)   [ẑ = z-scored vs corpus]
risk(C → C') = r1·diffsize(C,C') + r2·max(0, ΔCRAP) + r3·(1 − mfence)

# Reduction components MUST be z-scored before weighting — raw units make gain ≈ ΔL
# alone (corr 1.000). Fitted relative weights (held-out AUC 0.819): ẑCx:ẑL:ẑDup ≈
# 1.8:1.0:0.35  (complexity reduction is the strongest per-commit signal).
# See experiments/weights/. Treat as a calibrated starting point (weak labels).
```
where reduction is positive, and `mfence` is the mutation score of the fence
(audited, not per-run — see §3). Weights `w,r` are **fit by regression on labels,
not guessed** (§4.4).

> **Validation finding (revised by evidence — experiments/real-validation/).**
> The original gain leaned on `ΔDup` (clone mass). A good-vs-bad real-TS contrast
> (opencode vs codenuke) **falsified clone-mass as a value signal**: the *good*
> codebase had 2.5–4× more syntactic duplication, because consistent use of one
> well-designed API (`PluginV2.define` ×33 across 32 independent plugins) reads as
> "duplication." Raw clones cannot tell *good consistency* from *harmful,
> change-coupled duplication*. So:
> - **`ΔXcochange` (change-amplification) is now the primary value term**, measured
>   as **recurring *maintenance* co-change** from git history — distinct
>   non-creation, non-codegen commits where a cluster changes together (raw Jaccard
>   alone is confounded by codegen, batch-creation commits, and sparse history).
>   This is the executable form of the spec's `changeScenario`. (Earlier in-sample
>   evidence: codenuke mappers showed 2–2.6× elevated co-change.)
> - **`ΔComplexity` is a validated term** (the contrast confirmed complexity density
>   is higher in the bad codebase).

> ⚠️ **STATISTICAL CORRECTION (experiments/stats/ — supersedes the above).** A
> rigorous *out-of-time* predictive test (PAST co-change → FUTURE refactor
> locations, with a churn control) **FALSIFIES `ΔXcochange` as a value signal:**
> on opencode (n=18) co-change AUC=0.61, 95% CI [0.485, 0.739], permutation p=0.056
> (fails significance), and is *significantly worse than churn* (AUC 0.72, p=6e-4);
> frequency-removed co-change is at chance (AUC 0.44). **The 2–2.6× "generalization"
> was an in-sample, churn-confounded artifact.** Status of value signals after
> rigorous testing:
> - `ΔXcochange` (co-change): **NOT predictively valid** — do not use as primary value.
> - duplication rate: **not a significant** good/bad discriminator (Mann-Whitney p=0.51).
> - `ΔComplexity`: **significant** state discriminator (p=1.4e-4, ratio 1.35 [1.18,1.68],
>   effect 0.365); predictive (transfer) validity for *locations* still under test.
> - **complexity density** is the candidate value signal: significant state
>   discriminator (p=1.4e-4) AND significant temporal predictor of refactor
>   locations on codenuke (AUC 0.80, perm p=0.007, n=6 — promising, needs opencode
>   replication + more positives). **churn** predicts on opencode (AUC 0.72) but may
>   be mechanical. The SAFETY gates remain validated: fence mutation score **80%,
>   95% CI [66%, 89%] (n=45)**; type/size deterministic. Net: Karpathy-grade SAFETY,
>   a promising-but-not-robust VALUE signal (complexity), and a clear path to close it.
> - **`ΔDup` is demoted to weak corroboration**, never a primary driver.
> - Codebase-level contrast validates *state* signals (complexity); *transition*
>   signals (reducible mass) must be validated on real before/after refactor pairs.

### 1.5 Properties we require (and how each is established)

- **P1 Formatting invariance.** `L` and `Dup` are AST/token based ⇒ reformatting,
  renaming-only, and whitespace changes give `ΔL = 0`. *Established by
  construction.* (Kills "reward for cosmetic churn.")
- **P2 No-op is the origin.** Identity transition is admissible with `gain = 0`.
  Do-nothing is a zero-loss fixed point; a refactor must beat it. *(The
  do-nothing default, formalized.)*
- **P3 Behavior break ⇒ rejected.** Any `C'` with `Φ(C') ≠ Φ(C)` has `loss = +∞`
  regardless of `ΔL`. *Established by the lexicographic gate.* This is the
  property a `/goal` and raw-LOC objective lack.
- **P4 Additivity on disjoint supports.** If two refactors touch vertex-disjoint
  ripple sets, their gains add: `gain(C→C'') = gain(C→C') + gain(C'→C'')`.
  *Established because `ΔL`, `ΔDup` are additive over disjoint AST supports, and
  `Δκ` is additive when the supports share no `Gdep` edges.* **This theorem is
  the parallelism license: swarm agents may run concurrently iff their supports
  are disjoint; overlapping supports must serialize.**
- **P5 Goodhart resistance** — each known gaming move is mapped to the gate that
  blocks it:
  | Gaming move | Blocked by |
  |---|---|
  | Golf 10 lines → 1 | P1 (AST size unchanged) |
  | Delete a feature/branch to cut LOC | G1 (Φ changes ⇒ +∞) |
  | Split one fn into five ("extract churn") | κ measured at module level rises; `ΔL` counts both halves ⇒ gain≈0 |
  | Add `assert(true)` tests to lift coverage | r3 mutation-score term + §4 negative control |
  | Introduce `any` to silence tsc | G3 (no new `any`) |
  | Big diff that just moves code | r1 diffsize penalty + low `ΔX` |

---

## 2. Computer-science layer — what is computable, cheaply, deterministically

| Quantity | TS/React tool | Determinism | Cost |
|---|---|---|---|
| `L` (AST nodes) | TypeScript compiler API / ts-morph | exact | ms |
| `Dup` | jscpd (token clones) or suffix automaton | exact (fixed config) | s |
| `Gdep`, `κ` | ts-morph import graph / madge | exact | s |
| `Ty` gate | `tsc --noEmit` (+ `any` count via AST) | exact | s (incremental) |
| `Φ`, `Cov` | vitest/jest + v8/istanbul coverage | *modulo flakiness* | s–min (affected tests) |
| React behavior fence | React Testing Library (render→accessible tree), snapshots | modulo flakiness | s |
| `mfence` (audit only) | StrykerJS mutation testing | exact | min–hr → **not inner loop** |

**React specifics.** The fence boundary for a component is its props/effects →
rendered accessible tree (RTL `render` + queries). This matches our empirical
finding "fence boundary = refactor boundary": refactors are scoped to what RTL
can observe. React's real structural taxes — duplicated prop-drilling, repeated
`useEffect`/data-fetching patterns, copy-pasted conditional rendering — are
detectable in `Dup`/`κ` and collapsible behind a stable RTL boundary.

**Reliability engineering (the assay must be clean).** Flaky tests are
*measurement noise* — the biologist's enemy. Before a test joins `Φ`: run it K
times on unchanged `C`; if not 100% stable, **quarantine it** (excluded from the
fence). Pin Node version, disable test-level nondeterminism (fake timers, seeded
RNG), and run measurements single-threaded. Inner loop = `L,Dup,κ,Ty,Φ,Cov`
(seconds on a module via incremental `tsc` + affected-test selection); mutation
testing is a periodic **calibration audit**, never a gate.

---

## 3. The role of mutation testing (demoted, not deleted)

Coverage measures *execution*, not *assertion quality* — the one hole the cheap
stack can't close. Mutation testing is the only thing that measures whether a
fence actually *catches* behavior changes. So it is run **periodically against the
fences** (not per-refactor) and feeds the `mfence` term in `risk`. A fence with
low mutation score is untrusted; refactors behind it are down-ranked. This keeps
the inner loop cheap while keeping the metric honest.

> **Measured (experiments/mutation/).** codenuke's suite scores **80% (12/15)**
> against injected behavior mutations — the fence has teeth, replacing the stubbed
> `mfence = 1`. The audit also yields a **per-module blind-spot map**: `heuristic.ts`
> survived 2/3 of its mutations, so `mfence` must be **per-region**, not global —
> `r3·(1 − mfence_region)`. Refactors in weakly-fenced regions (heuristic) require
> new characterization tests before they are admissible; well-fenced regions
> (selection, json, reporting) carry low fence-risk. This *measures* where the
> "fence boundary = refactor boundary" line actually is.

---

## 4. Biology layer — validation protocol (the metric is invalid until this passes)

A biomarker is trusted not because the formula is elegant but because it
**separates controls and tracks outcomes on a labeled cohort, on held-out data,
preregistered.** Same bar here.

### 4.1 Ground-truth corpus (TS/React)
- **(a) Natural experiments.** Mine popular TS/React repos for commits/PRs
  labeled `refactor:` where tests pass before and after — real (before, after)
  pairs.
- **(b) Synthetic controlled taxes (positive controls).** Take clean modules;
  *inject* a known tax (clone a module 6×; add 3-level prop-drilling; split one
  concept across files). The inverse refactor is the **known-good cure** with an
  exact label.
- **(c) Human-rated pairs.** Senior engineers rate (before, after) pairs 1–5 on
  "did this lower change cost." Measure inter-rater reliability (Krippendorff α);
  discard the dimension if α is low.

### 4.2 Controls (the metric must separate these or it is invalid)
- **Positive control** — the synthetic cure / human-5 refactor: must be admitted
  and rank high.
- **Negative control N1** — no-op / reformat: `gain ≈ 0` (tests P1, P2).
- **Negative control N2** — behavior-breaking LOC reduction (delete a branch):
  must be **rejected** (`+∞`, tests P3).
- **Negative control N3** — extract-method / file-splitting churn: must score
  `≈ 0` (tests P5 granularity defense — this is the failure mode of the old loop).

### 4.3 Validity & reliability (preregistered thresholds, held-out split)
- **Criterion validity** — Spearman ρ between `gain` and ground-truth labels on a
  **held-out** corpus split; require ρ ≥ 0.6 (preregistered).
- **Discriminant validity** — correlation of `gain` with raw diff size / files
  touched must be **low** (we must not be rewarding big diffs).
- **Reliability** — test–retest CV of the full pipeline ≤ threshold (deterministic
  terms = 0; only source of variance is unquarantined flakiness).
- **Transfer (the Karpathy criterion)** — gain measured at *module scale* must
  predict gain at *repo scale* (the depth=12→24 analog). If module-level scores
  don't transfer, the swarm chases mirages.

### 4.4 Setting the weights (no guessing)
Fit `w1..w4, r1..r3` by regression of `gain` against labels on the **training**
split; report all of §4.3 on the **held-out** split. Choosing weights by hand and
then evaluating on the same examples is p-hacking and is forbidden.

### 4.5 Release gate
The metric is **"validated for use"** — allowed to drive the autoresearch loop —
only when: controls separate with large effect size (4.2), ρ clears threshold on
held-out data (4.3), reliability CV is low (4.3), and transfer holds (4.3). Until
then, it is a hypothesis, not a loss function.

---

## 5. First experiment (before any swarm)

Mirror Karpathy's "single model before the swarm":
1. Implement the **scorer**: `score(diff) → { admissible, gain, risk, terms }` over
   the inner-loop quantities (§2), on a small TS/React target.
2. Build the **minimal control set** (§4.2): one positive control + N1/N2/N3.
3. **Check separation.** If the scorer cannot rank positive > N3 > N1 and reject
   N2, the metric is wrong — fix the metric, do not proceed.
4. Only after separation: expand the corpus (§4.1), fit weights (§4.4), measure
   validity/reliability/transfer (§4.3), then run the single-agent loop.

We iterate on §5.1–5.3 until controls separate. That is the "run an experiment
until we make it work" loop — and it is run on the *metric*, before it is ever run
on the codebase.
