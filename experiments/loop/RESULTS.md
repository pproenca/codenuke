# M3 — the autonomous proposer loop (SPEC §3.4)

The loop now runs with **no human in it**: `autoloop.mjs` drives
`propose → score → keep/revert → log`. Run: `node experiments/loop/autoloop.mjs [N]`.

**Architecture (Karpathy mapping).**
- **proposer** = headless `claude -p` editing **only `src`** (`--allowedTools "Edit Write
  Read Grep Glob"` — *no* Bash/git, so it structurally cannot run or read-around the
  scorer ⇒ the judge stays out of the optimizer's reach = immutability).
- **scorer** = `loop.mjs score --json` (immutable judge: gates G1/G1′/G3/G4 + value/risk).
- **keep/reset** = `loop.mjs accept` | `git reset --hard`.
- **skill** = `program.md` (objective, hard constraints, keep rule, "never ask").
- **state** = `results.tsv` (trajectory) + kept commits in the worktree.

## Verified end-to-end

**(1) Mechanism — deterministic scripted proposer, 3 iters:** KEEP → KEEP (stacked) →
**REVERT** (a type-unsound edit tripped G3+G4 → loss +∞ → reverted, loop state intact).
Proves keep / stack / self-policing revert / logging / persistent state.

**(2) Real LLM proposer — `claude -p`, 1 iter:** autonomously reduced `mappers/shared.ts`
by **ΔAST=34** (ΔCx=2), behavior preserved (tests green), loss −0.568 → **KEEP**, committed
`d1ba0e1`. **Genuine autonomous autoresearch**: an LLM proposed, the immutable metric
judged, kept, logged — unattended. Cost ≈ $0.15–0.40/iter (budget-capped via `--max-budget-usd`).

Trajectory (`results.tsv`): **3 keeps + 1 revert, cumulative −40 AST nodes** on mappers.

## What this is NOT yet (the M3 exit, GOAL.md, is still open)
- The KEEP path was shown with a **fixture fence** marking mappers admissible. On the
  **real** fence (mappers 62%, all 6 regions G1′-blocked — mutation/RESULTS.md) the
  autonomous loop **correctly keeps nothing on codenuke**. A real M3 run (≥10 kept iters)
  needs a substrate with **both** (a) refactoring headroom **and** (b) ≥1 region whose
  fence clears 0.90 — or the loop's **fence-raising move** (auto-add characterization
  tests to clear a region, *then* refactor). **codenuke is not that substrate** (already
  tidy + weak fence). Finding/standing one up is the next step.
- `results.tsv` iter numbering restarts per invocation (cosmetic; commit+status are authoritative).

## Bug found + fixed while building this
`accept`'s `git add -A` committed the loop **state file** into the trajectory; a later
revert's `reset --hard` then rolled state back to its stale committed value (observed:
state said iter=1 after 2 keeps). Fixed: **state moved outside the worktree** + `accept`
stages only `src`. Re-verified: state stays consistent across a revert.

---

# Round-1 single-agent loop — results

"One model before the swarm." Harness owns scoring + keep/revert/stack; the
proposer (an agent editing the worktree) is pluggable. Runs in an isolated git
worktree — user tree untouched. Target: `src/mappers/` (the validated tax cluster).

Commands: `loop.mjs init | score | accept | revert | status | cleanup`.

## What the loop did (real code, real gates)

Baseline: GREEN (513 tests pass, tsc 0 errors), mappers = 63,633 AST nodes.

| candidate | gates | value | verdict |
|---|---|---|---|
| Extract `fileGroupSummary`, collapse **4** sites (apple×2, gradle×2) | G1 ✓ G3 ✓ **G4 ✗** | ΔL=**−1**, ΔDup=+9 | **REJECT** — anti-churn floor |
| Same, extended to **7** sites (+python, node, ruby) | G1 ✓ G3 ✓ G4 ✓ | ΔL=+23, ΔDup=+17, ×2.4 region | **KEEP** (loss −2.97) → accepted, stacked |
| Behavior break (`===`→`!==` in path-globs) | **G1 ✗ G3 ✗ G4 ✗** | — | **REJECT** (loss +Inf) |

All three core behaviors demonstrated on the real target:
- **Anti-churn floor:** the 4-site dedup *removed duplication* (ΔDup=+9) but *grew
  total code* (ΔL=−1) — a naive "be DRY" agent commits it; the loss metric refuses.
  "More DRY ≠ less code."
- **Genuine reduction accepted:** extending to 7 sites flipped ΔL to +23 (savings
  exceed the abstraction cost) → admissible, gain ≫ risk → KEEP + stack.
- **Self-policing:** a behavior-breaking "reduction" is rejected by the pinned
  test fence (and tsc).

## Calibration bug found and fixed mid-run

The first KEEP printed `gain=0.083` vs `risk=0.252` (loss POSITIVE) — the
unit-incomparability bug **recursed between gain and risk**: the logistic
log-odds coefficients (0.027…) were used as gain weights *plus* a scale divisor,
double-shrinking gain. Fix: gain = **relative importances (1.0/1.8/0.35) on
z-scored components**, keep iff **loss < 0** (value exceeds risk = the real
magnitude floor). After the fix: gain=3.22 ≫ risk=0.25, loss=−2.97 → coherent KEEP.

## Status & next
- Cumulative: mappers 63,633 → 63,610 (−23 nodes). Small — the mappers are already
  heavily deduplicated (their recurring-dedup history); easy wins are gone, so
  round-1's reductions are modest and the loop correctly rejects churn.
- The accepted refactor (`fileGroupSummary`) is a genuine improvement and could be
  applied to the real repo (it passed tests + tsc + net reduction).
- **Next:** more proposer iterations / larger structural moves; calibrate the
  absolute floor and per-region `mfence` into risk; then the swarm (parallelize
  across vertex-disjoint regions per METRIC.md P4).
