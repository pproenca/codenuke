---
title: Specification
description: "Product goals, design, CLI contract, the metric, and architecture"
---

Autonomous, behavior-preserving code reduction.

`codenuke` runs an autonomous loop on a TypeScript repo: an agent proposes a refactor, an
_immutable metric_ judges it, and the change is kept only if it is genuinely smaller **and**
behavior-preserved — otherwise reverted. It is [Karpathy's
`autoresearch`](https://github.com/karpathy/autoresearch) loop applied to refactoring: there
an agent edits `train.py` and an immutable `val_bpb` keeps-or-discards; here an agent edits
your source and an immutable scorer keeps-or-reverts. Everything runs in an isolated git
worktree on an `autoresearch/<tag>` branch, so your working tree is never touched.

## Goals

- Reduce code while provably preserving behavior, unattended, on any TypeScript repo.
- Make the keep/reject decision an immutable, self-policing metric the agent cannot game.
- Measure behavior-preservation, not assume it: gate refactors on a per-region fence whose
  fidelity is mutation-tested with a confidence interval.
- Earn the right to refactor weak regions by writing characterization tests first.
- Optimize the real objective — lower future-change cost — not raw size; measure it directly.
- Keep the inner loop cheap and deterministic; push expensive checks to periodic audits.
- Leave a reviewable trajectory: kept commits on a branch + a per-iteration log.
- Run **zero-config on any layout** (detected source dir + region set; the loop and fence share
  it), with a `doctor` preflight and per-repo value calibration so the metric is meaningful.

## Non-goals for v0

- Multi-language support (TypeScript/JavaScript only; the metric framework is general, the
  tooling is not).
- A swarm of parallel agents (single-agent loop first; parallelism is a later additive step).
- Inventing tests for untested behavior beyond characterization (it pins _current_ behavior,
  it does not specify _intended_ behavior).
- A hosted service, dashboard, or PR automation.
- Optimizing anything the immutable scorer cannot measure cheaply and deterministically.
- Replacing human review of the final branch before merge.

## Package

- repo: `codenuke`
- npm: `codenuke`
- CLI: `codenuke` (`bin/codenuke.mjs`)
- runtime: Node `>= 22`, `git`
- language: JavaScript (ESM `.mjs` engine; runs directly, no build step)
- proposer: the `claude` CLI by default; any command via `CN_PROPOSER`
- example target: temporary fixture repositories used by `pnpm eval` and `pnpm pack:smoke`

## TypeScript / tooling requirements

The **engine** (`loop/`, `bin/`) is plain ESM `.mjs` run directly with Node — no build, one
runtime dependency (`typescript`, for AST work). The **target repo** the loop operates on
must provide:

- a test command (auto-detected: `vitest` / `jest` / `npm test`, or `CN_TEST`)
- optionally a typecheck command (auto-detected: `tsc --noEmit` if `tsconfig.json` exists,
  or `CN_TYPECHECK`) — the type gate (G3) is skipped if absent
- a git repo with a **green baseline** (tests pass at `baseline`, default `HEAD`)

This repo's own tooling: `oxlint` (`oxlint.json`), `oxfmt` (`.oxfmtrc.json`), `vitest`. CI:
`lint → format:check → typecheck → test → build`. Engine scripts are exempt from a handful
of pedantic style rules (see `oxlint.json` overrides).

## CLI contract

```
codenuke <command> [args]      # run from your repo root (or set CN_REPO)
```

- **Configuration is by file/env, not flags.** Resolution order: `CN_*` env > `codenuke.loop.json`
  at the repo root > auto-detection. The only command flag is `score --json`.
- **stdout**: human-readable progress and verdicts; `score --json` additionally emits one
  machine-readable line prefixed `@@JSON@@`.
- **stderr**: subprocess (test/typecheck/proposer) noise is captured, not streamed to the
  user's context.
- **exit codes**: `0` ok; `1` error (e.g. baseline red, bad arguments); `2` not ready
  (`doctor` found unmet prerequisites).
- **preflight**: a manual command (`score`/`accept`/`status`/`revert`) run before `init` fails
  fast with "run `codenuke init` first" — never a stack trace.
- **isolation**: every command that runs the suite or edits code does so in an isolated git
  worktree under `/tmp`; the user's working tree is never modified.
- **autonomy**: `run` does not pause to ask the human; it loops until it finishes its
  iteration budget or is interrupted.

## Commands

### `fence`

```
codenuke fence [cap=60] [seed=1337] [regions]
```

- Measures per-region **behavior-fence fidelity**: injects AST-aware behavior mutations into
  each source region, runs the test suite per mutant, and records the fraction caught with a
  Wilson 95% CI. Deterministic (seeded sampling).
- Writes the pinned artifact `.codenuke/fence-fidelity.json`. **Run this before `run`** — the
  loop gates on it.
- A region is **admissible** iff its CI lower bound ≥ `fenceLB` (default `0.90`).
- Output: per-region `caught/total = p%  CI95 [lo, hi]  ADMISSIBLE|BLOCKED`.
- Safety: runs at `baseline` in a throwaway worktree; a mutant that hangs is killed (45s) and
  counted as caught.

### `run`

```
codenuke run [iterations=5]
```

- The autonomous loop over the **in-scope regions** (all detected regions, or those matching
  the `target` filter). Each iteration selects a region and a **move**, proposes, scores, keeps
  or reverts, logs:
  - **raise** — a blocked in-scope region (preferring the one nearest the threshold): the
    proposer adds characterization tests; the fence is re-measured by monotonic replay; tests
    are kept iff they raised the fence.
  - **reduce** — an admissible region with reduction headroom: the proposer reduces its code;
    kept iff `loss < 0`.
- The loop raises blocked regions to admissible, then reduces across admissible ones, until the
  iteration budget is spent, the user interrupts, or no in-scope region can be raised or further
  reduced. It is **not** tied to a single region — the loop and the fence share the detected
  region set (see Source & region detection).
- Requires a fence artifact (run `fence` first), calibration (run `calibrate`), and a green
  baseline; aborts with a pointer to `doctor` otherwise.
- Runs above the default iteration budget (`> 5`) also require a passing
  `.codenuke/value-proxy-validation.json` from `validate-proxy`; this keeps long unattended
  runs behind the `changecost`/Spearman empirical bridge.
- No human in the loop. Kept changes are commits on `autoresearch/<tag>`; every iteration
  appends a row to `.codenuke/results.tsv`.
- Output: per-iteration `[mode] region fence …` then `[KEEP|REVERT|RAISE|…] description`.

### `score`

```
codenuke score [--json]
```

- Scores the current worktree change against the branch baseline and prints the verdict —
  gates, value, and the keep/reject decision. `--json` emits a `@@JSON@@`-prefixed
  `ScoreVerdict` line.

### `changecost`

```
codenuke changecost [ref=baseline]
```

- The value **ground truth** (advanced, periodic). Implements each change-request in the
  benchmark (`codenuke.benchmark/`) on `ref` and reports `𝒱̂` = mean realized cost
  (`edit + β·verify`). Use to validate that the inner-loop value proxy tracks real
  change-cost; compare `𝒱̂` before/after a refactor.

### `validate-proxy`

```
codenuke validate-proxy [path=.codenuke/value-proxy.json]
```

- Validates the calibrated inner-loop proxy against measured `changecost` results before long
  unattended runs. Input rows are `{id, proxy, Vhat}` candidates, where higher `proxy` should
  rank with lower measured `Vhat`.
- Computes Spearman rho over `proxy` and `-Vhat`, writes
  `.codenuke/value-proxy-validation.json`, and exits `0` only when the corpus is large enough
  and rho clears `CN_MIN_RHO` (default `0.6`).
- This is the empirical bridge from "calibrated proxy" to "trust it on this repo"; it fails
  closed for invalid validation config, too-small corpora, malformed rows, undefined
  correlation, or low rho.

### `calibrate`

```
codenuke calibrate
```

- Derives the **per-repo value scales**: samples recent commits touching `srcDir`, measures the
  distribution of `|ΔAST|` and `|Δcomplexity|` per commit, and writes the robust scale (σ) for
  each to `.codenuke/calibration.json`. The scorer reads it so the keep-threshold `loss < 0` is
  meaningful **on this repo** (falls back to built-in defaults if absent). Run once per repo,
  and after large changes. See "The metric".

### `doctor`

```
codenuke doctor
```

- Preflight readiness check — prints what was detected and whether the repo is ready: green
  baseline? `srcDir` + non-empty `regions`? a terminating test command (and typecheck)? a fence
  artifact (and its staleness)? calibration present? a proposer available (`claude` CLI or
  `CN_PROPOSER`)? Exit `0` if ready, `2` with the specific gaps if not. **Run this first on a
  new repo.**

### `init` · `accept` · `revert` · `status` · `cleanup`

```
codenuke init       # create the worktree @ baseline, verify it is green, record start state
codenuke accept     # commit the current worktree change (advance the branch)
codenuke revert     # discard the current worktree change (git reset --hard)
codenuke status     # cumulative reduction since the run started
codenuke cleanup    # remove the worktree + loop state
```

Manual escape hatches for driving the scorer by hand. `init → score → accept|revert` is the
loop unrolled.

## Config

- **Discovery**: `CN_*` environment variables, then `codenuke.loop.json` at the repo root,
  then auto-detection.
- **Precedence**: env > file > auto-detected default.
- **Initial config** (all keys optional; shown with defaults):

```json
{
  "repo": ".",
  "srcDir": "src",
  "target": "src/",
  "baseline": "HEAD",
  "tag": "run",
  "regions": ["<auto-detected: subdirs of srcDir with source, or srcDir itself if flat>"],
  "testCommand": "<auto: vitest run | jest | npm test>",
  "typeCheckCommand": "<auto: tsc -p tsconfig.json --noEmit | null>",
  "fenceArtifact": ".codenuke/fence-fidelity.json",
  "results": ".codenuke/results.tsv",
  "benchmarkDir": "codenuke.benchmark",
  "fenceLB": 0.9,
  "proposerBudgetUsd": "1.50"
}
```

- **Environment variables**: `CN_REPO`, `CN_SRC`, `CN_TARGET`, `CN_BASE`, `CN_TAG`,
  `CN_REGIONS`, `CN_TEST`, `CN_TYPECHECK`, `CN_FENCE`, `CN_FENCE_LB`, `CN_RESULTS`,
  `CN_BENCH`, `CN_BETA`, `CN_MIN_RHO`, `CN_MIN_CANDIDATES`, `CN_BUDGET`, `CN_PROPOSER`,
  `CN_WORKTREE`, `CN_STATE`.
- **Secrets**: none read by the engine. The proposer (`claude` CLI) uses its own auth; the
  engine never handles credentials.

### Source & region detection

The fence and the loop share **one** detected region set (this is what makes the loop work
zero-config, not a no-op).

- **`srcDir`**: `tsconfig.json` (`rootDir` / `include`) → `package.json` hints → the first of
  `src` / `lib` / `app` / `source` that contains source → the repo root (`.`). Override `CN_SRC`.
- **`regions`**: the immediate subdirectories of `srcDir` that contain source. If `srcDir` has
  no such subdirectories (a flat layout), **`srcDir` itself is the single region**. The set is
  **never empty when source exists**. Override/filter with `CN_REGIONS`.
- **`target`**: an optional **filter** over the detected regions (default: all). It is not a
  separate region and is never used to synthesize a region key — the loop iterates the detected
  set and the fence keys the same set, so `fence` then `run` always line up.

## State layout

```
your-repo/
  .codenuke/                  # generated, git-ignored
    fence-fidelity.json       #   the pinned per-region fence (scorer reads this)
    calibration.json          #   per-repo value scales (codenuke calibrate)
    results.tsv               #   the loop trajectory log
    changecost.json           #   last change-cost run
    value-proxy-validation.json # proxy-vs-changecost Spearman report
  codenuke.benchmark/         # committed (the held-out change-cost val-set)
    <id>/meta.json
    <id>/accept.test.ts
  codenuke.loop.json          # optional config

/tmp/codenuke-<tag>-<region>            # the isolated worktree (ephemeral)
/tmp/codenuke-<tag>-<region>.state.json # loop state, OUTSIDE the worktree
```

`.codenuke/` is git-ignored (generated, repo-specific). `codenuke.benchmark/` is committed —
it is a curated, version-controlled asset, the way a validation set is.

## Artifacts & schemas

```ts
// score --json  (one @@JSON@@-prefixed line)
type ScoreVerdict = {
  admissible: boolean;
  keep: boolean;
  loss: number | null;
  gain: number;
  risk: number;
  dL: number;
  dCx: number;
  dDup: number; // reductions; positive = smaller
  mfence: number; // worst touched-region fence score
  touched: string[];
  blocked: string[]; // regions
  gates: { G1: boolean; G1prime: boolean; G3: boolean; G4: boolean };
  files: string[];
};

// .codenuke/fence-fidelity.json
type FenceArtifact = {
  baseline: string;
  baselineSha?: string; // pinned commit used to detect stale fence artifacts
  generatedAt: string;
  method: "ast-aware";
  threshold: number;
  capPerRegion: number;
  seed: number;
  regions: Record<
    string,
    {
      caught: number;
      total: number;
      p: number;
      lo: number;
      hi: number; // Wilson 95% CI
      admissible: boolean; // lo >= threshold
      survivorSpecs: { rel: string; start: number; end: number; repl: string; op: string }[];
    }
  >;
};

// .codenuke/results.tsv  (tab-separated; one row per iteration)
//   iter  commit  dAST  dCx  behavior  mfence  loss  status  description
// status ∈ keep | revert | raise | raise-nogain | raise-skip | raise-badtest | raise-error | crash | noop

// codenuke.benchmark/<id>/meta.json  (+ accept.test.ts beside it)
type BenchmarkDelta = {
  id: string;
  title: string;
  prompt: string;
  region: string;
  acceptPath: string;
};

// .codenuke/calibration.json  (codenuke calibrate)
type Calibration = {
  baseline: string;
  baselineSha?: string; // pinned commit used to detect stale calibration artifacts
  generatedAt: string;
  commitsSampled: number;
  scales: { sL: number; sCx: number; sDup: number }; // per-repo σ of |Δ| per commit
};

// .codenuke/value-proxy-validation.json  (codenuke validate-proxy)
type ValueProxyValidation = {
  passed: boolean;
  reason: string | null;
  candidates: number;
  minimumCandidates: number;
  minimumRho: number;
  rho: number | null; // Spearman(proxy, -Vhat)
  rows: { id: string; proxy: number; Vhat: number }[];
};
```

## The objective

The goal is **not minimal code** — it is **lower future-change cost** (cheaper, safer, clearer
future edits). Less code is a means, and only sometimes: the maximally-compressed program is
the most fragile, so size-minimization overshoots. Formally the objective is the **conditional
description length of the next version given this one** — a codebase is good to the extent it
makes its own likely future changes cheap to express. The inner loop optimizes a cheap, gated,
deterministic proxy of this; `changecost` measures it directly.

## The metric: gates ≻ value

Lexicographic — hard gates dominate value. A change `C → C'` is **admissible** iff:

- **G1 — behavior.** The test suite is green, and was green at the baseline.
- **G1′ — fence fidelity.** Every touched region is admissible (CI lower bound ≥ `fenceLB`).
  Unmeasured regions and a missing artifact fail closed.
- **G3 — types.** No new type errors (skipped if the repo has no typecheck command).
- **G4 — size.** Net source AST nodes strictly decrease (counted on the AST → reformatting
  and renames are `Δ = 0`).

For admissible changes (reductions are positive; each component is **scale-normalized** by the
repo's own scale `s` from `codenuke calibrate` (`.codenuke/calibration.json`), falling back to
built-in defaults; weights `w` are relative importances, not statistical z-scores):

```
value = wL·(ΔAST/sL) + wC·(Δcomplexity/sC) (+ wD·(Δdup/sD), weak)     keep iff loss < 0
risk  = ε·diffsize + (1 − mfence_region)
loss  = risk − value     (and +∞ for any inadmissible change)
```

Per-repo scales make the keep-threshold `loss < 0` meaningful on the target repo; **before
calibration the keep _magnitude_ is heuristic (the gates stay exact, so safety is unaffected)**.
The proxy should be validated against `changecost` (Spearman ρ ≥ 0.6) before long unattended runs.

A behavior break or type regression is `loss = +∞` regardless of how much code it removes.
That lexicographic structure is the self-policing property: the score cannot be improved by
degrading behavior, because behavior is a constraint, not a weighted term.

## Invariants

Hold for **every** command. A violation is a conformance failure regardless of any other result.

- **INV-1 — isolation.** The user's working tree and current branch are never modified. After
  any command, `git -C <repo> status --porcelain` over tracked, non-`.codenuke/` paths is empty
  and `HEAD`/branch is unchanged.
- **INV-2 — worktree confinement.** All builds, tests, mutations, and edits happen in a `/tmp`
  worktree; loop state lives outside the worktree.
- **INV-3 — scorer immutability.** The proposer's toolset has no shell or git and no read access
  to the scorer or the change-cost benchmark; improving the score is impossible without changing
  source.
- **INV-4 — green precondition.** Nothing is scored unless the baseline suite was green; a
  command that would otherwise score on a red baseline aborts (exit `1`).
- **INV-5 — determinism.** Given the same inputs and seed, `fence`, `score`, and `calibrate`
  produce identical numeric output; the inner loop adds no nondeterminism beyond unquarantined
  test flakiness. `changecost`'s `edit` term depends on the implementer: it is **deterministic
  with a fixed/scripted implementer** (`CN_IMPLEMENTER`), and with the LLM implementer is reduced
  to bounded variance by paired, same-seed before/after comparison. Conformance tests for the
  loop and change-cost therefore run a **scripted proposer/implementer**; the LLM adapter gets a
  single integration smoke per slice.
- **INV-6 — fail-closed.** An unmeasured region, a missing fence artifact, or any missing
  prerequisite never yields "admissible" — it yields BLOCKED or abort-with-guidance.

## The loop

On `autoresearch/<tag>`, in an isolated worktree, for each iteration:

1. Read the fence artifact. Choose the next in-scope region and its move: a blocked region
   (preferring the one nearest the threshold) → `raise`; otherwise an admissible region with
   reduction headroom → `reduce`.
2. Run the proposer for that region (it edits only the worktree source).
3. Score the change (run the scorer as a subprocess).
4. Keep (commit, advance the branch) iff the verdict says keep; else revert (`git reset`).
5. Append a row to `results.tsv`.
6. Repeat until the iteration budget is exhausted or interrupted.

The proposer is structurally separated from the scorer: it has no shell/git in its toolset, so
it cannot run, read, or rewrite the judge. Improving the score requires improving the code.

**Step contract.**

- **Pre:** a fence artifact exists; the branch-tip suite is green; the in-scope region set is
  non-empty.
- **propose → Post:** the worktree diff touches only `srcDir` files; in `raise` mode, only test
  files.
- **score → Post:** a `ScoreVerdict` is produced; `keep ⟺ admissible ∧ loss < 0`.
- **keep → Post:** exactly one new commit on `autoresearch/<tag>` containing the change, the
  suite is green at the new tip, and `dL > 0`. **revert → Post:** the worktree equals the branch
  tip (clean).
- **Invariant (per kept iteration):** the suite is green at the tip — no kept commit ever breaks
  behavior — and cumulative `ΔAST` is non-decreasing.
- **Termination:** the loop halts after the iteration budget, on interrupt, or when no in-scope
  region can be raised or further reduced.

## The behavior fence

Tests are an _approximate_ behavior oracle; mutation testing measures how approximate.
`fence` injects AST-aware mutations (real operators — `<`/`>`, `===`/`!==`, `&&`/`||`,
`startsWith`/`endsWith`, boolean `return` — never characters inside string literals), runs the
suite per mutant, and computes the per-region catch rate with a Wilson 95% CI. It is a
**periodic calibration**, not part of the inner loop. Runs are seeded and reproducible.

**Fence-raising.** When a region is too weakly fenced to refactor, the loop's `raise` move
earns admissibility: the proposer writes characterization tests pinning current behavior; the
fence is re-measured by **monotonic replay** (re-run only the prior survivors — adding tests
can only kill survivors, never resurrect a caught mutant); once the CI lower bound clears
`fenceLB`, the loop switches to `reduce`.

**Step contract.**

- **audit — Pre:** baseline green. **Post:** every region has `{caught, total, p, lo, hi,
admissible}` with `admissible ⟺ lo ≥ fenceLB`, plus a `survivorSpecs` entry per surviving
  mutant; mutation sites are real AST operator tokens only.
- **replay — Pre:** the worktree source is identical to baseline (only tests added). **Post:**
  `caught` is non-decreasing, `survivorSpecs_after ⊆ survivorSpecs_before`, `total` unchanged
  (a monotone re-audit — adding tests can only kill survivors).

## The change-cost ground truth

The inner-loop value (AST + complexity) is a proxy for future-change cost. `changecost`
measures the real thing against a fixed, held-out benchmark of change-requests:

```
cost(δ, C) = edit(δ, C) + β·verify(δ, C)
  edit   = token-diff of a correct (acceptance-test-gated) implementation of δ on C
           (formatting-invariant; captures "cheaper" + "clearer")
  verify = 1 − fence fidelity of the regions δ touched ("safer" = cheaper to verify)
  β      = token-equivalent weight on verification effort (default 60; CN_BETA)
𝒱̂(C)   = mean over the benchmark
```

`cheaper`, `safer`, `clearer` are components of one measured quantity (the effort of the next
change), so the objective is a single comparable number. The realized edit size is a computable
upper bound on the conditional description length of the change (as cross-entropy upper-bounds
entropy) — the honest analog of `val_bpb`. The benchmark is run by the scorer and **hidden
from the proposer**, so the loop cannot overfit it.

**Step contract.**

- **Pre:** baseline green; benchmark non-empty.
- **per δ:** prompt with the change request, withholding the accept-test body → implement →
  install the hidden accept test → **gate** (the δ's accept test **and** the full suite green) →
  measure `edit + β·verify` → revert. **Post:** the worktree is clean after each δ (each δ is
  measured independently from the same `C`).
- **Invariant:** correctness is decided only by the hidden accept test; `edit ≥ 0`,
  `verify ∈ [0, 1]`; the same Δ is used across candidates so `𝒱̂` is comparable.

## The proposer

`program.md` is the human-authored proposer skill (objective, hard constraints, keep rule, the
two moves, "never ask"). The proposer is invoked per iteration with the relevant prompt
(`reduce` or `raise`).

- **Default adapter**: `claude -p --permission-mode bypassPermissions --no-session-persistence
--allowedTools "Edit Write Read Grep Glob" --max-budget-usd <budget>`. No shell/git ⇒ cannot
  touch the scorer. Budget-capped per iteration.
- **Override**: `CN_PROPOSER="<shell command run in the worktree>"` (for deterministic tests or
  a different agent).
- **Failure handling**: a proposer error or timeout is logged (`crash`) and reverted; a raise
  that touches non-test source, or whose tests fail on current code, is rejected
  (`raise-badtest`). Failures are non-fatal — the loop continues.

## Git safety

The user's working tree is never touched. Foundational rule: all work happens in an isolated
worktree at `baseline`.

1. `fence`, `changecost`, `run`/`init` each create their own throwaway worktree under `/tmp`.
2. The trajectory lives on a dedicated `autoresearch/<tag>` branch, never on the user's branch.
3. A reject is a `git reset --hard` + `git clean` scoped to `srcDir` in the worktree.
4. Loop state lives **outside** the worktree, so it is never committed or reset by git ops.
5. `accept` stages only the scorer-observed source files, so generated state never enters the
   trajectory even when `srcDir` is the repo root (`.`).
6. The baseline must be green; the loop aborts if it is not.

## Test command selection

Detected, in order: a local `vitest` → `jest` → `mocha` → `ava` binary → `bun test` (if `bun`
is present) → `<pm> test` (package manager from the lockfile). Override with `CN_TEST`. A
single-run (non-watch) invocation is preferred; a command that does not terminate is caught by
the wall-clock timeout and surfaced by `doctor` as "not ready". The typecheck command is
`tsc -p tsconfig.json --noEmit` if a `tsconfig.json` and a local `tsc` exist, else the type
gate is skipped. Both commands run inside the worktree with a wall-clock timeout; the result
(pass/fail/timeout) is the gate signal.

## Output examples

```
# codenuke fence
fence audit (AST-aware) @ HEAD  cap=60/region  seed=1337  regions=cli,mappers,…
== cli: 56/60 = 93%  CI95 [84.1, 97.4]  ADMISSIBLE ✓
== mappers: 56/90 = 62%  CI95 [51.9, 71.5]  BLOCKED ✗

# codenuke run 3
--- iter 1/3 [raise] cli fence 47% lo=47% ---
  → RAISE  cli fence 47%→93% lo=84%
--- iter 2/3 [raise] cli fence 93% lo=84% ---
  → RAISE  cli fence 84%→98% lo=91% ADMISSIBLE✓
--- iter 3/3 [reduce] cli fence 98% lo=91% ---
  → REVERT  ΔAST=32 cli/main.ts | G3

# codenuke changecost
--- δ supported-ext: Add isSupportedExtension helper ---
  edit=21 tokens (1 files: mappers)  verify=0.38  cost=43.7
=== 𝒱̂(HEAD) = 43.7 over 1/1 changes ===
```

## Acceptance criteria

Every criterion is an automated test with a definite pass/fail. The spec is **not implemented**
unless all pass (see Conformance). `z = 1.96` throughout.

**Size measure `L` (AST).**

- **AC-L1 — invariance:** `L(C) = L(format(C)) = L(rename_local(C))` — whitespace, comments, and
  local renames give `ΔL = 0`.
- **AC-L2 — additivity:** for file sets with disjoint paths, `L(A ∪ B) = L(A) + L(B)`.
- **AC-L3 — strictness:** deleting any statement strictly decreases `L`.

**Behavior-fence CI (Wilson).**

- **AC-W1 — formula:** `wilson(56,60) → lo ∈ [0.840, 0.842], hi ∈ [0.973, 0.975]`;
  `wilson(0,0) = {p:0, lo:0, hi:1}`.
- **AC-W2 — bounds & monotonicity:** `0 ≤ lo ≤ p ≤ hi ≤ 1`; `lo` is non-decreasing in `k` at
  fixed `n`.
- **AC-W3 — reachability:** `lo(n,n) = n/(n+z²)`, hence `wilson(34,34).lo < 0.90 ≤ wilson(35,35).lo`
  (≥ 35 all-caught mutants are required to admit a region at `fenceLB = 0.90`).

**Edit size (formatting-invariant token diff).**

- **AC-E1 — zero on no-op:** `editCost(C, format(C)).tokens = 0`.
- **AC-E2 — correctness:** `lcsEditSize(a,b) =` insertions + deletions; `lcsEditSize(a,a) = 0`;
  symmetric.
- **AC-E3 — amplification (positive control):** a concept duplicated `k` times vs deduplicated,
  changed identically, costs `edit_taxed ≥ 2.5 · edit_clean` (≈ k×).

**Value / loss (the keep rule).**

- **AC-V1 — monotonicity:** value strictly increases in each reduction component (more `ΔAST` ⇒
  more value, all else equal).
- **AC-V2 — keep rule:** `keep ⟺ admissible ∧ loss < 0`; `admissible ⟺ G1 ∧ G1′ ∧ G3 ∧ G4`.
- **AC-V3 — self-policing:** a behavior break ⇒ `G1 = false ⇒ loss = +∞ ⇒ ¬keep` for any `ΔAST`;
  a reformat ⇒ `ΔAST = 0 ⇒ value = 0 ⇒ ¬keep`.

**Fence admissibility & replay.**

- **AC-F1 — admissibility:** a region is admissible `⟺ lo ≥ fenceLB`; unmeasured ⇒ not admissible.
- **AC-F2 — AST-aware:** an operator character inside a string literal or comment is **not** a
  mutation site; every site is a real AST operator token.
- **AC-F3 — monotone replay:** adding tests never lowers a region's `caught` or `lo`
  (`caught_after ≥ caught_before`).

**Change-cost `𝒱̂`.**

- **AC-C1 — discrimination (positive control):** `𝒱̂(deduplicated) < 𝒱̂(duplicated)` for the same
  change δ on the two variants.
- **AC-C2 — form:** `cost = edit + β·verify`, `edit ≥ 0`, `verify ∈ [0,1]`; comparable on a fixed Δ.

**Calibration.**

- **AC-K1 — derived & positive:** `scales.{sL,sCx,sDup} > 0`, from `commitsSampled ≥` a minimum
  (else built-in defaults).
- **AC-K2 — determinism:** the same baseline yields identical scales.

**Detection (the no-op regression).**

- **AC-D1 — non-empty:** on each layout fixture (`src`+subdirs, flat `src`, `lib`, repo root),
  `regions` is non-empty when source exists.
- **AC-D2 — alignment:** the region keys written by `fence` equal the region set `run` iterates,
  and `run` performs a non-`raise-skip` action on every fixture (never a no-op).

**Isolation & immutability.**

- **AC-I1 — tree untouched:** after every command, INV-1 holds (checked from both a clean and a
  dirty repo).
- **AC-I2 — proposer sandbox:** the proposer is launched with no shell/git tool and cannot read
  the benchmark; a proposer edit outside `srcDir` (in `raise`, outside tests) is rejected.

## Testing requirements

- Unit tests for the engine: edit-size (formatting invariance + amplification positive
  control), Wilson CI, config resolution, calibration scale derivation, the score verdict
  logic, fence replay monotonicity.
- **Detection fixtures** — assert `srcDir` + a non-empty `regions` set are resolved on each
  layout (subdir `src`, flat `src`, `lib`, root) and that `fence` keys and `run`'s region set
  match (the no-op regression: `run` must act, not `raise-skip`).
- A worked example target: deterministic temporary fixture repositories exercised through
  `pnpm eval` and `pnpm pack:smoke`; no legacy implementation tree is required in the repo.
- Determinism tests: seeded fence sampling is reproducible run-to-run.

## Initial repo skeleton

```
codenuke/
  README.md
  docs/spec.md
  package.json            # bin: { "codenuke": "bin/codenuke.mjs" }
  bin/codenuke.mjs        # CLI dispatcher
  loop/
    config.mjs            # repo-agnostic config + auto-detection
    scorer.mjs            # the immutable judge (init/score/accept/revert/status/cleanup)
    fence.mjs             # per-region fence audit + monotonic replay
    changecost.mjs        # value ground truth (lib + benchmark runner)
    calibrate.mjs         # derive per-repo value scales
    doctor.mjs            # preflight readiness check
    autoloop.mjs          # the loop driver (iterate regions: raise → reduce)
    measure.mjs           # AST size / complexity / duplication
    stats.mjs             # Wilson interval, etc.
    program.md            # the proposer skill
    *.test.mjs            # engine unit tests
  evals/                  # deterministic loop CLI eval
```

## Release criteria for v0.1 (production-ready on a new repo)

When all of these hold, implementing this spec yields a tool another developer can run on
their own repo. Each line is a conformance check.

- `npm i -g codenuke` exposes a working `codenuke` on Node ≥ 22, with `typescript` declared as
  a **runtime dependency** (the engine imports it).
- `codenuke doctor` reports readiness — or the precise gaps — on a fresh repo, zero config.
- **Detection works across layouts**: `src` with subdirs, a flat `src`, `lib`/`app`/`source`,
  and code at the repo root. `regions` is never empty when source exists.
- `codenuke fence` runs zero-config and writes an artifact keyed by the detected regions.
- `codenuke run` is **not a no-op** on a fresh repo: it iterates the detected region set —
  raising blocked regions to admissible, then keeping ≥ 1 genuine reduction — leaving a green
  `autoresearch/<tag>` branch and a `results.tsv`. (No single-`target` region; `fence` and `run`
  share the detected set.)
- `codenuke calibrate` derives per-repo value scales; the keep-threshold is repo-meaningful.
- The scorer is immutable from the proposer (no shell/git in its toolset); the change-cost
  benchmark is hidden from the proposer.
- Worktree isolation verified: the user's tree is never modified; a manual command before
  `init` fails fast with guidance (no stack trace).
- The value proxy is validated against `changecost` on ≥ 1 real repo (ρ ≥ 0.6) before
  unattended runs are recommended.
- CI green: lint / format / typecheck / test / build. README quickstart + this spec.

## Conformance

The spec is **implemented** if and only if **all** of the following hold simultaneously. There
is no partial credit — a single failure means the spec is not implemented and the tool is not
production-ready, regardless of how many other checks pass.

1. Every **Invariant** (INV-1 … INV-6) holds for every command.
2. Every **step contract** (the loop, the behavior fence, the change-cost) holds — each
   Pre / Post / Invariant is asserted by an integration test.
3. Every **Acceptance criterion** (AC-L\*, AC-W\*, AC-E\*, AC-V\*, AC-F\*, AC-C\*, AC-K\*, AC-D\*,
   AC-I\*) passes.
4. Every **Release criterion** is green.

Each item is a test under Testing requirements, and CI runs the whole set. "Implemented" is
therefore a single boolean: the conjunction of the four lists above. The `doctor` command
reports the subset checkable on a given repo (readiness); CI proves the rest.

- Should the inner-loop value be replaced by `𝒱̂` once it is validated to track change-cost
  out-of-sample (Spearman ρ ≥ 0.6 on ≥ 2 repos), or kept as a validated proxy with `changecost`
  as the periodic audit?
- Equivalent mutants cap a region's achievable fence below 1.0; how should they be excluded
  from the denominator — reviewed, never by the optimizer (Goodhart)?
- Calibration is global (one scale per repo); should it be per-region, and re-derived as the
  branch advances?
- Monorepos (`packages/*/src`) are detected only at the top level; full per-package region
  scoping is a later step.
