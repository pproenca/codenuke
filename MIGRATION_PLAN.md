# codenuke → Effect-TS: Full Migration Plan

> Durable execution context for the **full migration** to the reimagined
> codenuke. Read this with [`CLAUDE.md`](./CLAUDE.md) (the architecture/knowledge
> graph) and the specs in [`docs/`](./docs) (now vendored — the repo is
> self-contained and fresh-repo-ready). Created 2026-05-24.

## Goal

Replace the legacy codenuke with a ground-up **Effect-TS** rebuild that delivers
the same capability — autonomous, behavior-preserving code reduction — with typed
errors, `Layer` DI, `Schema`-validated boundaries, streaming progress, structured
concurrency, a POSIX/agent-optimised CLI, and a swappable code-SDK proposer. The
legacy repo is the **spec source**, not the structural template.

## Locked decisions

| Decision | Choice | Consequence |
|---|---|---|
| **Backwards compatibility** | **Not required** | Free to redesign artifact schemas, config, and CLI surface; hard cutover, no deprecation window. |
| **P0 scope** | **C1–C11** (drop C12 results-journal for now) | 59/61 rules in scope; C12 returns later as a progress-stream sink. RULE-036/037 retired; RULE-041/062 = C12. |
| **Legacy defects** | **Fix all 5** in the rebuild | Acceptance tests assert corrected behavior (RULE-054/063/053/050 + the min/mean fence-gap split). |
| **Proposer SDK** | **Codex (`@openai/codex-sdk`) parity** | `CodexProposerLive` is the one live adapter; `FakeProposer` for tests; `claude-code.ts` is a documented drop-in stub behind the same `Proposer` tag. `CN_CODEX_PROVIDER` retained. |
| **Cutover** | **Fresh repo** (`codenuke-next` → publishes `codenuke@0.5.0`) | Old repo archived (not deleted) for history/blame; differential check runs cross-repo. |
| **Stack** | effect 3.x, `@effect/cli`, `@effect/platform(-node)`, Vitest+`@effect/vitest`, fast-check, pnpm, esbuild | Node ≥ 22; single bundled `codenuke` bin. |

## What "no backcompat" lets us delete

- The **artifact v1 read-compat** layer + its contract test. Redesign `.codenuke/*.json`
  schemas clean (drop the un-wired `ChangeCostArtifactStatus` alias, the mislabeled
  `iter`, the divergent fence-gap copies). First run regenerates; doc note: "delete
  `.codenuke/` and re-run `calibrate`/`fence`."
- **Legacy config migration** (RULE-048): no shell-string field exists in the Schema,
  so the "reject `CN_TEST`/`CN_PROPOSER`/… with a migration error" path collapses to
  "the field isn't there." Keep `CN_*` names; drop legacy aliases.
- **CLI cruft**: the `loop` alias, the undocumented `fence` 3rd positional, the
  `@@JSON@@` sentinel.
- **Oracle parity as a *requirement*.** No byte-for-byte match to
  `test-fixtures/legacy-loop/*.mjs`. (Keep them as a *differential check*, not a contract.)

## Proof strategy (replaces oracle parity)

1. **Behavior Contract = source of truth.** The 59 in-scope acceptance tests
   (`docs/spec/BEHAVIOR_CONTRACT.md`); implementation = flipping each `skip`/`todo`
   to a real assertion. They already encode the 5 fixes as intended divergence.
2. **Determinism property tests** (fast-check): same seed ⇒ identical artifact;
   fence audit at concurrency 1 vs N ⇒ byte-identical `FenceArtifact`. The floor.
3. **Differential shadow-running** (cross-repo): run legacy `codenuke` (pinned as a
   built tarball) and the new one on a fixed set of trusted fixture repos; diff
   verdicts/kept-commits. Every diff is a documented fix or a bug. Harness lives in
   `scripts/differential/`.
4. **Dogfood**: point codenuke at its own repo (legacy did this via
   `scripts/dogfood.mjs`). Self-reduction is the ultimate integration test.

## Slice sequence + cutover

Walking skeleton first; hardest/riskiest pieces early.

| Step | Scope | Done when |
|---|---|---|
| **0. Skeleton** *(in progress)* | `measure` (RULE-003/004/005) real; `score` end-to-end: measure HEAD vs working tree → `decide` → NDJSON verdict over a real git diff. Safety inputs that belong to later slices are explicitly Slice-0 stubs. | `codenuke score --json` returns a real verdict; measure tests real+green. |
| **1. Fence** | Worktree-**per-region** audit (mutants sequential in-place, **never per-mutant worktrees**) + Wilson + survivor + replay; the determinism property test. Wire the cross-repo differential harness here. | concurrency 1-vs-N byte-identical; fence fidelity matches legacy modulo fixes. |
| **2. Loop** | `CodexProposerLive` (streamed turn → `ProgressEvent`s, isolation, budget/timeout) + reduce loop (`run`) + fail-closed startup gate (**RULE-054 closes**). | `codenuke run 5` reduces a repo; shadow-run vs legacy clean. |
| **3. Periodic** | calibrate (C9) + changecost (C11) + value-proxy (C10) artifact IO; `doctor` collects every gap (RULE-032); full fail-closed gate. | `doctor` parity; long-run gate honored. |
| **4. Finish** | raise loop, thread continuity, manual lifecycle (init/accept/revert/status/cleanup), **C12** as a `results.tsv` sink on the progress stream. | all 59 acceptance tests real+green; dogfood passes. |
| **5. Cutover** | Promote to `codenuke-next`; publish `codenuke@0.5.0`; archive old repo. | new bin published; legacy archived. |

## Fresh-repo prep (do at promotion)

1. `git init` `codenuke-next` from this directory; first commit records the legacy
   origin SHA in `CLAUDE.md` for provenance.
2. **Vendor the specs** into `docs/`: `AI_NATIVE_SPEC.md`, `REIMAGINED_ARCHITECTURE.md`,
   `spec/*` (the analysis-workspace links break in a standalone repo). Repoint
   `CLAUDE.md` and any test references from `../../analysis/codenuke/` → `docs/`.
3. `scripts/differential/`: install the legacy `codenuke` tarball + this build, run
   both on fixture repos, diff outputs.
4. CI: typecheck + test + build + the differential harness on a small fixture set.

## Risks / unknowns (surfaced early by the sequencing)

- **Mutation-audit throughput** on large repos (Slice 1) — the dominant cost; bound
  concurrency, measure on a real repo before committing to the model.
- **Codex SDK streaming/cancellation** semantics (Slice 2) — timeout/budget/interrupt
  behavior under `@effect/platform` `runMain`.
- **TS compiler API perf** in `measure` on big trees (Slice 0) — cache `SourceFile`
  parses per run.

## Current status

- **Phases A–F complete** (spec, architecture, scaffold). 3 packages + CLI build.
- **Slice 0 COMPLETE** — `measure` (RULE-003/004/005) via the TS compiler API;
  git read-side; `score` walking skeleton runs end-to-end. Verified on a temp repo.
- **Slice 1 COMPLETE** — fence mutation audit runs end-to-end:
  - Git-agnostic audit ENGINE in `@codenuke/fence` over a `MutationRunner` port
    (no package cycle); deterministic by construction. **Determinism property test
    passes: concurrency 1 vs 8 → byte-identical FenceArtifact** (RULE-008).
  - Real `MutationRunnerLive` (apply-in-place → run test → restore, fail-toward-risk).
  - Worktree provisioning in `GitLive` (`worktreeAdd`/`worktreeRemove`/`lsTree`,
    scoped); `runFenceAudit` orchestration writes `.codenuke/fence-fidelity.json`.
  - Env allowlist consolidated into `@codenuke/core` (the ONE allowlist); fence
    path-guard typechecks clean. **`codenuke fence` smoke**: caught 2/3, Wilson
    interval, correct survivor (dead-code mutant), clean teardown, exit 0.
  - **219 tests: 172 pass / 39 skip / 8 todo.**
- **Slice 2 COMPLETE** — the reduce autoloop runs end-to-end:
  - Fail-closed **startup gate** (RULE-030/031): pure `collectGaps`/`firstGap`
    (ordered) + effectful `startupGate` reading `.codenuke/*.json`. **RULE-054
    closed** — changecost is gated before value-proxy.
  - **Reduce loop** (`runReduceLoop`, RULE-038): one scoped worktree at baseline,
    propose (Proposer port) → measure before/after → diffsize + surface guard
    (RULE-025) → test (G1) → fence fidelity (G1′) → `decide` → keep (commit) /
    revert (discard); result published non-destructively on `refs/codenuke/result`.
  - **`makeApplyingFakeProposerLive`** (edits the worktree) makes the loop hermetic;
    `CodexProposerLive` is a typed-failure stub (needs `@openai/codex-sdk` + creds).
  - Git: `worktreeAdd`/`worktreeRemove`/`lsTree`/`commitAll`/`discardAll`/`updateRef`.
  - **226 tests: 179 pass / 39 skip / 8 todo.** Smoke: gate blocks (exit 2) → fence
    (50/50 admissible) → `run 3` ⇒ KEEP/KEEP/REVERT, master + working tree untouched.
- **Slice 3 (mostly) COMPLETE** — periodic artifacts generate for real:
  - **`doctor`** (RULE-032): collects EVERY readiness gap (no short-circuit), exit 0/2.
  - **`calibrate`** (C9, RULE-010): walks `rev-list` history, measures each commit's
    |per-axis delta|, derives scales, writes `calibration.json` (smoke: real `sL=30`,
    3 commits, enoughHistory). New git helpers `revList`/`diffNamesRange`.
  - **`validate-proxy`** (C10, RULE-024): reads a candidate corpus, runs core Spearman
    + exact/sampled permutation, writes `value-proxy-validation.json` (smoke: rho=1,
    exact p=1/40320, n=8).
  - **Anti-tamper (RULE-022)**: `readArtifactReadiness` recomputes each fence region's
    Wilson `lo` from stored counts and rejects a tampered artifact (smoke: corrupting
    `lo` → `fence-unusable`).
  - **226 tests: 179 pass / 39 skip / 8 todo.** Replaces the hand-written
    calibration/value-proxy fixtures the Slice-2 smoke needed.
  - value-proxy anti-tamper recompute (RULE-024) + calibration staleness still pending.
- **Slice 3+ COMPLETE — REAL @openai/codex-sdk wired (no fakes):**
  - Shared `codex-agent.ts` (`makeCodex`/`openThread`/`codexThreadOptions`) over the
    real SDK (`Codex` → start/resumeThread → runStreamed/run). SDK kept **external**
    in the bundle; declared a runtime dep.
  - **`CodexProposerLive`** — real streaming adapter (ThreadEvent → ProposerEvent,
    AbortController timeout, RULE-047). Default proposer provider.
  - **`changecost` (C11, RULE-011/012/013/055)** — real implementer (`thread.run`)
    per benchmark task in a scoped worktree → tokenized LCS editTokens + verifyFrac
    + cost; 𝒱̂ = mean over done; writes changecost.json. **Smoke (real model ran):**
    0-task → valid artifact; 1-task → agent executed and **RULE-055 surface guard
    fired** (`impl-bad-surface`, disallowed `test.mjs`). `tokenize` added to the pure core.
  - **`doctor: ready` with ZERO hand-written fixtures** — fence/calibrate/value-proxy/
    changecost all self-generated. **226 tests: 179 pass / 39 skip / 8 todo.**
- **Slice 4 COMPLETE** — **manual lifecycle (RULE-044)**: `init`/`score`/`accept`/
  `revert`/`status`/`cleanup` over a managed worktree (`.codenuke/worktree` + state.json,
  RULE-053 reader). **C12 (RULE-041/062)**: `.codenuke/results.tsv` journal + cumulative
  reduction %. Smoke: init→edit→status(7.4%)→score(KEEP)→accept(iter 1)→cleanup; auto
  `run 3` → results.tsv (header + rows) + `reduction 14.8%`.
- **Cutover prep COMPLETE — shippable 0.5.0:** specs vendored into `docs/`; CLAUDE.md
  repointed; **version 0.5.0** (`codenuke --version` → 0.5.0); product **README.md** +
  **CHANGELOG.md** (with post-0.5 roadmap); repo is **self-contained / fresh-repo-ready**.
  **226 tests: 179 pass / 39 skip / 8 todo.**

## Plan status: P0 (C1–C11) complete; 0.5.0 ready to promote

Remaining = the **post-0.5 roadmap** (CHANGELOG.md): raise-fence loop (RULE-040),
thread continuity (RULE-057), budget (RULE-058), typecheck G3 in the loop,
value-proxy/changecost anti-tamper (RULE-024), calibration staleness, fence
node_modules linking (RULE-045) + bounded worktree pool, the cross-repo differential
harness. **Cutover step** (do when promoting): `git init` `codenuke-next` from this
directory, publish `codenuke@0.5.0`, archive the legacy repo.

## Invariants (never break — full list in CLAUDE.md)

Determinism (two distinct PRNGs, do not unify); fence parallelism per-region only;
immutable judge (pure kernel); argv-only subprocess + env allowlist + `mkdtemp 0700`;
`runMain` never `process.exit`; preserve the numeric constants
(weights 1.0/1.8/0.35, scales 150/15/5, fenceLB 0.90, timeout 900000ms, budget $8,
β 60, exactCap 362880, samples 50000, minCandidates 6, minRho 0.6, alpha 0.05,
cap 60, seed 1337).
