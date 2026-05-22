# Change-coupling via git co-change — results

Run: `node experiments/cochange/cochange.mjs` and `episodes.mjs`.
Subjects: opencode `packages/core/src` (1500-commit history) and codenuke `src/`.

## Headline: change-coupling is a valid value signal — but only as RECURRING MAINTENANCE co-change, not raw Jaccard.

### Step 1 — raw co-change did NOT separate (prediction looked falsified)
| cluster | mean Jaccard | vs baseline |
|---|---|---|
| opencode PluginV2 (34 files, clone-mass #1 target) | 0.556 | 3.0× |
| codenuke clone-top mappers | 0.266 | 2.9× |

Both ~3× baseline. Raw Jaccard is inflated by sparse history (high Jaccard on a
denominator of 2) and **batch commits** (one commit touching N files makes all
C(N,2) pairs look coupled).

### Step 2 — episode breakdown reveals the truth
**opencode PluginV2 — 4 co-change commits total:** `chore: generate` (×2, codegen),
`Rename v2 auth service` (one-off rename), `expose v2 model listing API` (one-off).
**0 recurring maintenance.** Benign confirmed.

**codenuke mappers — 9 co-change commits, several are dedup refactors:**
`Extract shared TOML and glob helpers for mappers`, `fix(mapper): reuse shared Node
chunking`, `fix(mapper): share workspace pattern helpers`, `fix(mapper): hoist
associated test directory lists`, `Reuse repo index and cache mapper lookups`, …
The human developer **repeatedly returns to DRY the mappers** — the fingerprint of
an unresolved change-amplification tax. Independent, behavioral corroboration that
the mappers are the real tax — exactly where clone-mass was quietest.

## Conclusions
1. **Change-amplification = recurring maintenance co-change** (distinct non-creation,
   non-codegen commits where a cluster co-changes). This is the validated form of
   the value signal. Raw Jaccard alone is confounded by codegen + batch + sparsity.
2. **Repeated dedup commits targeting a cluster are a direct tax fingerprint** — and
   are themselves cheap to detect from `git log` subjects.
3. The killer prediction holds under the refined measure: opencode PluginV2 → ~0
   maintenance episodes; codenuke mappers → 7 (incl. ~4 dedup attempts).
4. This is the third proxy tested. Arc: clone-mass (invalid — flags benign
   consistency) → raw co-change (confounded by codegen/batch/sparsity) → recurring
   maintenance co-change (valid). Each failure narrowed the measurement.

## Caveats (before driving a loop)
- Small absolute counts (codenuke is young; co=2–3). Needs more/larger repos to
  generalize and to set thresholds.
- Commit-message keyword classification (codegen/creation vs maintenance) is crude;
  a robust version needs better episode typing.
- Requires git history — unavailable for fresh code or shallow clones.

---

## Generalization (hardening task #2)

Repo-agnostic, self-labeling test (`generalize.mjs`): use each developer's own
dedup commits to label tax files, then measure their recurring co-change in
NON-dedup, non-codegen maintenance commits (excluding the labeling commits → no
circularity). Prediction: tax files keep co-changing above baseline.

| repo | tax files | cluster Jaccard | baseline | ratio |
|---|---|---|---|---|
| codenuke | 72 | 0.146 | 0.061 | **2.4×** |
| opencode | 71 | 0.016 | 0.006 | **2.6×** |
| extra-1 | 30 | 0.085 | 0.042 | **2.0×** |
| extra-2 | 0 | — | — | N/A (no dedup commit touched >=2 .ts files) |

**Result: 3/3 applicable repos show 2.0–2.6× elevated recurring co-change** — a
tight, reproducible range. The developer's own dedup targets keep co-changing
*outside* the dedup commits, i.e. the tax recurs (dedup attempts don't fully
resolve it). extra-2 is N/A (markdown/skills repo), not a counterexample.
Threshold ~1.5–2× cleanly separates tax clusters from baseline.

Caveat: still small n; weak (keyword) commit labeling; needs larger/older repos
and non-self-labeled clusters for a definitive threshold.
