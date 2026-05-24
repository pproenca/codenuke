# codenuke — Behavior Contract

> Rewrite-ready, machine-parseable behavior specification for the Effect-TS greenfield port of **codenuke** (an autonomous, behavior-preserving code-reduction CLI). Consolidated and validated from `BUSINESS_RULES.md` (RULE-001..063), `DATA_OBJECTS.md`, and `ASSESSMENT.md`, with source spot-checks against `legacy/codenuke` (read-only). Each rule is grouped by capability, carries exact constants/formulae, and ends with an ACCEPTANCE clause that scaffolds an executable test. Rules tagged `[LEGACY-DEFECT: do-not-port-faithfully]` encode a known defect or un-wired behavior — the rewrite should decide to FIX rather than replicate.

**Contract conventions.** Every rule block uses the fixed grammar `### RULE-### <title> [capability:…] [priority: P0|P1|P2] [type: Calculation|Validation|Lifecycle|Policy]` followed by `GIVEN / WHEN / THEN / AND* / SOURCE / ACCEPTANCE`. Source line numbers are repo-relative to `legacy/codenuke`. IDs 036/037 are intentionally absent (retired in the source's own numbering). 61 rules total.

---

## Capability index

| Capability | Rules | Count |
|------------|-------|------:|
| Scoring & Value Model | 001, 002, 035, 059, 060, 061, 062, 063 | 8 |
| Behavior Fence / Mutation Audit | 006, 007, 008, 009, 043, 051 | 6 |
| Safety Gates | 018, 019, 020, 021, 030, 031, 032 | 7 |
| Calibration | 010, 023 | 2 |
| Value-Proxy Validation | 014, 015, 024, 027, 028, 029, 056 | 7 |
| Change-Cost Ground Truth | 011, 012, 013, 054, 055 | 5 |
| Measurement | 003, 004, 005, 016, 017 | 5 |
| Loop Orchestration | 038, 039, 040, 042, 044, 057 | 6 |
| Config Resolution | 033, 034, 048, 049, 058 | 5 |
| Worktree & Proposer Substrate | 045, 046, 047 | 3 |
| Results Journal & Status | 041 | 1 |
| Security / Trust-Boundary Guards | 022, 025, 026, 050, 052, 053 | 6 |

`[LEGACY-DEFECT]` rules: 050, 053, 054, 063 (and the cross-cutting fence-gap-aggregation split noted on 002/013/054).

---

## Capability: Scoring & Value Model

### RULE-001 Gain — weighted, scaled axis reduction  [capability: Scoring & Value Model] [priority: P0] [type: Calculation]
GIVEN before/after `Measurement`s, resolved `Weights`, and optional calibration `scales`
WHEN the scorer computes the value a candidate delivers
THEN `gain = W.dL·(ΔL/scaleL) + W.dCx·(ΔCx/scaleCx) + W.dDup·(ΔDup/scaleDup)`
AND each `scaleX = input.scales?.sX ?? W.scaleX` (a usable calibration artifact overrides the per-axis weight-default scale)
AND constants: weights `dL=1.0, dCx=1.8, dDup=0.35`; default scales `scaleL=150, scaleCx=15, scaleDup=5` (config.ts:508-516); overridable via `codenuke.loop.json` `weights` / `CN_WEIGHTS`
AND division-by-zero is prevented upstream: RULE-023 marks scales usable only when each is positive finite
SOURCE: packages/scorer/src/main/scorer.ts:123-127
ACCEPTANCE: Given before={L:300,complexity:30,dupMass:10}, after={L:150,complexity:15,dupMass:5}, default weights/scales and no calibration, decide() returns gain == 1.0*(150/150)+1.8*(15/15)+0.35*(5/5) == 2.0+0.35 == 2.35; supplying scales={sL:300,sCx:30,sDup:10} halves each axis term.

### RULE-002 Risk — diffsize + fence-gap penalty  [capability: Scoring & Value Model] [priority: P0] [type: Calculation]
GIVEN `diffsize` (inserted+deleted source lines, RULE-061) and `touchedFidelities`
WHEN the scorer computes risk
THEN `mfence = touchedFidelities.length ? min(...touchedFidelities) : 1` and `risk = 0.002·diffsize + W.r3·(1 − mfence)`
AND constants: per-line coefficient `0.002` is HARDCODED INLINE (not config — the only scoring weight not exposed); `r3=1.0` (config.ts:515, overridable)
AND a missing per-region fidelity is passed as `0` by the caller (scorer.ts:395), driving `mfence→0` and maximal penalty (fail-toward-risk)
SOURCE: packages/scorer/src/main/scorer.ts:129-130
ACCEPTANCE: Given diffsize=50, touchedFidelities=[0.95,0.90], r3=1.0, decide() returns risk == 0.002*50 + 1.0*(1-0.90) == 0.1 + 0.10 == 0.20; empty touchedFidelities yields mfence==1 so risk==0.002*diffsize only.

### RULE-035 Keep/revert master decision  [capability: Scoring & Value Model] [priority: P0] [type: Validation]
GIVEN the four gate results and the gain/risk values
WHEN deciding keep-or-revert
THEN `admissible = G1 ∧ G1′ ∧ G3 ∧ G4` (RULE-018..021); `loss = admissible ? (risk − gain) : Infinity`; `keep = admissible ∧ loss < 0`
AND a break-even `loss == 0` is REJECTED ("no gain"); the reported `loss` field is `null` when non-finite
SOURCE: packages/scorer/src/main/scorer.ts:108-163
ACCEPTANCE: Given all gates true, gain=2.35, risk=0.20 → keep==true, loss==-2.15; given gain==risk (loss==0) → keep==false; given G4 false → admissible==false, keep==false, loss field==null.

### RULE-059 Per-axis deltas ΔAST/ΔCx/ΔDup  [capability: Scoring & Value Model] [priority: P1] [type: Calculation]
GIVEN before/after measurements
WHEN the scorer starts
THEN `dL=before.L−after.L`, `dCx=before.complexity−after.complexity`, `dDup=before.dupMass−after.dupMass` (SIGNED; contrast RULE-010's absolute deltas)
AND negative deltas (code grew) are allowed; only `dL>0` is gated (RULE-021)
SOURCE: packages/scorer/src/main/scorer.ts:113-115
ACCEPTANCE: Given before={L:100,...}, after={L:120,...}, decide() exposes dL == -20 (no clamp) and G4==false.

### RULE-060 Type-error count  [capability: Scoring & Value Model] [priority: P1] [type: Calculation]
GIVEN an optional typecheck command
WHEN counting type errors from its output
THEN `count = (lines matching /error TS/).length || 1` when the command ran-and-failed; `0` when no command configured or it succeeded
AND timeout 300000 ms; the `|| 1` floor prevents an unparseable failure from reading clean
SOURCE: packages/scorer/src/main/scorer.ts:247-267
ACCEPTANCE: Given typecheck output with 3 `error TS` lines and non-zero exit → count==3; failed exit with zero matches → count==1; no command configured → count==0.

### RULE-061 diffSize from `git --shortstat`  [capability: Scoring & Value Model] [priority: P1] [type: Calculation]
GIVEN `git diff --shortstat HEAD -- srcDir`
WHEN parsing the shortstat line
THEN `diffsize = Number(/(\d+) insert/ ?? 0) + Number(/(\d+) delet/ ?? 0)`
AND a missing insert/delete section parses to 0
SOURCE: packages/scorer/src/main/scorer.ts:327-332
ACCEPTANCE: Given shortstat " 3 files changed, 12 insertions(+), 7 deletions(-)" → diffsize==19; given a line with only insertions → deletions term==0.

### RULE-062 Cumulative reduction % (status display)  [capability: Scoring & Value Model] [priority: P2] [type: Calculation]
GIVEN `startL` (starting AST size) and current `now`
WHEN rendering the status line
THEN `pct = startL ? (startL − now)/startL · 100 : 0`, formatted to 1 decimal
AND `startL==0` → "0" (no division by zero)
SOURCE: packages/scorer/src/main/scorer.ts:587-592
ACCEPTANCE: Given startL=1000, now=750 → "25.0"; given startL=0 → "0".

### RULE-063 Verdict-label priority  [capability: Scoring & Value Model] [priority: P2] [type: Policy]
GIVEN a verdict
WHEN labeling it for humans/journal
THEN if `!G1′` → "REJECT (G1′ fence)"; else if `keep` → "KEEP"; else if `admissible` → "REJECT (no gain)"; else "REJECT (gate)"
AND `[LEGACY-DEFECT: do-not-port-faithfully]` a candidate failing MULTIPLE gates is reported only by the highest-priority label — concurrent G1/G3/G4 failures are masked in the journal. The rewrite should emit ALL failing gate names.
SOURCE: packages/scorer/src/main/scorer.ts:150-163
ACCEPTANCE: Given a verdict with G1′ false AND G3 false → faithful legacy label is "REJECT (G1′ fence)"; the rewrite's fixed behavior should additionally surface G3 as failing.

---

## Capability: Behavior Fence / Mutation Audit

### RULE-006 Wilson interval & fence-admissibility bar  [capability: Behavior Fence / Mutation Audit] [priority: P0] [type: Calculation]
GIVEN `k` caught of `n` mutants and quantile `z`
WHEN computing the confidence interval
THEN `p=k/n`; `center=(p + z²/2n)/(1+z²/n)`; `halfWidth = z·√(p(1−p)/n + z²/4n²)/(1+z²/n)`; `lo=max(0, center−halfWidth)`, `hi=min(1, center+halfWidth)`
AND a region is admissible iff `wilson(caught,total).lo ≥ fenceLB`
AND constants: `Z_95=1.96` (hardcoded, stats.ts:13); `fenceLB=0.90` default (config.ts:464, env `CN_FENCE_LB`, clamped [0,1]); practical bar ≈ 35/35 caught to admit at 0.90
AND `n=0` → degenerate `{p:0, lo:0, hi:1}` → never admissible at threshold>0 (fail-closed for unmeasured regions)
SOURCE: packages/stats/src/main/stats.ts:40-62; admissibility at packages/fence/src/main/fence.ts:140-142
ACCEPTANCE: Given (k=35,n=35,z=1.96) wilson.lo ≥ 0.90 (admissible); given (k=34,n=35) wilson.lo < 0.90 (inadmissible); given n=0 returns {p:0,lo:0,hi:1}; match legacy oracle within 1e-12.

### RULE-007 Mutation operator table & sites  [capability: Behavior Fence / Mutation Audit] [priority: P1] [type: Calculation]
GIVEN a parsed source file
WHEN collecting mutation sites
THEN each site is `{start, end, repl, op}` for a known operator flip, a `startsWith`↔`endsWith` swap, or a `return true`↔`return false` flip
AND the per-region plan pins each site to its repo-relative file (`PlannedMutation.rel`)
AND `.jsx`/`.tsx` are parsed with the correct `ScriptKind`
SOURCE: packages/fence/src/main/fence.ts:15-104,217-240
ACCEPTANCE: Given source containing `a === b`, `s.startsWith(x)`, and `return true`, collectSites yields sites flipping to `!==`, `s.endsWith(x)`, and `return false` respectively, each with start/end offsets.

### RULE-008 Deterministic mutation sampling (cap/seed)  [capability: Behavior Fence / Mutation Audit] [priority: P1] [type: Calculation]
GIVEN a region's collected sites
WHEN building the audit plan
THEN Fisher–Yates shuffle with `mulberry32(seed)`, then `slice(0, cap)`
AND constants: `cap=60`, `seed=1337` (CLI-overridable; defaults duplicated in help text orchestrator.ts:182); fewer sites than `cap` → all kept
AND this `mulberry32` does `a |= 0` per call; the value-proxy PRNG (spearman.ts:81) does NOT — they are intentionally non-interchangeable (legacy-exact); do not "deduplicate"
SOURCE: packages/fence/src/main/fence.ts:111-138
ACCEPTANCE: Given 200 sites, seed=1337, cap=60, two runs produce byte-identical 60-site plans; given 40 sites all 40 are kept; the plan matches the legacy mulberry32 sequence.

### RULE-009 Survivor classification (only green survives)  [capability: Behavior Fence / Mutation Audit] [priority: P0] [type: Validation]
GIVEN a mutant's test outcome
WHEN recording the audit result
THEN a mutant SURVIVES only if status is `"green"`; both `fail` and `timeout` count as caught
AND `caught = #(killed)`, `total = plan.length`; `p/lo/hi = wilson(caught,total)`; `admissible = lo ≥ threshold` (fenceLB=0.90)
AND a missing status defaults to `"green"` (conservative — unknown treated as survivor, lowering the score)
SOURCE: packages/fence/src/main/fence.ts:242-278
ACCEPTANCE: Given mutant outcomes [green, fail, timeout, (missing)] → caught==2 (fail+timeout), survivors==2 (green + missing-as-green), total==4.

### RULE-043 Monotonic fence replay  [capability: Behavior Fence / Mutation Audit] [priority: P0] [type: Calculation]
GIVEN a previously-recorded region record and added characterization tests
WHEN replaying
THEN re-test ONLY the prior survivors; `still = survivors still green`; `caught = previous.total − still.length`; recompute Wilson on `(caught, previous.total)` (denominator fixed → fidelity can only stay or rise)
AND a missing region throws; a survivor whose file vanished is treated as still-green (conservative — kept uncaught)
SOURCE: packages/fence/src/main/fence.ts:382-416
ACCEPTANCE: Given previous {caught:30,total:35} with 5 survivors and added tests killing 3, replay yields caught==33,total==35 with lo strictly ≥ the prior lo; killing 0 leaves lo unchanged.

### RULE-051 Replay precondition (sources unchanged + green)  [capability: Behavior Fence / Mutation Audit] [priority: P0] [type: Validation]
GIVEN recorded survivors and the worktree
WHEN replaying a region
THEN for each survivor, `safeWorktreePath` (RULE-050) + `readBaseline(rel) === readWorktree(rel)` else throw "source changed before replay"
AND the replay baseline test status must be `green` else throw "worktree baseline not green"
AND a missing survivor file at read time is treated as green (kept uncaught)
SOURCE: packages/fence/src/main/fence.ts:350-380
ACCEPTANCE: Given a survivor file modified in the worktree vs baseline, replay throws "source changed before replay"; given a red baseline test status, replay throws "worktree baseline not green".

---

## Capability: Safety Gates

### RULE-018 G1 — target tests pass  [capability: Safety Gates] [priority: P0] [type: Validation]
GIVEN the candidate worktree
WHEN running `config.testCommand`
THEN `G1 = result.ok`; a timeout counts as not-green (fail-closed)
AND test timeout 300000 ms (hardcoded — see ASSESSMENT Debt #8: resolved `Config` timeouts are ignored here)
SOURCE: packages/scorer/src/main/scorer.ts:117 (resolved 230-245, runtime.ts:448-455)
ACCEPTANCE: Given a passing test command → G1==true; given a non-zero exit or a timeout → G1==false.

### RULE-019 G1′ — every touched region fence-admissible  [capability: Safety Gates] [priority: P0] [type: Validation]
GIVEN the usable fence artifact and the touched regions
WHEN checking the fence gate
THEN `G1′ = fenceUsable ∧ blockedRegions.length === 0` (a region is blocked if its `admissible !== true`)
AND display distinguishes STALE / INVALID / NO-AUDIT (`formatFenceText`)
SOURCE: packages/scorer/src/main/scorer.ts:118 (blocked set 383-384)
ACCEPTANCE: Given fenceUsable=true and blockedRegions=[] → G1′==true; given any blocked region → G1′==false; given fenceUsable=false → G1′==false even with no blocked regions.

### RULE-020 G3 — no new type errors  [capability: Safety Gates] [priority: P0] [type: Validation]
GIVEN `typeErrors` (RULE-060) and `baselineTypeErrors`
WHEN checking the type gate
THEN `G3 = typeErrors ≤ baselineTypeErrors`
AND no typecheck configured → both 0 → G3 passes; typecheck timeout 300000 ms
SOURCE: packages/scorer/src/main/scorer.ts:119
ACCEPTANCE: Given typeErrors=2, baseline=3 → G3==true; given typeErrors=4, baseline=3 → G3==false; given no typecheck command → G3==true.

### RULE-021 G4 — strictly smaller (ΔAST > 0)  [capability: Safety Gates] [priority: P0] [type: Validation]
GIVEN `dL` (RULE-059)
WHEN checking the size gate
THEN `G4 = dL > 0` (zero or negative reduction is rejected — the change MUST delete AST nodes)
AND formatting-only edits don't change node count → G4 false
SOURCE: packages/scorer/src/main/scorer.ts:120
ACCEPTANCE: Given dL=5 → G4==true; given dL=0 (reformat-only) → G4==false; given dL=-3 → G4==false.

### RULE-030 Fail-closed startup gate (ordered)  [capability: Safety Gates] [priority: P0] [type: Lifecycle]
GIVEN the autonomous run request
WHEN checking readiness in fixed order
THEN (1) fence present, (2) fence usable [stale vs invalid], (3) ≥1 in-scope measured region, (4) calibration present, (5) calibration usable, then ONLY IF long run (RULE-031) (6) value-proxy present, (7) value-proxy usable
AND the FIRST failure → `{exitCode:1, message:<first gap>}` and the loop returns immediately; all pass → `null`
AND `[LEGACY-DEFECT: do-not-port-faithfully]` the changecost artifact is NOT in this gate (RULE-054 exists, is tested, has zero production callers); the value-proxy gate trusts `Vhat` rows whose changecost provenance is never validated. The rewrite should add a changecost readiness step (SME-Q4).
SOURCE: packages/orchestrator/src/main/orchestrator.ts:269-320 (wired runtime.ts:685-715)
ACCEPTANCE: Given a missing fence artifact, runStartupGate returns exitCode==1 with the fence-missing message and stops before checking calibration; given all artifacts valid on a short run, returns null without requiring value-proxy.

### RULE-031 Value-proxy required only for long runs  [capability: Safety Gates] [priority: P0] [type: Policy]
GIVEN the requested iteration count
WHEN gating at startup
THEN value-proxy validation is required iff `iterations > LONG_RUN_ITERATIONS`; otherwise the value-proxy checks are SKIPPED
AND constants: `LONG_RUN_ITERATIONS=5`; CLI default iterations also 5, so the default `codenuke run` does NOT require value-proxy (boundary is `>`, not `≥`); missing count defaults to 5 (not required)
AND `[suspected-defect]` a short run can proceed with a silently-wrong proxy (intentional per threshold; SME-Q8 on whether 5 is right / configurable)
SOURCE: packages/orchestrator/src/main/orchestrator.ts:17,266-303
ACCEPTANCE: Given iterations=5 → shouldRequireValueProxyValidation==false; given iterations=6 → true; given undefined → false.

### RULE-032 Doctor readiness report  [capability: Safety Gates] [priority: P1] [type: Validation]
GIVEN the same artifacts as RULE-030
WHEN running `codenuke doctor`
THEN collect EVERY readiness gap (not just the first) in legacy order, render legacy output lines, return exit 0 (ready) / 2 (not ready) — distinct from the loop's exit 1
SOURCE: packages/orchestrator/src/main/orchestrator.ts:84-215
ACCEPTANCE: Given a missing fence AND stale calibration, doctor reports both gaps and exits 2; given all artifacts ready, doctor exits 0.

---

## Capability: Calibration

### RULE-010 Calibration scales (median of positive deltas)  [capability: Calibration] [priority: P1] [type: Calculation]
GIVEN the last 80 first-parent commits' before/after measurements
WHEN deriving per-repo normalizers
THEN each commit delta is `|after − before|` per axis (ABSOLUTE; contrast RULE-059 signed); keep commits with any positive delta; if `≥3` qualify, `scaleX = median(positive deltas of X)`, else fall back to default per axis
AND constants: `MIN_CALIBRATION_COMMITS=3`; `DEFAULT_CALIBRATION_SCALES={sL:150, sCx:15, sDup:5}`; history `git rev-list --first-parent --max-count=80`
AND `median([])=0`; `positiveScale` falls back when median ≤ 0; even-length median = mean of middle two
AND `[suspected-defect]` the 80-commit first-parent-only window is unparameterized; merge-heavy histories sample differently
SOURCE: packages/calibrate/src/main/calibrate.ts:39-84
ACCEPTANCE: Given positive ΔL deltas [100,150,200] across 3 commits → sL==150 (median); given <3 qualifying commits → sL falls back to 150; given an even count [100,200] → median==150.

### RULE-023 Calibration artifact status + provenance  [capability: Calibration] [priority: P0] [type: Validation]
GIVEN a calibration artifact
WHEN validating it
THEN `stale` on baseline drift; `invalid-metadata` if `schemaVersion≠1` or bad timestamp; `invalid-provenance` if `commitsSampled < 3` AND scales differ from defaults; `invalid-scales` if any of sL/sCx/sDup is not positive finite; else `usable`
AND constants: `MIN_CALIBRATION_COMMITS=3`; `DEFAULT_CALIBRATION_SCALES={150,15,5}`
AND the "<3 commits but equals defaults ⇒ valid" branch lets honest fallback artifacts pass while rejecting under-sampled custom scales (and guards RULE-001 against scaleX=0)
SOURCE: packages/artifacts/src/main/artifacts.ts:181-222
ACCEPTANCE: Given commitsSampled=2 with custom scales {sL:99,...} → invalid-provenance; given commitsSampled=2 with scales=={150,15,5} → usable; given sL=0 → invalid-scales; given drifted baseline → stale.

---

## Capability: Value-Proxy Validation

### RULE-014 Tie-averaged ranks & Spearman ρ  [capability: Value-Proxy Validation] [priority: P1] [type: Calculation]
GIVEN two equal-length numeric series
WHEN correlating them
THEN ranks assign each tie-span its 1-based midpoint rank `(start+end)/2 + 1`, preserving input order; `spearmanRho = pearson(ranks(left), ranks(right))`
AND `ranks` throws `RangeError` on any non-finite value; ρ is `NaN` for `length<2` or zero-variance; unequal lengths throw
SOURCE: packages/stats/src/main/stats.ts:77-102; packages/value-proxy/src/main/spearman.ts:35-68
ACCEPTANCE: Given [3,1,2] ranks==[3,1,2]; given ties [5,5,1] ranks==[2.5,2.5,1]; given perfectly concordant series spearmanRho==1; match legacy oracle within 1e-12.

### RULE-015 Spearman one-sided permutation p-value  [capability: Value-Proxy Validation] [priority: P1] [type: Calculation]
GIVEN observed ρ over n points
WHEN observed is non-finite → `{p:1, method:"degenerate"}`
THEN if `n! ≤ exactCap` → enumerate all permutations, `p = #{ρ ≥ observed − eps}/n!`, `method:"exact"`; else sample `draws` shuffles (mulberry32), `ge` pre-seeded to 1, `p = ge/(draws+1)`, `method:"sampled"`
AND constants: `exactCap=362880` (9!, NOT config-exposed — RULE-056); `samples=50000`; `seed=0x9e3779b9`; `eps=1e-9`
AND n=3 yields min p≈0.167 even at ρ=1 (small corpora can't be significant); `n!≥171` overflows to Infinity → safely routes to the sampled path
SOURCE: packages/value-proxy/src/main/spearman.ts:106-161
ACCEPTANCE: Given n=4 with ρ=1 (exact path) p==1/24≈0.0417 with method=="exact"; given n=10 method=="sampled" with add-one-smoothed p>0; given non-finite ρ → {p:1,method:"degenerate"}.

### RULE-024 Value-proxy validation contract + re-derivation  [capability: Value-Proxy Validation] [priority: P0] [type: Validation]
GIVEN a stored value-proxy validation artifact
WHEN validating it
THEN require `schemaVersion=1`, `passed=true`, `reason=null`, `candidates ≥ minimumCandidates ≥ 2`, `−1 ≤ rho`, `rho ≥ minimumRho`, `0 < alpha ≤ 1`, `0 ≤ pValue ≤ alpha`, `rows.length === candidates`, each row `{id,proxy,Vhat}` finite
AND re-run `validateValueProxy` and require matching `rho`, `pValue` (within 1e-9) and identical `pMethod`
AND `parseValidationOptions` throws on `CN_MIN_RHO ∉ [−1,1]`, `CN_MIN_CANDIDATES` non-integer or `<2`, `CN_ALPHA ∉ (0,1]`; invalid config → structured `invalid-config` report (not a throw)
AND constants: tolerance 1e-9. NOTE: trusts row `Vhat` values without re-checking them against a valid changecost artifact (chains to RULE-054 / SME-Q5)
SOURCE: packages/artifacts/src/main/artifacts.ts:224-279; option bounds value-proxy.ts:144-166
ACCEPTANCE: Given an artifact whose stored rho differs from the rho re-derived from rows by >1e-9, validation fails; given CN_ALPHA=1.5, parseValidationOptions throws; given a hand-edited passed=true with mismatched p-value, re-derivation rejects it.

### RULE-027 Value-proxy corpus-size gate  [capability: Value-Proxy Validation] [priority: P0] [type: Validation]
GIVEN a candidate corpus
WHEN validating (first lexicographic check)
THEN if `candidates.length < minimumCandidates` → fail `too-small-corpus`
AND constants: `minimumCandidates=6` (an "AI-native HITL decision", env `CN_MIN_CANDIDATES`); even at the floor of 2, the n=3 significance trap (RULE-015) still blocks tiny corpora
AND `[suspected-defect]` `6` is a chosen, non-derived threshold (SME-Q6)
SOURCE: packages/value-proxy/src/main/value-proxy.ts:99-140
ACCEPTANCE: Given 5 candidates and minimumCandidates=6 → reason=="too-small-corpus"; given 6 candidates the corpus check passes to the ρ check.

### RULE-028 Value-proxy effect-size gate (ρ)  [capability: Value-Proxy Validation] [priority: P0] [type: Validation]
GIVEN proxy values and `negVhat = −Vhat` (so "high proxy ↔ low cost" reads as positive correlation)
WHEN validating
THEN non-finite ρ → fail `undefined-rank-correlation`; `ρ < minimumRho` → fail `low-rho`
AND constants: `minimumRho=0.6` (env `CN_MIN_RHO`)
SOURCE: packages/value-proxy/src/main/value-proxy.ts:99-140
ACCEPTANCE: Given ρ=0.55 and minimumRho=0.6 → reason=="low-rho"; given zero-variance proxy (ρ=NaN) → "undefined-rank-correlation"; given ρ=0.7 passes to the significance check.

### RULE-029 Value-proxy significance gate (α)  [capability: Value-Proxy Validation] [priority: P0] [type: Validation]
GIVEN the permutation p-value (RULE-015)
WHEN validating (final check)
THEN `p > alpha` → fail `not-significant`; else PASS (note `p === alpha` PASSES)
AND constants: `alpha=0.05` (env `CN_ALPHA`)
SOURCE: packages/value-proxy/src/main/value-proxy.ts:99-140
ACCEPTANCE: Given p=0.06, alpha=0.05 → reason=="not-significant"; given p==0.05 → passed==true; given p=0.01 → passed==true.

### RULE-056 Permutation `exactCap` DoS guard  [capability: Value-Proxy Validation] [priority: P1] [type: Policy]
GIVEN n candidates
WHEN choosing the p-value path
THEN `n! ≤ 362880` → exact enumeration; else sampled (50000 draws, add-one smoothing so p>0)
AND constants: `exactCap=362880` is HARDCODED and never wired to config (untrusted config cannot force O(n!) enumeration); `n!` overflows to Infinity at n≥171 → sampled
SOURCE: packages/value-proxy/src/main/spearman.ts:131-135
ACCEPTANCE: Given n=9 (9!==362880) → method=="exact"; given n=10 (>9!) → method=="sampled"; exactCap is not overridable by any env var.

---

## Capability: Change-Cost Ground Truth

### RULE-011 Change cost & 𝒱̂ (cost = tokens + β·verify)  [capability: Change-Cost Ground Truth] [priority: P1] [type: Calculation]
GIVEN a completed change's `editTokens` and `verifyFrac`
WHEN costing it
THEN `cost = editTokens + β·verifyFrac`; `𝒱̂ = mean(costs over status==="done")`, or `null` when none are done
AND constants: `β=60` default (env `CN_BETA`); at β=60 a fully-unfenced region (verifyFrac=1) costs as much as 60 edited tokens
AND `[suspected-defect]` `60` is duplicated as a literal default in two places (`costOf(…,beta=60)` and `parseChangeCostBeta`); changing one leaves the other stale (centralize into Config — ASSESSMENT Debt #9)
SOURCE: packages/changecost/src/main/changecost.ts:189-195
ACCEPTANCE: Given editTokens=100, verifyFrac=0.5, β=60 → cost==130; given costs=[130,70] → 𝒱̂==100; given no done results → 𝒱̂==null.

### RULE-012 editCost — LCS token edit size  [capability: Change-Cost Ground Truth] [priority: P1] [type: Calculation]
GIVEN before/after leaf-token streams of a counted source file
WHEN measuring the edit
THEN `editSize = (n − lcs) + (m − lcs)` over token counts `n,m` (rolling-array LCS); total `editTokens = Σ editSize over changed counted source files`
AND "counted" = file under `srcDir` AND `isSourceFile` (RULE-033); empty `a`→`m`; empty `b`→`n`; missing file tokenizes to `[]`; identical files cost 0
SOURCE: packages/changecost/src/main/changecost.ts:67-87 (LCS), 149-175 (per-file)
ACCEPTANCE: Given identical before/after → editSize==0; given before=[a,b,c], after=[a,x,c] (lcs=2) → editSize==(3-2)+(3-2)==2; match legacy oracle.

### RULE-013 verifyCost — mean fence gap  [capability: Change-Cost Ground Truth] [priority: P1] [type: Calculation]
GIVEN touched regions and the fence artifact
WHEN computing the verification cost
THEN `verifyFrac = regions.length===0 ? 0 : Σ(1 − fidelity(r))/n`, with `fidelity(r)=fence.regions[r]?.p ?? 0`
AND when no fence artifact exists, the CALLER substitutes `verifyFrac = 1` (changecost.ts:594) — `verifyCost` itself does not special-case null fence
AND `[suspected-defect]` this fence-gap MEAN is one of THREE implementations of the same idea and aggregates DIFFERENTLY from RULE-002's `mfence` (a MIN). RULE-002 uses worst-region fidelity for risk; RULE-013 uses mean gap for cost. The other copies (RULE-054 `artifacts.ts:281-300`) handle the null-fence/empty-region ordering INSIDE the function (null→1 before empty→0) — a drift hazard. The rewrite should expose ONE shared fence-gap helper and decide min-vs-mean explicitly (SME-Q1)
SOURCE: packages/changecost/src/main/changecost.ts:177-187
ACCEPTANCE: Given regions [r1,r2] with fidelities {r1:0.9,r2:0.8} → verifyFrac==(0.1+0.2)/2==0.15; given empty regions → 0; given null fence at the call site → caller passes 1.

### RULE-054 Changecost artifact re-derivation (UN-WIRED)  [capability: Change-Cost Ground Truth] [priority: P0] [type: Validation]
GIVEN a changecost ground-truth artifact
WHEN validating it
THEN require `schemaVersion=1`, finite non-neg `beta`, `results.length===total`; for each done result `verifyFrac ≈ changeCostVerifyFrac(regions,fence)` and `cost ≈ editTokens + beta·verifyFrac`; `Vhat===null` iff no done results else `Vhat ≈ mean(costs)`
AND constants: tolerance 1e-9; null-fence → expected verifyFrac 1
AND `[LEGACY-DEFECT: do-not-port-faithfully]` `changeCostArtifactStatus` is COMPLETE and unit-tested but called by NOTHING in production (confirmed: only its own definition + generated `.d.ts` reference it). The engine never validates changecost before deriving value-proxy from it — the single fail-closed gating gap. The rewrite should WIRE this into the startup gate (RULE-030) so value-proxy `Vhat` provenance chains to a validated changecost artifact (SME-Q4). Also the THIRD copy of the RULE-013 fence-gap mean
SOURCE: packages/artifacts/src/main/artifacts.ts:281-381
ACCEPTANCE: Given a changecost artifact whose stored cost differs from `editTokens + beta·verifyFrac` by >1e-9, validation reports invalid; AND a call-graph assertion that no production module imports `changeCostArtifactStatus` (the defect to fix).

### RULE-055 Changecost implementer-surface guard  [capability: Change-Cost Ground Truth] [priority: P1] [type: Validation]
GIVEN the dirty path set after the implementer runs a benchmark task
WHEN validating the surface
THEN any path failing `isUnderSourceDir ∧ isSourceFile` → `status:"impl-bad-surface"`, record disallowed, clean worktree, skip (excluded from 𝒱̂)
AND node_modules and hidden-benchmark deletions are excluded from the dirty set
SOURCE: packages/changecost/src/main/changecost.ts:568-576
ACCEPTANCE: Given an implementer that edited a `.test.ts` file → status=="impl-bad-surface" and the delta is excluded from the mean; given edits only under srcDir source → status=="done".

---

## Capability: Measurement

### RULE-003 Size metric `L` — AST node count  [capability: Measurement] [priority: P1] [type: Calculation]
GIVEN the set of non-test source files for a region
WHEN `measure` runs
THEN `L = Σ (count of ts.Node in each file's parsed AST)`
AND test files (`.test`/`.spec`, `__tests__`) excluded (measure.ts:28-29); comment/whitespace/formatting edits don't change node count (so they fail RULE-021 G4)
SOURCE: packages/measure/src/main/measure.ts:41-50
ACCEPTANCE: Given a file reformatted (whitespace only) → L unchanged; given a deleted statement → L decreases by that statement's node count; test files contribute 0.

### RULE-004 Cyclomatic complexity  [capability: Measurement] [priority: P1] [type: Calculation]
GIVEN parsed non-test source ASTs
WHEN summing complexity
THEN `complexity = 1 + Σ decision_points` where decision points = `if`, ternary, `case`, `for`/`for-in`/`for-of`, `while`, `do`, `catch`, and binary `&&` / `||` / `??`
AND `switch` itself not counted (only `case`); `default` excluded (not a `CaseClause`); optional chaining `?.` not counted
AND `[suspected-defect]` `??` is counted as a branch but `?.` is not — debatable vs classic McCabe; may inflate complexity (SME-Q9)
SOURCE: packages/measure/src/main/measure.ts:52-86
ACCEPTANCE: Given source with one `if` and one `&&` → complexity==1+2==3; given `a ?? b` → +1; given `a?.b` → +0; switch with 2 cases → +2 (cases only).

### RULE-005 Duplicate-window mass  [capability: Measurement] [priority: P1] [type: Calculation]
GIVEN token streams of non-test files (import/re-export lines stripped)
WHEN sliding a 12-token window
THEN a window qualifies only if it has ≥5 distinct content tokens (identifiers/strings/numbers/templates/JSX text); for each qualifying signature seen `c ≥ 2` times, add `c − 1` to `dupMass` (cross-file duplication included)
AND constants: `CLONE_WINDOW=12`, `MIN_CONTENT=5` (HARDCODED module constants measure.ts:25-26, not config-exposed); files shorter than 12 tokens contribute nothing
AND `[suspected-defect]` window/min-content magic numbers feed dDup→gain (RULE-001) but are undocumented and not tunable per repo
SOURCE: packages/measure/src/main/measure.ts:119-152
ACCEPTANCE: Given a 12-token content-rich window appearing 3 times → dupMass contribution==2 (c-1); given a window with <5 distinct content tokens → 0; given a file of 8 tokens → 0.

### RULE-016 Retired measure probe subsystem  [capability: Measurement] [priority: P2] [type: Policy]
GIVEN the legacy `runProbes`/`scoreControl`/transpile measurement subsystem
WHEN modernizing measure
THEN it is INTENTIONALLY not ported (documented as RULE-016) — not part of the current size/complexity/dup signal
SOURCE: packages/measure/src/main/measure.ts:5
ACCEPTANCE: Confirm no `runProbes`/`scoreControl`/transpile probe export exists in the measure surface; the rewrite carries forward only RULE-003/004/005.

### RULE-017 Retired dead statistical exports  [capability: Measurement] [priority: P2] [type: Policy]
GIVEN the legacy dead exports (`any`/`cloneSites`/`dupRate`/`kappa`) and statistics (`erf`/`normalCDF`/`mannWhitney`/AUC/bootstrap helpers)
WHEN modernizing
THEN they are intentionally DROPPED (RULE-017); only `wilson` and `ranks` survive from legacy stats
SOURCE: packages/measure/src/main/measure.ts:6; packages/stats/src/main/stats.ts:6
ACCEPTANCE: Confirm the stats surface exports only `wilson` and `ranks` (plus their types); none of the enumerated legacy exports are present.

---

## Capability: Loop Orchestration

### RULE-038 Autoloop reduce-iteration lifecycle  [capability: Loop Orchestration] [priority: P0] [type: Lifecycle]
GIVEN a selected admissible region (RULE-039, mode=reduce)
WHEN the iteration runs
THEN `region-selected → proposer-isolated` (hide benchmark, unlink node_modules — RULE-046) → run proposer (one edit) → validate surface (RULE-025) → relink deps → measure before/after → score (RULE-035)
AND on `keep`: `git commit` the source, `writeState({...state, iter:iter+1, accepted:[...,commit]})`, journal `keep`
AND on `!keep`/crash/out-of-surface/noop: `cleanPaths`, journal the status, NO state write
AND constants: command timeout 300000 ms; commit identity `loop@codenuke` / `codenuke` / `gpgsign=false`
AND `[suspected-defect]` `state.iter` increments ONLY on keep, yet the final summary prints `iterations=${state.iter}` — it actually reports the ACCEPTED count, not iterations run; raise commits never enter `state.accepted` (asymmetric with RULE-040) (SME-Q-Dt7)
SOURCE: packages/orchestrator/src/main/runtime.ts:734-1160
ACCEPTANCE: Given a keep verdict, after the iteration state.iter is +1, state.accepted contains the new commit SHA, and a `keep` row is journaled; given a revert, state is unchanged and a revert row is journaled.

### RULE-039 Region & mode selection  [capability: Loop Orchestration] [priority: P0] [type: Lifecycle]
GIVEN the current fence artifact and target filter
WHEN choosing work each iteration
THEN `chooseRegion` = highest-`lo` blocked region, else first admissible, else default; `selectMode = region.admissible===true ? "reduce" : "raise"`
AND there is NO persisted cursor — selection is recomputed every iteration; an unmeasured region (`undefined`) → raise
AND `[suspected-defect]` no cooldown — a region yielding `raise-nogain` repeatedly can be re-selected indefinitely (SME-Q-Dt5); `targetRegionFilter` has a duplicated dead `||` branch (orchestrator.ts:55-59); highest-`lo`-first intent is Medium-confidence (SME-Q7)
SOURCE: packages/orchestrator/src/main/orchestrator.ts:31-80; per-iteration runtime.ts:735-747
ACCEPTANCE: Given blocked regions with lo {a:0.85,b:0.70} → chooseRegion=="a" (highest lo), selectMode=="raise"; given all admissible → first admissible, selectMode=="reduce"; given an unmeasured region → "raise".

### RULE-040 Autoloop raise-iteration lifecycle  [capability: Loop Orchestration] [priority: P0] [type: Lifecycle]
GIVEN a non-admissible region with survivor specs (mode=raise)
WHEN the iteration runs
THEN capture `loBefore` → isolate → raise proposer (add tests, RULE-042) → validate test surface (RULE-026) → run tests → `git commit` tests → `replay` (RULE-043)
AND keep (`raise`) iff `replayRegion.lo > loBefore + 1e-9`; else `raise-nogain` and discard the tip commit (`reset --hard HEAD~1`)
AND reject earlier with `raise-noop` (no tests added) / `raise-badtest` (out-of-surface or tests fail) / `raise-error` (replay failed → discard commit) / `raise-skip` (no survivor specs)
AND constants: strict-gain epsilon 1e-9; survivor display cap 12
AND `[suspected-defect]` `raise-skip` does `break` (aborts ALL remaining iterations) while every other terminal does `continue` — one empty-survivor region stalls the whole run (SME-Q-Dt6); the rewrite should `continue`
SOURCE: packages/orchestrator/src/main/runtime.ts:757-992
ACCEPTANCE: Given loBefore=0.80 and a replay yielding lo=0.86 → status=="raise", commit kept; given replay lo==loBefore → "raise-nogain" and HEAD reset by one commit; given no survivor specs → "raise-skip".

### RULE-042 Proposer prompts (reduce / raise)  [capability: Loop Orchestration] [priority: P1] [type: Policy]
GIVEN a region and program preface (reduce) or survivor specs + test layout (raise)
WHEN building the prompt
THEN reduce = preface + "Make exactly ONE behavior-preserving reduction in a single file under <region>, then stop. Do not run commands; just edit."
AND raise = "ADD characterization tests where this repo's test command will discover them: <layout>. Do NOT change any source" + the survivor list (capped at 12)
SOURCE: packages/orchestrator/src/main/orchestrator.ts:368-390
ACCEPTANCE: Given mode=reduce and region "scorer" the prompt contains the exact reduce sentence naming the region; given mode=raise the prompt contains "Do NOT change any source" and at most 12 survivor entries.

### RULE-044 Scorer manual command lifecycle  [capability: Loop Orchestration] [priority: P0] [type: Lifecycle]
GIVEN a scorer manual command (`init`/`score`/`accept`/`revert`/`status`/`cleanup`)
WHEN dispatched
THEN `init` → resolve SHA, recreate worktree, link deps, run tests+typecheck (abort if baseline RED), `writeState(iter:0)`
AND `score` (read-only) → compute changed source, run gates, print verdict; `accept` → RE-SCORE and require `verdict.keep` else exit 1, commit, `writeState(iter+1)`; `revert` → checkout+clean srcDir; `status` → print cumulative reduction (RULE-062); `cleanup` → rm state + remove worktree
AND every state-requiring command returns "run init first" if `.state.json` is absent
AND constants: timeouts 300000 ms; commit identity shared with RULE-038
AND `[suspected-defect]` `accept` does not re-verify the worktree is still at the expected baseline/clean state between `init` and `accept`; uses RULE-053-unvalidated `readState`
SOURCE: packages/scorer/src/main/scorer.ts:419-614
ACCEPTANCE: Given `accept` when the re-score yields keep==false → exit code 1 and no commit; given any state command with no `.state.json` → prints "run init first"; given `init` on a RED baseline → aborts and removes the worktree.

### RULE-057 Proposer thread continuity  [capability: Loop Orchestration] [priority: P1] [type: Lifecycle]
GIVEN a propose request
WHEN resolving the conversation thread
THEN key = `${mode}:${regionTarget}`; resume `state.threads[key]?.threadId` if present, else start fresh; on success persist `{threadId, createdAt, lastUsedAt}`; on failure keep the existing thread
AND constants: `schemaVersion:1`, `provider:"codex-sdk"`; SDK adapter only
AND `[suspected-defect]` threads are NEVER invalidated when the baseline SHA changes and have no TTL/eviction — an old thread with stale code context is resumed after a re-fence (SME-Q-Dt-threads); the rewrite should expire threads on baseline change
SOURCE: packages/orchestrator/src/main/proposer.ts:63-112,241-297
ACCEPTANCE: Given an existing thread for "reduce:scorer", a second reduce request resumes the same threadId; given a different mode/region, a fresh thread is started; (rewrite) given a changed baseline SHA, the thread is invalidated.

---

## Capability: Config Resolution

### RULE-033 Source/test file classification  [capability: Config Resolution] [priority: P1] [type: Policy]
GIVEN a path
WHEN classifying it
THEN test ⇔ `/\.(test|spec)\.[jt]sx?$/ ∧ ¬endsWith(".d.ts")`; source ⇔ JS/TS ext ∧ ¬`.d.ts` ∧ ¬test ∧ ¬`.accept.`
AND `[suspected-defect]` this predicate is re-implemented verbatim in ≥4 files (config.ts:71, orchestrator.ts:322, fence.ts:144, calibrate.ts:107) — drift risk; the rewrite should have ONE shared export (ASSESSMENT Debt #1)
SOURCE: packages/config/src/main/config.ts:66-72
ACCEPTANCE: Given "scorer.ts" → source; given "scorer.test.ts" → test (not source); given "types.d.ts" → neither; given "x.accept.ts" → neither.

### RULE-034 Region detection  [capability: Config Resolution] [priority: P1] [type: Policy]
GIVEN a source path
WHEN determining its region
THEN `region = first path segment under srcDir`; the region LIST = immediate subdirs of `srcDir` with ≥1 non-test source file
SOURCE: packages/config/src/main/config.ts:103-110,260
ACCEPTANCE: Given srcDir="packages" and path "packages/scorer/src/main/scorer.ts" → region=="scorer"; a subdir containing only test files is excluded from the region list.

### RULE-048 Config rejects legacy shell-string commands  [capability: Config Resolution] [priority: P1] [type: Validation]
GIVEN the environment / config file
WHEN resolving commands
THEN `CN_TEST` / `CN_TYPECHECK` / `CN_IMPLEMENTER` / `CN_PROPOSER` set as strings → THROW a migration error
AND `commandSpec` requires non-empty `file`, `args` as `string[]`, `timeoutMs` finite >0, `env` a string record; `*_FILE` required when `*_ARGS_JSON` set; invalid `*_ARGS_JSON` → "must be a JSON array of strings"
AND NOTE: `AGENTS.md:31` still calls these "trusted shell strings" — the maintainer doc contradicts the code (ASSESSMENT Doc gap #1)
SOURCE: packages/config/src/main/config.ts:348-395,434-439
ACCEPTANCE: Given `CN_TEST="npm test"` (string) → config resolution throws a migration error; given `CN_TEST_FILE="npm"` + `CN_TEST_ARGS_JSON='["test"]'` → resolves a valid CommandSpec; given malformed args JSON → throws.

### RULE-049 Config numeric/weight bounds  [capability: Config Resolution] [priority: P1] [type: Validation]
GIVEN config/env numeric settings
WHEN resolving
THEN `fenceLB` finite in [0,1] (default 0.9); `proposerTimeoutMs` finite >0 (default 900000); each weight override finite (else throw, naming the key); `CN_WEIGHTS` must be a JSON object
AND constants/defaults: fenceLB 0.9, timeout 900000 ms, budget "8" USD; empty string/object/null for a numeric setting → throws
SOURCE: packages/config/src/main/config.ts:289-317,404-430,464-472
ACCEPTANCE: Given `CN_FENCE_LB="1.5"` → throws (out of [0,1]); given a weight override `dCx="abc"` → throws naming `dCx`; given no overrides → fenceLB==0.9, proposerTimeoutMs==900000.

### RULE-058 Proposer budget  [capability: Config Resolution] [priority: P1] [type: Policy]
GIVEN `proposerBudgetUsd`
WHEN running the proposer
THEN the budget is passed to the codex provider; an overrun is classified `crash-budget` ONLY if the output contains "maximum budget", else generic `crash`
AND constants: `proposerBudgetUsd="8"` default (env `CN_BUDGET`)
AND `[suspected-defect]` no in-process enforcement — if the provider doesn't emit "maximum budget", an over-budget run is mis-classified (Medium confidence — depends on provider behavior; SME-Q-Dt-budget)
SOURCE: packages/config/src/main/config.ts:519; detection orchestrator.ts:401-405
ACCEPTANCE: Given proposer output containing "maximum budget" → failure class=="crash-budget"; given a generic non-zero exit → "crash"; default budget resolves to "8".

---

## Capability: Worktree & Proposer Substrate

### RULE-045 Worktree lifecycle (node_modules invariant)  [capability: Worktree & Proposer Substrate] [priority: P0] [type: Lifecycle]
GIVEN a baseline SHA
WHEN managing the worktree
THEN `git worktree add -f <wt> <sha>` → `linkWorktreeNodeModules` (root + nested non-hoisted, max depth 4) → add `node_modules` to `info/exclude` (idempotent)
AND `removeWorktree` = unlink symlinks → `git worktree remove --force` → `prune` (tolerant of already-gone)
AND constants: nested-walk maxDepth 4; benchmark dir `<repo>/codenuke.benchmark`; a stale worktree is removed before re-add
AND `[suspected-defect]` unlink/link swallow errors — a failed relink (RULE-046) would silently run tests with no deps → tests RED → false revert; no assertion that relink succeeded (SME-Q-Dt-relink); the rewrite should assert the symlink exists before scoring
SOURCE: packages/substrate/src/main/worktree.ts:35-123; choreography runtime.ts:775,995,1088
ACCEPTANCE: Given a baseline SHA, after create the worktree HEAD == SHA and `node_modules` is a symlink in `info/exclude`; after removeWorktree the path is gone and prune is tolerant of a missing entry.

### RULE-046 Proposer isolation (anti-cheat)  [capability: Worktree & Proposer Substrate] [priority: P0] [type: Lifecycle]
GIVEN the proposer phase
WHEN isolating the worktree from the agent
THEN `hideBenchmark` (rm benchmark dir) + `unlinkWorktreeNodeModules` BEFORE every proposer run
AND `restoreRuntimeDeps` (unlink-then-relink) + `restoreBenchmark` AFTER surface validation, before tests/scoring
AND a real `node_modules` dir the proposer creates is added to the dirty set → treated as out-of-surface
SOURCE: packages/orchestrator/src/main/runtime.ts:775,995; worktree.ts:87
ACCEPTANCE: During the proposer run, the worktree has no node_modules symlink and no benchmark dir; after surface validation both are restored; a proposer-created real node_modules triggers an out-of-surface revert.

### RULE-047 Proposer subprocess mgmt & failure classification  [capability: Worktree & Proposer Substrate] [priority: P1] [type: Lifecycle]
GIVEN a proposer subprocess
WHEN running it
THEN spawn `detached:true, shell:false` in its own group; on timeout `kill(-pid, SIGTERM)` then after 1000 ms `SIGKILL`; `ok = code===0 ∧ ¬timedOut`
AND `proposerFailure` → `crash-timeout` if timed out; `crash-budget` if output contains "maximum budget"; else `crash`
AND constants: proposer timeout `proposerTimeoutMs=900000` (15 min); heartbeat 15000 ms; SIGTERM→SIGKILL grace 1000 ms
SOURCE: packages/substrate/src/main/agent.ts:36-123; classification orchestrator.ts:391-408
ACCEPTANCE: Given a proposer that exceeds 900000 ms → it receives SIGTERM then SIGKILL 1000 ms later and is classified "crash-timeout"; given exit 0 with no timeout → ok==true.

---

## Capability: Results Journal & Status

### RULE-041 Results journal (`results.tsv`) format  [capability: Results Journal & Status] [priority: P2] [type: Policy]
GIVEN an iteration outcome
WHEN journaling it
THEN header = `iter\tcommit\tdAST\tdCx\tbehavior\tmfence\tloss\tstatus\tdescription`
AND each column formats with legacy values (`-` for N/A, `+Inf` for inadmissible loss, fence % deltas for raise)
AND `[suspected-defect]` repo/agent-derived strings are written WITHOUT stripping tab/newline/control/ANSI → TSV/terminal injection (ASSESSMENT Security CWE-117); the rewrite should sanitize control chars before `join("\t")`
SOURCE: packages/orchestrator/src/main/orchestrator.ts:416-520
ACCEPTANCE: Given a kept iteration the row has 9 tab-separated columns with the commit SHA and numeric deltas; given an inadmissible loss the loss column reads "+Inf"; (rewrite) a description containing a tab is escaped.

---

## Capability: Security / Trust-Boundary Guards

### RULE-022 Fence artifact status + anti-tamper  [capability: Security / Trust-Boundary Guards] [priority: P0] [type: Validation]
GIVEN a fence artifact
WHEN validating it
THEN `missing` if no regions; `stale-baseline-{sha,ref}` if baseline drifted; `invalid-metadata` if `method≠"ast-aware"` or `threshold≠fenceLB` or bad cap/seed
AND per region: `wilson(caught,total)` must match stored `p/lo/hi` within 1e-9, `survivorSpecs.length === total − caught`, and `admissible === (lo ≥ threshold)` — else `invalid-regions`
AND constants: `FENCE_NUMBER_TOLERANCE=1e-9`; corrupt JSON → `missing`; a `threshold` mismatch correctly invalidates an old artifact after `CN_FENCE_LB` changes
SOURCE: packages/artifacts/src/main/artifacts.ts:91-171
ACCEPTANCE: Given a hand-edited region with `admissible:true` but `lo<threshold` → invalid-regions; given stored p differing from wilson(caught,total) by >1e-9 → invalid-regions; given threshold≠fenceLB → invalid-metadata; given baseline drift → stale.

### RULE-025 Reduce-surface path guard  [capability: Security / Trust-Boundary Guards] [priority: P0] [type: Validation]
GIVEN the dirty path set after a reduce edit
WHEN validating the surface
THEN allowed iff `isUnderSourceDir(p,srcDir) ∧ isSourceFile(p) ∧ (srcDir≠"." ∨ ¬isRootToolingPath(p))`
AND any disallowed path → restore benchmark+deps, `cleanPaths(disallowed)`, journal `revert "touched outside reduce source surface"`
AND constants: `ROOT_TOOLING_DIRS` (`.github`, `benchmarks`, `docs`, `scripts`, `test(s)`) and `*.config.*` excluded when `srcDir="."`
SOURCE: packages/orchestrator/src/main/orchestrator.ts:354-358; enforced runtime.ts:1055-1081
ACCEPTANCE: Given a reduce edit that also modified a `.test.ts` → revert with "touched outside reduce source surface"; given an edit only to non-test source under srcDir → allowed; given srcDir="." and a `*.config.ts` edit → reverted.

### RULE-026 Raise-surface path guard  [capability: Security / Trust-Boundary Guards] [priority: P0] [type: Validation]
GIVEN the dirty path set after a raise proposer
WHEN validating
THEN allowed iff `/\.(test|spec)\.[jt]sx?$/ ∧ testRoots.some(root → underTestRoot(p,root))`
AND any disallowed path → restore, `cleanPaths(disallowed)`, journal `raise-badtest "touched outside raise test surface"`
AND constants: `config.testLayout.roots` (auto-detected)
SOURCE: packages/orchestrator/src/main/orchestrator.ts:363-365; enforced runtime.ts:854-878
ACCEPTANCE: Given a raise proposer that edited a source `.ts` file → raise-badtest revert; given it added a `.test.ts` under a discovered test root → allowed.

### RULE-050 `safeWorktreePath` traversal/symlink guard  [capability: Security / Trust-Boundary Guards] [priority: P0] [type: Validation]
GIVEN a worktree-relative path
WHEN resolving it for I/O during mutation
THEN reject if empty / leading `/` / contains `..`; `realpath(root)` must succeed; `resolve(root,rel)` must stay under root; `lstat` must not be a symlink; `realpath(target)` must stay under root — else throw
AND the changecost variant additionally rejects `\0` and `\\` and walks each segment
AND `[LEGACY-DEFECT: do-not-port-faithfully]` (a) TWO divergent implementations (fence does NOT reject `\0`/`\\`); (b) the scorer and orchestrator candidate reads (scorer.ts:317-318, runtime.ts:403-404) BYPASS this guard with raw string concat — symlink-escape is unchecked on the read path the judge trusts (CWE-22/CWE-59). The rewrite should have ONE guard and route EVERY worktree read through it (SME-Q-Dt3)
SOURCE: packages/fence/src/main/fence.ts:310-347; second impl packages/changecost/src/main/changecost.ts:272-291
ACCEPTANCE: Given paths "", "/abs", "../escape", a symlink, and one whose realpath escapes the root → each throws; (rewrite) the scorer's candidate read of a planted symlink also throws rather than reading outside the worktree.

### RULE-052 Git ref/pathspec safety guards  [capability: Security / Trust-Boundary Guards] [priority: P0] [type: Validation]
GIVEN a git ref or pathspec
WHEN building a command plan
THEN validate against the safe-ref/safe-path predicates (no leading `-`, no NUL, no `..`, no absolute/`:`-prefixed pathspecs; resolved SHAs must be 40-hex) and use `--`/`--end-of-options` separators — else throw "unsafe git ref/path"
AND constants: `SAFE_REF=/^[A-Za-z0-9][A-Za-z0-9._/~^-]*$/`, `SAFE_PATH=/^[A-Za-z0-9._/-]+$/`; calibrate additionally bans `.lock` refs; changecost bans `\\` in source paths
AND NOTE: three independent implementations with slightly different coverage — candidate for one shared guard (ASSESSMENT Debt, but verified NOT exploitable)
SOURCE: packages/scorer/src/main/scorer.ts:165-187; packages/calibrate/src/main/calibrate.ts:112-133; packages/changecost/src/main/changecost.ts:230-252
ACCEPTANCE: Given a ref "-x" or one containing ".." or NUL → throws "unsafe git ref/path"; given a valid 40-hex SHA → the plan includes `--`/`--end-of-options`.

### RULE-053 Engine-state shape validation + SHA reconcile  [capability: Security / Trust-Boundary Guards] [priority: P0] [type: Validation]
GIVEN `.state.json`
WHEN the orchestrator loads it
THEN require `/^[0-9a-f]{40}$/` SHA, integer `baselineTsc`/`startL`/`iter`, `accepted: string[]`; then `git rev-parse` must resolve the SHA back to itself — else throw and return exit 1
AND `[LEGACY-DEFECT: do-not-port-faithfully]` the SCORER's `readState` (scorer.ts:221-223) does `JSON.parse(...) as ScorerState` with NO validation — the immutable judge trusts the same artifact the orchestrator validates (CWE-502; SME-Q-Dt2). The rewrite should share ONE validating reader across orchestrator and scorer
SOURCE: packages/orchestrator/src/main/runtime.ts:128-189
ACCEPTANCE: Given a state file with a non-40-hex baselineSha → orchestrator throws/exit 1; given a SHA that no longer resolves → throws; (rewrite) the scorer's readState rejects the same malformed state instead of trusting it.

---

## Appendix A — `[LEGACY-DEFECT: do-not-port-faithfully]` register

| Rule | Defect (one line) | Fix direction |
|------|-------------------|---------------|
| RULE-054 | `changeCostArtifactStatus` is complete + tested but has ZERO production callers — changecost.json is the one safety artifact never re-validated at runtime | Wire into the RULE-030 startup gate so value-proxy `Vhat` provenance chains to a validated changecost |
| RULE-063 | `verdictLabel` reports only the highest-priority gate failure (G1′ first), masking concurrent G1/G3/G4 failures in the journal | Emit all failing gate names |
| RULE-053 | Scorer's `readState` reads `.state.json` UNVALIDATED while the orchestrator fully validates the identical shape (asymmetric trust, CWE-502) | Share one validating reader across both |
| RULE-050 | Two divergent `safeWorktreePath` impls AND two worktree reads (scorer/orchestrator) bypass the guard entirely (CWE-22/59) | One guard; route every worktree read through it |
| RULE-002/013/054 (cross-cutting) | The fence-gap is aggregated as MIN for scorer risk but MEAN for change cost, with the mean re-implemented in 3 places with divergent null/empty ordering | One shared fence-gap helper; decide min-vs-mean explicitly (SME-Q1) |

Additional suspected-defects (preserve-vs-fix, lower blast radius) are inlined on their rules: RULE-001 (underived dCx/dDup weights), RULE-002/RULE-058/RULE-011 (hardcoded 0.002 / β=60 duplication), RULE-038 (`iter` mislabeled iterations), RULE-040 (`raise-skip` aborts run), RULE-039 (no region cooldown), RULE-057 (no thread expiry), RULE-045 (silent relink failure), RULE-041 (TSV injection), RULE-033 (predicate duplicated 4×).

## Appendix B — Doc-vs-source reconciliation

All 61 rules' constants and formulae were spot-checked against source and AGREE with `BUSINESS_RULES.md`. Two clarifications surfaced and are folded into the rules above:
1. RULE-013 vs RULE-054 null-fence handling: `verifyCost` (changecost.ts:177-187) does NOT special-case a null fence — its caller substitutes `verifyFrac=1` (changecost.ts:594). The re-derivation copy `changeCostVerifyFrac` (artifacts.ts:281-300) DOES return 1 for null fence internally, ordered BEFORE the empty-regions check. Same numeric result, different locus — reinforcing the RULE-013 drift hazard. No contradiction.
2. RULE-054 un-wired status: confirmed by call-graph grep — `changeCostArtifactStatus` is referenced only by its own definition (artifacts.ts:338) and the generated `.d.ts`; no production import. Confirms the LEGACY-DEFECT tag.
