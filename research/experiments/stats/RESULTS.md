# Statistical instruments — results

The instruments Karpathy's loss had implicitly: a characterized noise floor,
improvements separable from noise, and **predictive/transfer validity**. Here we
test our metric's claims with significance — CIs, permutation tests, effect sizes,
and out-of-time prediction — instead of point estimates.

Primitives (`lib.mjs`): Abramowitz-Stegun erf/normalCDF, Wilson interval,
Mann-Whitney U (tie-corrected), percentile bootstrap, permutation test, AUC.

## 1. Temporal predictive (transfer) validity — the headline, and a FALSIFICATION

Predictor measured on the PAST half of history; outcome (file touched by a
dedup/refactor commit) on the FUTURE half. No leakage. Control: change-FREQUENCY
(churn). `predictive.mjs`.

**opencode** (n=18 future-refactored vs 559, the better-powered repo):
| predictor | AUC | 95% CI | perm p | vs churn |
|---|---|---|---|---|
| churn (control) | **0.719** | [0.585, 0.852] | **0.0006** | — |
| co-change raw | 0.613 | [0.485, 0.739] | 0.056 (ns) | Δ −0.105 CI [−0.206, −0.016] (worse) |
| co-change / churn (coupling, frequency-removed) | 0.436 | [0.351, 0.521] | 0.81 (ns) | Δ −0.282 (worse) |
| complexity density | _pending_ | | | |

**codenuke** (n=6 future-refactored vs 39, underpowered):
| predictor | AUC | 95% CI | perm p | vs churn |
|---|---|---|---|---|
| churn (control) | 0.662 | [0.430, 0.890] | 0.103 (ns) | — |
| co-change raw | 0.415 | [0.124, 0.735] | 0.75 (ns) | worse |
| co-change / churn | 0.284 | [0.079, 0.500] | 0.95 (ns) | worse |
| **complexity density** | **0.799** | [0.636, 0.936] | **0.007 (SIG)** | Δ +0.137 CI [−0.15, 0.44] (ns) |

On codenuke, **complexity density is the only significant predictor of future
refactor locations** (AUC 0.80, p=0.007) — it doesn't *beat* churn at this n
(Δ CI includes 0), but it's significant where churn is not. (opencode complexity
predictor not run: blob:none clone has no local file contents.)

**Conclusion: the co-change change-amplification term has NO predictive validity.**
It fails significance (CI includes 0.5) and is *significantly worse than churn*;
once frequency is removed (co-change/churn) it is at chance. The earlier
"2.0–2.6× generalization" (experiments/cochange/generalize.mjs) was an **in-sample,
churn-confounded artifact** that does not survive an out-of-time test with a
frequency control. This is the primary value term — falsified.

The only predictor with (nominal) predictive validity is **churn** (AUC 0.72,
p<0.001), though this may be partly mechanical (busy files attract all commit
types, including dedup); a fairer outcome control (dedup-rate per change) is owed.

## 2. Good-vs-bad contrast significance (`contrast-sig.mjs`)

Per-file distributions, opencode core/src (n=108) vs codenuke src (n=55):
| signal | ratio bad/good (95% CI) | Mann-Whitney p | effect (rank-biserial) | verdict |
|---|---|---|---|---|
| complexity / 1k nodes | 1.35 [1.18, 1.68] | **1.4e-4** | 0.365 | **SIGNIFICANT (bad>good)** |
| duplication rate | n/a (median 0) | 0.51 | 0.05 | NOT significant |

Complexity density is a statistically real STATE-quality discriminator. Duplication
rate is not (confirms clone-mass invalidity with a test). (Earlier point estimate
1.63× was mean-based; robust median ratio is 1.35× — still significant.)

## 3. Fence power (`mutation`)
**n=45 audit: 36/45 = 80%, Wilson 95% CI [66%, 89%]** — point estimate stable from
the n=15 run (80%), interval tightened. Blind spots (survivors): `change-audit.ts`
(3), `platform/detect.ts` (3), `patch-boundary.ts` (2), `selection.ts` (1) — these
modules are weakly fenced; refactors there need new characterization tests first.

## 4. Weight-fit AUC improvement — within noise
Held-out AUC scaled+fitted 0.819 vs dL-only 0.813 (experiments/weights), n_test≈25.
A difference of 0.006 at that n is **not statistically significant** (the bootstrap
AUC-difference CI comfortably includes 0). Honest read: standardization fixes the
unit-domination bug (necessary), but the *predictive* improvement from fitting is
within noise; dL is the workhorse.

## Synthesis: what is and isn't Karpathy-grade
- **SAFETY / gates — validated.** Behavior fence mutation score 80% [66,89]
  (n=45, measured with CI); type and size gates deterministic (zero variance).
- **State-quality signal — validated.** Complexity density separates good/bad,
  p=1.4e-4, effect 0.365.
- **VALUE / locator signal — co-change FALSIFIED; complexity is the candidate.**
  Co-change has no predictive validity (worse than churn); duplication rate is not
  significant. **Complexity density is the front-runner**: significant state
  discriminator (p=1.4e-4, n=163) AND significant temporal predictor of refactor
  locations on codenuke (AUC 0.80, p=0.007) — but n=6 positives, single repo,
  untested on opencode. Churn predicts on opencode (AUC 0.72) but may be mechanical.
  **We have a promising but not-yet-robust value instrument.** To reach Karpathy
  grade it needs: complexity-predictor replicated on opencode (fetch blobs) and ≥1
  more repo, more positives, and a churn-controlled outcome.

## Next (to close the value-signal gap rigorously)
1. Replicate the complexity-density predictor on opencode (un-filter blobs) + a 3rd
   repo; target ≥30 positives for a tight AUC CI.
2. Fairer outcome: dedup-rate-per-change (remove the churn mechanical confound).
3. If complexity holds out-of-sample, make it the primary value term (replacing
   co-change); keep churn as a covariate. Re-fit weights against this validated target.
