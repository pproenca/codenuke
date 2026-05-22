# Weight fitting / unit-incomparability — results

Hardening task #1. Run: `node experiments/weights/fit.mjs`.
Corpus: 76 commits weak-labeled by message (codenuke + opencode), refactor=52,
feature=24; per-commit gain components (dL, dDup, dCx) from `git show` + `measure()`.

## The flaw (confirmed)
Raw `gain = dL + dCx + 0.5·dDup` is silently dominated by dL:
- corr(raw gain, dL) = **1.000**, corr(dCx)=0.926, corr(dDup)=0.641.
The terms have incomparable units (dL ~100s of AST nodes, dCx ~10s, dDup ~single
digits, mostly 0), so dL swamps the rest.

## The fix
Standardize each component (z-score vs corpus mean/stdev, floored) before
weighting; fit weights by L2-regularized logistic regression (refactor=1 vs
feature=0) on a 2/3 train split.

| feature (standardized) | fitted weight |
|---|---|
| zCx (complexity reduction) | **0.049** (most discriminative) |
| zL (size reduction) | 0.027 |
| zDup (duplication mass) | 0.009 (least; ~no variance at commit level) |

## Held-out AUC (refactor vs feature)
| scorer | AUC |
|---|---|
| dL only | 0.813 |
| raw composite (dL + dCx + 0.5dDup) | 0.809 |
| **standardized + fitted** | **0.819** |

## Conclusions
1. **Use standardized components**, not raw, in `gain`. Relative weights ≈
   `zCx : zL : zDup = 1.8 : 1.0 : 0.35`. Complexity reduction is the strongest
   per-commit discriminator once units are normalized.
2. The improvement over dL-only is **small** (0.819 vs 0.813): at commit
   granularity dL carries most of the signal, and dDup has ~no variance.
3. **Caveats (weak validation):** weak commit-message labels; modest corpus (n=76,
   imbalanced); whole-commit deltas are noisy (real "refactor" commits bundle new
   helper files + other work, so mean dL is *negative* even for refactors). For
   definitive weights, label clean isolated refactors (or human ratings) per §4.4.
4. Net: the unit-domination bug is fixed and weights are now principled and
   held-out-validated, but treat them as a calibrated starting point, not final.
