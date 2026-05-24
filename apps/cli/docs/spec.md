# codenuke Specification

`codenuke` runs an autonomous refactoring loop over JavaScript and TypeScript repositories. A proposer edits an isolated git worktree, an immutable scorer evaluates the candidate, and the candidate is kept only when the hard safety gates pass and the value model says the change is worth keeping.

## Goals

- Reduce code while preserving behavior.
- Keep the judge separate from the candidate tree.
- Measure behavior-fence fidelity with mutation testing and Wilson confidence intervals.
- Fail closed when required safety artifacts are missing, stale, or invalid.
- Run zero-config where possible by detecting source roots, test commands, typecheck commands, and regions.
- Leave a reviewable trajectory through commits and `.codenuke/results.tsv`.

## Runtime Model

The loop runs from the target repository root:

1. Resolve config from environment, `codenuke.loop.json`, and auto-detection.
2. Create an isolated git worktree at the configured baseline.
3. Run the Codex SDK proposer in that worktree.
4. Enforce the allowed edit surface.
5. Run tests, optional typecheck, measurements, and fence checks.
6. Keep the candidate only when gates pass and `loss < 0`; otherwise revert.

The user's working tree is not modified by the loop.

## Packages

- `codenuke`: public CLI package in `apps/cli`. `apps/cli/scripts/bundle-cli.mjs` bundles the internal workspace packages into `dist/cli.cjs`.
- `@codenuke/orchestrator`: command dispatch and loop orchestration source package.
- `@codenuke/stats`: Wilson intervals and rank/stat helpers.
- `@codenuke/value-proxy`: Spearman and proxy validation.
- `@codenuke/json`: safe JSON reads.
- `@codenuke/guards`: shared finite-number guards.
- `@codenuke/measure`: AST size, complexity, and duplication measurements.
- `@codenuke/exec`: safe argv-vector subprocess helpers.
- `@codenuke/config`: config resolution, source classification, and runtime prompt data.
- `@codenuke/artifacts`: artifact validation and anti-tamper recomputation.
- `@codenuke/substrate`: worktree and proposer process substrate.
- `@codenuke/changecost`: held-out change-cost benchmark runner.
- `@codenuke/calibrate`: git-history scale calibration.
- `@codenuke/fence`: mutation audit and replay.
- `@codenuke/scorer`: immutable keep/revert decision and manual scorer lifecycle.

## Behavior Gates

The scorer applies gates before value:

- `G1`: target tests pass.
- `G1prime`: every touched region has a usable and admissible fence artifact.
- `G3`: no new type errors compared with baseline.
- `G4`: source AST node count strictly decreases.

If any gate fails, the candidate is rejected. If gates pass, `loss = risk - gain`; keep iff `loss < 0`.

## Command Configuration

Repo commands are argv specs:

```ts
type CommandSpec = {
  readonly file: string;
  readonly args?: readonly string[];
  readonly timeoutMs?: number;
  readonly env?: Record<string, string>;
};
```

`testCommand`, `typeCheckCommand`, and the optional changecost implementer command
use this shape in `codenuke.loop.json`. Environment overrides use
`CN_TEST_FILE` / `CN_TEST_ARGS_JSON`, `CN_TYPECHECK_FILE` /
`CN_TYPECHECK_ARGS_JSON`, and `CN_IMPLEMENTER_FILE` /
`CN_IMPLEMENTER_ARGS_JSON`.

Legacy `CN_TEST`, `CN_TYPECHECK`, `CN_PROPOSER`, and `CN_IMPLEMENTER` shell
strings are rejected with migration errors. The Codex SDK proposer is the
default; `CN_CODEX_PROVIDER=cli` remains a temporary rollback to the direct
Codex CLI adapter.

## Trust Boundary

codenuke is for trusted repositories. codenuke-owned git, test, typecheck,
implementer, and package-manager commands run as argv arrays with
`shell: false`. User/repo configured commands still execute external programs,
but no longer pass through shell strings.

The installed `@openai/codex-sdk@0.133.0` currently wraps the Codex CLI
internally. codenuke no longer manages `codex exec` directly by default, but the
SDK implementation may still spawn Codex until a native non-CLI transport exists.

Use an outer sandbox before running against untrusted code.
