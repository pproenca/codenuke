# evaluate_changecost — the value metric, built (THEORY.md realized)

The refactoring analog of Karpathy's `prepare.py`/`evaluate_bpb`. Instead of *predicting*
change cost from static code features (size, co-change, complexity — all falsified or
invalid by THEORY.md T1), it **measures** it: the realized cost of implementing a fixed,
held-out benchmark of change-requests. The objective is `𝒱(C)=𝔼_{δ~𝒟}[K(C_δ|C)]` — the
conditional codelength of the next version given this one (THEORY.md §0).

## Files
- `lib.mjs` — `tokenize` (formatting/comment-invariant AST-token stream), `lcsEditSize`
  (insertions+deletions), `editCost` (token-diff of non-test src), `verifyCost`
  (1 − fence fidelity of touched regions).
- `evaluate.mjs` — `node evaluate.mjs [ref]`: worktree at `C`; for each δ in Δ — drop its
  acceptance test, run the **implementer**, gate (full suite + accept test green), measure
  `cost = edit + β·verify`, revert; aggregate `𝒱̂(C)`.
- `benchmark/<id>/{meta.json, accept.test.ts}` — the held-out change-benchmark Δ.
- `changecost.test.mjs` — unit tests + the positive control.

```
cost(δ,C) = edit(δ,C)  +  β·verify(δ,C)
  edit   = token-diff size (ins+del) of non-test src, C → C_δ   (formatting-invariant, P1)
  verify = 1 − fence-fidelity of the regions δ touched          (safer = cheaper to verify)
𝒱̂(C)   = mean over Δ of cost
```

The **implementer** (who realizes each δ) is part of this immutable scorer and may see Δ;
the refactoring **proposer** (autoloop) must not — that separation is what keeps the
metric self-policing (THEORY.md T5). Implementer is pluggable (`CN_IMPLEMENTER`); default
is a blind `claude -p`.

## Verified

**1. The metric measures change cost correctly (positive control, deterministic — 7/7 tests).**
- `tokenize` is invariant to whitespace and comments; a reformat has edit cost 0 (P1).
- **A concept duplicated `k` times costs `≈k×` to change** (the THEORY T1 `𝒟_coupled`
  case): changing a deduplicated rate = 2 tokens; the same change with the rate inlined 3×
  = 6 tokens (≈3×). This is the empirical fact that makes "less code helps" *true here* —
  and `editCost` captures it.

**2. The harness runs end-to-end on real codenuke** (`@2d81f6c`), both with a scripted
implementer and the **real `claude -p` implementer** — both realized the `supported-ext`
change, passed the gate, and measured **edit=21 tokens, verify=0.38, 𝒱̂=43.7** (the LLM
converged on the same minimal edit as the script — low variance for a well-specified change).

**3. `𝒱̂` discriminates better structure from worse — through the full pipeline.** Same
change δ ("bump a rate 1→2"), two versions of the codebase:

| codebase | edit | verify | **𝒱̂** |
|---|---|---|---|
| clean (rate deduplicated → 1 site) | **2** | 0.38 | **24.7** |
| taxed (rate inlined → 3 sites) | **6** | 0.38 | **28.7** |

`𝒱̂(clean) < 𝒱̂(taxed)`, the edit term showing the exact 3× amplification, measured by
implementing the change on real worktrees — not inferred from the code. This is the
intended use: compare a refactor `C→C'` by `𝒱̂(C') < 𝒱̂(C)` on the same Δ.

## How this maps to the theorems (THEORY.md)
- `edit` is a **computable upper bound** on `K(C_δ|C)` (any concrete correct edit describes
  `C_δ` given `C`) — exactly cross-entropy ≥ entropy (**T4**).
- Comparable across candidates on a fixed Δ (**T4**); self-policing because the proposer is
  blind to Δ and every δ is gated by its acceptance test + the behavior/fence gate (**T5**).
- `editCost` scales with amplification and is sign-correct only because Δ encodes `𝒟`
  (**T1**: no code-only metric could do this); it is *not* monotone in raw size (**T2**:
  the verify+edit cost, not `L`, is the objective).

## What's next (to drive the loop with this)
1. **Grow Δ** — more change-requests across codenuke's real extension axes (mappers,
   providers, CLI flags), each with an acceptance test. A mean over 1–2 is a demo, not a
   benchmark; aim for ≥10 representative δ.
2. **Wire as the loop's periodic ground truth** — `evaluate_changecost` is to the value
   signal what `fidelity.mjs` (mutation testing) is to the fence: the expensive periodic
   audit. The cheap inner-loop proxy `m̂` (z-scored ΔL + Δcomplexity + change-coupling cut
   *from Δ*) must be **validated** to rank-correlate with `𝒱̂` (Spearman ρ ≥ 0.6, held-out)
   before it drives the unattended loop. That validation is the one remaining empirical
   step (the same status as `val_bpb` = "quality").
3. **Demote `L`** to one component of `m̂`; take the change-coupling cut from Δ (which δ
   touch which atoms), not imports (wrong graph) or history (falsified).
