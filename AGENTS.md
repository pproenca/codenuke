# codenuke

This repository is a plain ESM Node CLI for autonomous, behavior-preserving code
reduction. `docs/spec.md` is the source of truth for the metric, safety gates,
calibration, and release criteria.

## Project Structure

- Published CLI entrypoint: `bin/codenuke.mjs`.
- Runtime engine lives in `loop/`.
- Engine tests live beside the runtime files as `loop/*.test.mjs`.
- Documentation lives in `docs/` and `README.md`.
- Deterministic loop eval lives in `evals/`.
- Package/release validation helpers live in `scripts/`.
- Project-local codenuke state goes in `.codenuke/`; do not commit it.
- Generated output goes in `dist/`; do not edit or commit it.

## Toolchain

Use pnpm with Node 22 or newer.

- `pnpm build`: syntax-check tracked JavaScript modules.
- `pnpm typecheck`: alias for the build/syntax gate; there is no TypeScript compile step.
- `pnpm lint`: run Oxlint using `oxlint.json`.
- `pnpm format`: rewrite files with Oxfmt.
- `pnpm format:check`: verify formatting without writing changes.
- `pnpm test`: run the loop Vitest suite.
- `pnpm test loop/measure.test.mjs`: run one focused loop test file.
- `pnpm eval`: run the deterministic loop CLI eval.
- `pnpm pack:smoke`: run the packaged CLI smoke test.

For local CLI checks, run `node bin/codenuke.mjs <command>`.

Before handing off a non-trivial change, run:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Add `pnpm eval` and `pnpm pack:smoke` when the change affects the loop CLI,
metric behavior, calibration, packaging, installability, or the published npm surface.

## JavaScript Conventions

- Write ESM JavaScript.
- Prefer small pure helpers with explicit return values for metric and scoring logic.
- Follow existing `loop/` patterns before adding new abstractions.
- Avoid bool or ambiguous optional parameters that make call sites hard to read; prefer
  option objects, discriminated status objects, named helpers, or clear domain types.
- Prefer explicit validation over loose string plumbing.
- Keep JSON written to `.codenuke/` schema-shaped and backward-compatible.
- Do not introduce test-only exports in runtime modules unless there is no cleaner way to
  exercise the behavior.
- Do not add helper functions that are referenced only once unless they name a real domain
  concept or isolate a risky operation.
- Keep generated output, local state, and fixture churn out of commits unless the change
  explicitly requires it.

## Metric And Loop Boundaries

When changing metric behavior:

- Treat `docs/spec.md` as the contract.
- Cover AST size `L`, Wilson bounds, edit-cost/LCS, calibration scales, ScoreVerdict
  gates, monotonic fence replay, scripted proposer/implementer determinism, and Spearman
  value-proxy validation with focused tests.
- Keep the scorer immutable relative to proposer edits.
- Preserve fail-closed behavior for missing fence, missing calibration, red baselines, and
  out-of-order scorer commands.
- Preserve isolated `/tmp` worktrees and the guarantee that the user branch/worktree is not
  touched.

External integration surfaces include:

- CLI commands, flags, exit codes, and default output.
- `.codenuke/fence-fidelity.json`, `.codenuke/calibration.json`,
  `.codenuke/changecost.json`, and `.codenuke/results.tsv`.
- `codenuke.loop.json` and `CN_*` environment variables.
- Documentation in `README.md` and `docs/`.
- The npm package contents and bin entrypoint.

Changing one of these surfaces should include tests and, when user-visible,
documentation updates.

## Tests

Vitest is the test framework. Prefer deep equality assertions on complete objects when that
produces clearer coverage than checking fields one by one.

Add or update focused tests for behavior changes, especially:

- metric invariants and calibration math
- fence mutation sampling and replay monotonicity
- scorer gates and value proxy behavior
- worktree isolation and proposer/implementer determinism
- CLI argument validation and reporting output
- package smoke behavior

Use targeted test runs while developing, then run the broader verification sequence before
handoff.

## Documentation

User-facing behavior belongs in `README.md` or `docs/`. Keep docs practical and
command-oriented. Update docs when changing workflows, config, reports, validation,
package install behavior, or safety guarantees.

## Security And Safety

- Do not commit `.codenuke/` state, credentials, provider transcripts, or generated `dist/`
  edits.
- The proposer must not be able to edit the scorer or run shell/git through the approved
  adapter path.
- `run`, `fence`, `changecost`, and scorer operations must not commit, push, open PRs, or
  land changes outside their explicit spec surface.
- Keep dirty-worktree safeguards intact unless the user explicitly asks for a different
  safety model.

## Pull Requests And Commits

Use short semantic subjects such as:

- `fix(loop): fail closed when calibration is missing`
- `feat(metric): validate value proxy correlation`

Keep commits scoped and descriptive. PRs should explain the behavior change, link related
issues, mention docs/changelog updates when needed, and include the exact checks run.

## Agent Skills

### Issue Tracker

Issues and PRDs are tracked as local markdown files under `.scratch/`. See
`docs/agents/issue-tracker.md`.

### Triage Labels

Triage status uses the default mattpocock/skills vocabulary. See
`docs/agents/triage-labels.md`.

### Domain Docs

This repo uses a single-context domain docs layout. See `docs/agents/domain.md`.
