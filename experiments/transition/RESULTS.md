# Transition-level validation — results

The methodologically-correct test for a TRANSITION metric: score real before→after
refactors (ground-truth positives from codenuke's own history, read via `git show`),
and confirm the behavior gate catches a real behavior change on real code.

## Value axis — real refactor commits

| dL (nodes) | region | verdict | commit |
|---|---|---|---|
| +851 | mapper | REDUCES | `share workspace pattern helpers` |
| +378 | mapper | REDUCES | `Extract shared TOML and glob helpers for mappers` |
| +99  | mapper | REDUCES | `reuse shared Node chunking` |
| +67  | other  | REDUCES | `Consolidate provider NDJSON parsing` |
| +67  | other  | REDUCES | `Extract shared CLI bootstrap helper` |
| −5   | mapper | neutral | `hoist associated test directory lists` (locality, not reduction) |
| −604 | mapper | GROWS   | `Reuse repo index and cache mapper lookups` (adds caching infra) |
| —    | —      | n/a     | `Extract shared TOML scanning…` (didn't resolve) |

**The metric rewards genuine reductions and is not fooled by commit rhetoric.**
`b1546cc` says "Reuse…" but actually *adds 604 lines* of caching infra → GROWS,
correctly not rewarded. The metric measures the real code delta, not the label.
All true dedups score strongly positive, concentrated in the **mapper region that
recurring-co-change independently flagged as the tax.**

## Behavior gate (G1) on real code — pinned fence catches a real mutation

In an isolated worktree (user tree untouched), codenuke's **real test suite**:
- clean HEAD: **513 passed**, 1 skipped (~10s) — fence is green/pinned.
- inject behavior change in a refactored region (`nextFinding`: `rank < bestRank`
  → `rank > bestRank`, i.e. pick the worst finding): **3 tests failed**, incl.
  `nextFinding(findings)?.findingId).toBe("first")` → got `undefined`.

So on real code: G1 **admits** the clean refactor and **rejects** the behavior
change. (Extends the synthetic N2 result to a real test suite on real source.)

## Status: metric validated end-to-end (for TS, n=2 repos)
- self-policing gates (synthetic, incl. N2) ✓
- complexity = valid state-quality signal ✓; clone-mass falsified ✓
- change-amplification = recurring-maintenance co-change ✓ (co-change RESULTS)
- value axis rewards real reductions, ignores mislabeled growth ✓
- behavior fence works on real code, catches a real mutation ✓

## Remaining before trusting an autonomous loop
- Generalization beyond n=2 repos; co-change thresholds.
- Weight fitting (§4.4) — still illustrative.
- Co-change needs git history (fails on fresh code).
- Fence independence at scale: when the agent writes the fence, the mutation audit
  (StrykerJS) must be standard, not stubbed.
