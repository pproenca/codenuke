# codenuke-reimagined — Project Knowledge Graph

> Load this first. It is the persistent context for the **Effect-TS reimagining**
> of `codenuke`. It tells you what the system is, how it's shaped, where the spec
> lives, how to run things, and how every legacy behavior maps to this code.
>
> **Status: 0.5 — feature-complete for P0 (C1–C11).** The full reduce pipeline
> (`fence → calibrate → changecost → validate-proxy → doctor → run`), the manual
> lifecycle, the C12 results journal, and the **real `@openai/codex-sdk`** agent
> (proposer + changecost implementer) are implemented and verified end-to-end on
> real git repos. Remaining work is the post-0.5 roadmap in [`CHANGELOG.md`](./CHANGELOG.md)
> (raise-fence loop, thread continuity, budget, differential harness).

## What this is

codenuke is an **autonomous, behavior-preserving code-reduction CLI**. An LLM
*proposer* makes one focused reduction inside an isolated git worktree; an
*immutable scorer* keeps it only if hard safety gates pass (tests green,
behavior-fence admissible, no new type errors, strictly smaller AST) **and**
`loss = risk − gain < 0`. Behavior fidelity is measured by AST-aware mutation
testing with Wilson confidence intervals. Periodic artifacts (fence, calibration,
value-proxy, change-cost) fail closed to gate long unattended runs. **No database**
— all state is JSON/fs artifacts.

This is a **reimagining**, not a port: the legacy repo was the spec source. The
target stack is [Effect](https://github.com/effect-ts/effect) (typed errors +
`Layer` DI + `Schema` + `Stream`), `@effect/cli`, `@effect/platform(-node)`.

## Where the spec lives (read these to implement a rule)

All under [`docs/`](./docs) (vendored from the analysis workspace at cutover):
- **`AI_NATIVE_SPEC.md`** — capabilities (C1–C12), domain model + erDiagram,
  interface contracts, NFRs, and the **Behavior Contract** index. §6 records the
  locked scope decisions.
- **`REIMAGINED_ARCHITECTURE.md`** — the architecture this code implements
  (critic-reviewed). §4 maps rules→modules; §7 the fence concurrency model; §11 the
  incorporated critique.
- **`spec/BEHAVIOR_CONTRACT.md`** — the 61 rules, each `GIVEN/WHEN/THEN/SOURCE/
  ACCEPTANCE`. **The `ACCEPTANCE:` line is the acceptance test.**
- **`spec/INTERFACE_CONTRACTS.md`** — CLI commands/flags, `CN_*` env, `codenuke.loop.json`,
  artifact schemas, proposer SDK shapes, the progress stream.
- **`spec/DOMAIN_MODEL.md`** — entity shapes, invariants, aggregates.

## Architecture in one breath

**Pure functional kernel, effectful shell.** Decision logic (scoring, gates,
Wilson, Spearman, value math) is pure `(in)⇒out` — no `Effect`. Everything
side-effectful is an Effect **service** (`Context.Tag` + `Layer`). Errors are
values (`Data.TaggedError`); the CLI maps error tags → POSIX exit codes. Every
boundary (CLI/env/config/artifacts/SDK) is decoded by `effect/Schema`. Progress is
one typed `Stream`/`Queue` of `ProgressEvent`s rendered as TTY *xor* NDJSON.

## Packages (3 build units; 14 bounded contexts as directory modules)

| Package | Modules | Responsibility | Capabilities |
|---|---|---|---|
| **`@codenuke/core`** | `domain` (Schema shapes + 17 tagged errors), `kernel` (pure value math + Wilson + ranks/Spearman + fence-gap helper), `scoring` (`decide`/gates), `measure` (TS-compiler AST), `artifacts` (Schema decode + recompute-and-compare anti-tamper + fail-closed status) | The pure kernel + the fail-closed gate. Everything depends on it. | C1, C2, C5 |
| **`@codenuke/fence`** | `operators`, `sampling` (mulberry32), `survivor`, `wilson` (admissibility), `path-guard`, `replay`, `audit` (Fence service) | AST-aware mutation audit, Wilson interval, survivor classification, monotonic replay. The dominant runtime cost. | C3 |
| **`@codenuke/runtime`** | `config`, `git`, `proposer` (port + Codex + Fake), `progress`, `orchestrator` (loop + startup gate + doctor), `periodic/{calibrate,value-proxy,changecost}` | The effectful shell: resolution, VCS, the code-SDK proposer, streaming, the loop, periodic artifacts. | C4, C6, C7, C8, C9, C10, C11 |
| **`apps/cli`** (`codenuke` bin) | `main` (@effect/cli tree, `runMain`), `exit-codes` (tag→POSIX) | Parses argv/env, POSIX exit codes, signal cleanup, picks the renderer. | — |

Dependency flow: `core` ← `fence` ← `runtime` ← `apps/cli`. Acyclic.

## How to run

```bash
pnpm install                      # node >= 22, pnpm 11; auto-installs Effect peers
pnpm test                         # vitest — the acceptance suites (the main signal)
pnpm --filter codenuke run build  # esbuild bundle → apps/cli/dist/cli.cjs (single file)
node apps/cli/dist/cli.cjs --help # the wired command tree
node apps/cli/dist/cli.cjs doctor # exits 0 ready / 2 not-ready (POSIX)
```

Notes:
- **Tests don't typecheck** (vitest transpiles); run `pnpm -r run typecheck` for the
  type signal. Some cross-package modules carry local fallback types from the
  parallel scaffold — replace those with the authoritative `@codenuke/core` imports
  as you implement.
- The CLI bundles via **esbuild's JS API** (`apps/cli/scripts/bundle-cli.mjs`), not
  the `esbuild` bin shim (unreliable under pnpm after esbuild's install.js swaps in
  the native binary).
- Implementing a rule: find it in `BEHAVIOR_CONTRACT.md`, flip its `it.skip`/`it.todo`
  to a real assertion against the `ACCEPTANCE:` line, implement the stub
  (`Effect.die("unimplemented: RULE-xxx")` marks the spot), keep it green.

## Acceptance-test status (226 tests)

179 passing · 39 skipped · 8 todo. Skipped/todo are effectful paths proven via the
CLI smokes (fence/loop/calibrate/validate-proxy/changecost/lifecycle on real git
repos) or that need codex creds. Every test name **starts with its `RULE-###` id**.
Run `grep -rhoE 'RULE-[0-9]+' packages/*/test apps/*/test | sort -u` to list covered rules.

## Legacy → modern traceability map

Capability → where → status (✅ implemented & verified · ◐ implemented, smoke/creds-verified · ⏳ roadmap).

| Cap | Where | Status |
|---|---|---|
| C1 Scoring & Value Model | `core/scoring`,`core/kernel` | ✅ 001,002,035,059,063 + fence-gap helper 002/013 |
| C2 Safety Gates | `core/scoring`, `runtime/loop` (gate), anti-tamper | ✅ 018–021,030,031,032,054,060,061; ✅ 022 (Wilson re-derive) |
| C3 Behavior Fence | `fence/*` | ✅ 006,007,008(+determinism),009,050; ⏳ 043/051 (effectful replay) |
| C5 Measurement | `core/measure` | ✅ 003,004,005 (+016,017) |
| C7 Config Resolution | `runtime/config` | ✅ 048,049; ◐ 033,034 |
| C6 Worktree & Proposer | `runtime/git`, `runtime/proposer` (real codex) | ✅ 045,047,052,061; ⏳ 057 (thread continuity),058 (budget) |
| C8 Security Guards | `core/env`, `fence/path-guard`, `runtime/git` | ✅ 050,052 + env allowlist + mkdtemp |
| C4 Loop Orchestration | `runtime/loop`, `runtime/orchestrator` | ✅ 030,031,038,039,041,044,062; ⏳ 040 (raise loop),042 |
| C9 Calibration | `runtime/periodic/calibrate(+run)` | ✅ 010 (real, from git history); ◐ 023 staleness |
| C10 Value-Proxy | `runtime/periodic/value-proxy(+run)` | ✅ 014,015,024,027,028,029,056 |
| C11 Change-Cost | `runtime/periodic/changecost(+run)` (real codex implementer) | ✅ 011,012,013,055; ◐ 024 anti-tamper |
| C12 Results Journal | `runtime/loop` | ✅ 041,062 (`.codenuke/results.tsv` + cumulative %) |

Retired by the legacy's own numbering: RULE-036, RULE-037 (not missing).

### The 5 legacy defects — FIXED here (do not reintroduce)

| Rule | Legacy defect | Fix locus in this code |
|---|---|---|
| RULE-054 | `changecost.json` never re-validated at startup (the fail-closed gap) | `core/artifacts` `validateAll` includes changecost; called by `orchestrator` startup gate (RULE-030) |
| RULE-063 | verdict label masks concurrent gate failures | `Verdict.failedGates: readonly GateName[]` lists ALL; surfaced on the `Scored` NDJSON event |
| RULE-053 | scorer reads engine state unvalidated (CWE-502) | one `Schema`-validated reader in `runtime/orchestrator/state`; SHA mismatch ⇒ `StateStale` ⇒ exit 1 |
| RULE-050 | two divergent path guards + raw-concat bypasses (CWE-22/59) | one `safeWorktreePath` in `fence/path-guard`; every read routes through it |
| RULE-002/013/054 | fence-gap aggregated min vs mean, re-implemented 3× | one `core/kernel` helper; min for scorer risk, mean for change cost — **intentional, documented** |

## Invariants you must not break

- **Determinism.** Seeds (`seed=1337`, fence `mulberry32`; value-proxy permutation
  seed `0x9e3779b9`) — these two PRNGs are **intentionally distinct, do not unify**
  (RULE-008 vs 015). The scorer is a pure function of inputs.
- **Fence concurrency = per region, one worktree per region**, mutants sequential
  in-place. **Never per-mutant worktrees** (disk/process storm + breaks determinism).
- **Immutable judge.** The scorer must not be editable by the proposer (pure kernel
  enforces this structurally — RULE-046).
- **Trusted-repo boundary.** All codenuke-owned subprocess calls use `Command.make`
  (argv, no shell). Subprocess env = allowlist. Temp via `mkdtemp 0700`.
- **Use `runMain`, never `process.exit`** — finalizers (worktree cleanup on SIGINT)
  depend on fiber interruption.
- **Constants** (preserve exactly): weights 1.0/1.8/0.35, scales 150/15/5,
  fenceLB 0.90, proposer timeout 900000ms + budget $8, `testTimeoutMs`/`fenceTimeoutMs`
  (new, replace hardcoded 300s/45s), β=60, exactCap 362880, samples 50000,
  minCandidates 6, minRho 0.6, alpha 0.05, cap 60, seed 1337.

## Migration from legacy

Legacy `.codenuke/*.json` artifacts are `schemaVersion:1` and validated by
recompute-and-compare (within `1e-9`), **not** version-gated — so a repo with
existing fence/calibration artifacts carries over **without recomputation**. The
`/tmp` engine state is ephemeral (hardened, regenerated). `codenuke.loop.json` must
accept every legacy key and reject the 4 legacy shell-string commands (RULE-048).

## Roadmap (post-0.5)

P0 (C1–C11) is implemented and verified. The remaining work (details + rationale
in [`CHANGELOG.md`](./CHANGELOG.md)):

1. **Raise-fence loop (RULE-040)** — proposer adds tests for inadmissible regions +
   monotonic replay; wire `chooseRegion`/`selectMode` (already pure) into the loop.
2. Proposer **thread continuity** (RULE-057) + **budget** (RULE-058); **typecheck G3**
   in the loop (currently `typeErrors=0`).
3. Value-proxy/changecost **anti-tamper** re-derivation (RULE-024); calibration staleness.
4. Fence **node_modules linking** (RULE-045) + a **bounded worktree pool**.
5. **Cutover**: promote to the `codenuke-next` repo, publish `codenuke@0.5.0`, archive
   the legacy repo; stand up the cross-repo **differential harness** (legacy vs new).
