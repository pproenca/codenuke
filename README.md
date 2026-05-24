# codenuke

**Autonomous, behavior-preserving code reduction.** An LLM *proposer* makes one
focused reduction in an isolated git worktree; an *immutable scorer* keeps it only
if the hard safety gates pass (tests green, behavior-fence admissible, no new type
errors, strictly smaller AST) **and** the value model says it's worth it
(`loss = risk − gain < 0`). Propose → score → keep/revert, repeat.

This is the **Effect-TS reimagining** of codenuke — a ground-up rebuild from the
legacy system's *extracted intent* (61 behavior rules), not a port. See
[`docs/`](./docs) for the spec and [`MIGRATION_PLAN.md`](./MIGRATION_PLAN.md) /
[`CLAUDE.md`](./CLAUDE.md) for the architecture and provenance.

## Quickstart

Requirements: Node ≥ 22, git, a trusted JS/TS repo with a test command, and (for
the proposer/changecost agents) `@openai/codex-sdk` + codex credentials.

```bash
codenuke fence            # measure per-region behavior-fence fidelity
codenuke calibrate        # derive per-repo value scales from git history
codenuke changecost       # held-out implementer benchmark → 𝒱̂ (ground truth)
codenuke validate-proxy   # Spearman proxy↔𝒱̂ correlation check
codenuke doctor           # readiness report (exit 0 ready / 2 not-ready)
codenuke run 5            # the propose→score→keep/revert autoloop
```

Kept reductions are published non-destructively on `refs/codenuke/result`
(`git merge refs/codenuke/result` to adopt); your branch and working tree are
never touched by the loop.

## Commands

| Command | Purpose |
|---|---|
| `fence [cap] [seed] [regions]` | AST-aware mutation audit → `.codenuke/fence-fidelity.json` |
| `run` / `loop [iterations]` | the reduce autoloop (startup gate → propose → score → keep/revert) |
| `score [--json]` | judge the pending change (managed worktree, or cwd) |
| `init`/`accept`/`revert`/`status`/`cleanup` | manual scorer lifecycle over a managed worktree |
| `calibrate` | per-repo value scales from git history |
| `changecost [ref]` | held-out implementer benchmark → 𝒱̂ |
| `validate-proxy [input]` | proxy↔𝒱̂ Spearman validation |
| `doctor [iterations]` | readiness / gap report |

## Configuration (`CN_*`)

`CN_SRC` (region/srcDir) · `CN_TEST_FILE` + `CN_TEST_ARGS_JSON` (test command,
argv only) · `CN_BENCH` (benchmark dir) · `CN_BETA` (cost weight) ·
`CN_PROPOSER_PROVIDER` (`codex` | `fake`) · `CN_CODEX_SANDBOX` /
`CN_CODEX_APPROVAL_POLICY` / `CN_MODEL` / `CN_REASONING_EFFORT` (codex).
Commands are **argv arrays, never shell strings** (the trusted-repo boundary).

## Safety model

- **Fail-closed:** missing/stale/invalid/**tampered** safety artifacts block the
  run (fence Wilson bounds are re-derived and compared — RULE-022).
- **Immutable judge:** the scorer is a pure function the proposer can't touch.
- **Determinism:** seeded mutation sampling; the fence audit at concurrency 1 vs N
  yields a byte-identical artifact.
- **Trusted-repo boundary:** all codenuke-owned subprocesses run argv-only
  (`shell:false`) with an env allowlist; the user's working tree is never edited.

## Architecture

Pure functional kernel (scoring, gates, Wilson, Spearman — no IO) + an effectful
shell of Effect `Layer` services (git, fs, subprocess, code-SDK). Errors are
typed (`Data.TaggedError`) and mapped to POSIX exit codes; progress is a typed
`Stream`. Three packages: `@codenuke/core`, `@codenuke/fence`, `@codenuke/runtime`,
behind one `codenuke` CLI. Full detail in [`CLAUDE.md`](./CLAUDE.md) and
[`docs/REIMAGINED_ARCHITECTURE.md`](./docs/REIMAGINED_ARCHITECTURE.md).

## Develop

```bash
pnpm install
pnpm test                       # acceptance suites (the behavior contract)
pnpm -r run typecheck
pnpm --filter codenuke run build  # → apps/cli/dist/cli.cjs
```

## Status & limitations

0.5 implements the full reduce pipeline + all periodic artifacts + manual
lifecycle + the real `@openai/codex-sdk` agent. See
[`CHANGELOG.md`](./CHANGELOG.md) for the roadmap (raise-fence loop, thread
continuity, budget enforcement, the differential harness).

MIT.
