# START HERE — codenuke autoresearch (session handoff)

codenuke is an **autoresearch loop for behavior-preserving code reduction**: an agent
proposes refactors, an *immutable metric* judges them, keep-if-genuinely-smaller-and-
behavior-preserved, else revert — Karpathy's `train.py`/`val_bpb` loop applied to
refactoring.

## Read these first, in order
1. `SPEC.md` — how it works (architecture, the loop, what's missing in §6).
2. `GOAL.md` — the target (R1–R5 success metric; M1–M5 milestone ladder). **This is the plan.**
3. `METRIC.md` — the loss function (gates ≻ value; the corrections are authoritative).
4. `experiments/*/RESULTS.md` — every empirical claim, with statistics.

## DO NOT RELITIGATE (settled, with evidence — re-deriving wastes the session)
- **Co-change / "change-amplification" is FALSIFIED as a value signal.** Out-of-time,
  churn-controlled test: AUC 0.61, p=0.056, *worse than churn*; normalized at chance.
  The earlier "2–2.6×" was an in-sample, churn-confounded artifact. **Do not bring it
  back as the value term.** (experiments/stats)
- **Clone mass / duplication rate is NOT a valid signal** (good codebases have *more*
  syntactic dup; Mann-Whitney p=0.51). Demoted to weak corroboration only.
- **A locator/prioritizer is OPTIONAL.** Karpathy's loop has no "where to look" oracle —
  the agent proposes, the metric judges. We over-built this once; don't again. Correct
  loop needs only a faithful keep/reject metric.
- **z-score the value components.** Raw units make value ≈ ΔL alone (corr 1.000). Use
  relative weights ẑCx:ẑL:ẑDup ≈ 1.8:1:0.35. (The same bug recurred between gain and
  risk in the loop — keep them on comparable scales.)
- **The fence is 80% faithful [66,89], not ground truth.** ~1 in 5 behavior changes
  slip. This is THE correctness gap (M1). Don't assume tests = perfect oracle.
- **The metric is immutable; the proposer must never edit it.** That immutability *is*
  the integrity guarantee (analog: agent can't touch `evaluate_bpb`).

## What's validated vs missing (one line)
- Validated: type/size gates (exact), self-policing, complexity density (p=1.4e-4; AUC
  0.80). Fence: per-region **60% [55,65]** (the "80%" was an optimistic artifact — M1).
- BUILT this session: **(1) the autonomous proposer loop** (`autoloop.mjs` — `claude -p`
  proposer → score → keep/revert → log, verified unattended), **(2) per-region
  fence-fidelity gate G1′** (M1), **(3) plumbing** (`loop.mjs score --json`, `program.md`,
  `results.tsv`).
- Still missing: a **headroom substrate** (codenuke is tidy + weak-fenced → 0 admissible
  regions → loop keeps nothing here); the **fence-raising move**; `autoresearch/<tag>`
  branch; optional validated prioritizer.

## M1 STATUS (done this session): gate wired + re-measured, exit NOT met
- `loop.mjs` applies **G1′**: a region is admissible iff its fence's Wilson 95% CI
  lower bound ≥ 0.90, read from the pinned `experiments/mutation/fence-fidelity.json`
  (`fidelity.mjs` produces it; mutation testing is periodic, not per-run). Unmeasured
  region / missing artifact → **fail closed**. Per-region `mfence` now feeds `risk`
  (replaced the hardcoded 0.2). Proven data-driven end-to-end (same diff: REJECT on
  real artifact, KEEP on a fixture flipping the region admissible).
- **Re-measured (382 mutants, seeded, @2d81f6c): 0/6 regions admissible.** mappers 62%
  [51.9,71.5], workflow 53%, platform 65%, mapping 53%, provider 55%, cli 71%
  [57.7,81.7]; global 60% [55,65]. **The "80%" was an optimistic artifact** (old audit
  cherry-picked well-covered files + first-match-per-op). See experiments/mutation/RESULTS.md.
- `fidelity.mjs` gotcha fixed: a mutant can cause a *synchronous* infinite loop that
  defeats vitest's per-test timer → it uses a 45 s wall-clock SIGKILL + `pkill` reap,
  counting a hang as caught.
- `loop.mjs init` now honors `CN_BASE` (use `CN_BASE=2d81f6c` since HEAD is red).

## M3 STATUS (also done this session): autonomous loop BUILT + verified
- `experiments/loop/autoloop.mjs` runs `propose (claude -p, edit-only) → score
  (loop.mjs --json) → keep/revert → append results.tsv`, no human. `program.md` =
  proposer skill. Verified: scripted proposer (keep/stack/revert/self-policing) AND a
  **real `claude -p` proposer** kept a ΔAST=34 reduction in `mappers/shared.ts` unattended.
- Bug fixed: `accept` was committing the state file → a revert's reset clobbered loop
  state. State now lives OUTSIDE the worktree; `accept` stages only `src`.
- Run it: `CN_BASE=2d81f6c CN_FIDELITY=<artifact> node experiments/loop/autoloop.mjs N`.

## Next actions (the M-ladder exits that remain)
- **Headroom substrate (gates both M1-finish and the M3 exit):** codenuke is tidy +
  weak-fenced → 0 admissible regions → loop keeps nothing here. Find/stand up a mid-size
  TS repo with cruft AND a strong test suite; measure its fence (`fidelity.mjs`); run
  `autoloop.mjs` for ≥10 kept iters (M3 exit). *Open:* is the 0.90-CI-LB bar feasible on
  any real region, or too strict?
- **Fence-raising move:** let the loop auto-add characterization tests to clear a region
  (raise `mfence` past 0.90), *then* refactor — the automated form of GOAL.md M1's "blocked
  OR given characterization tests until they clear it." This is what lets the loop earn
  admissibility on weaker substrates (and would unblock codenuke itself).

## Environment & gotchas (will bite a fresh session)
- **`master` HEAD (`e8aa9f2`) has a RED test baseline.** The known-green commit is
  **`2d81f6c`** — use it as the baseline for any test/mutation work (the larger
  mutation audit already does). Worth telling the user their HEAD tests fail.
- **opencode** was a throwaway clone at `/tmp/opencode-good` (`--filter=blob:none
  --sparse`, branch `dev`, deepened to 1500 commits). It's gone after reboot — re-clone
  if needed. **blob:none means file *contents* aren't local** → `git show <c>:<file>`
  triggers per-file network fetches (this hung the complexity predictor; that's why it's
  codenuke-only).
- All experiment harnesses run in **isolated git worktrees** (`/tmp/cn-*`) so the user
  tree is never touched; reverts are `git reset`. Always clean up worktrees.
- Only dependency for the metric tooling is `typescript` (already installed). Tests use
  `vitest` (~10s, 513 tests at 2d81f6c).
- Harness quirk: the Edit tool sometimes can't match a literal `""` (a U+0001 char gets
  substituted); patch via a small node/perl script instead. Foreground `sleep` is
  blocked — use background tasks.

## Working agreement (what makes this Karpathy-grade)
Every claim gets a CI or p-value — no point estimates. Never advance a milestone on
assertion; measure the exit. Keep negative results (co-change is the model). The metric
is never edited by the optimizer. Be honest about the proxy ceiling (we optimize "less
code + tests pass," a good but not ground-truth proxy for "lower change cost").
