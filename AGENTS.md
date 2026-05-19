# codenuke

This repository is a TypeScript CLI for automated code review, feature mapping,
finding triage, and one-finding-at-a-time fix/revalidation loops.

## Project structure

- Source lives in `src/`.
- CLI entrypoint: `src/cli.ts`.
- Workflow orchestration: `src/app.ts` and `src/workflow.test.ts`.
- Provider command construction and schema handling: `src/provider.ts`,
  `src/provider-json.ts`, `src/provider-schema.ts`, and `src/provider.test.ts`.
- Feature mappers live under `src/mappers/`.
- Tests sit beside implementation files as `*.test.ts`.
- Documentation lives in `docs/`.
- Static website assets live in `website/`.
- Evaluation fixtures and runners live in `evals/`.
- Generated build output goes in `dist/`; do not edit it directly.
- Project-local codenuke state goes in `.codenuke/`; do not commit it.

## Toolchain

Use pnpm with Node 22 or newer.

- `pnpm build`: clean and compile the package with `tsconfig.build.json`.
- `pnpm typecheck`: run TypeScript checks without emitting files.
- `pnpm lint`: run Oxlint using `oxlint.json`.
- `pnpm format`: rewrite files with Oxfmt.
- `pnpm format:check`: verify formatting without writing changes.
- `pnpm test`: run the Vitest suite.
- `pnpm test src/mapper.test.ts`: run one focused test file.
- `pnpm eval`: build and run the local eval fixtures.
- `pnpm pack:smoke`: run the package smoke test.

For local CLI checks, build first, then run `node dist/cli.js <command>`.

Before handing off a non-trivial change, run:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Add `pnpm eval` and `pnpm pack:smoke` when the change affects mapping behavior,
provider output contracts, packaging, CLI installability, or the published npm
surface.

## TypeScript conventions

- Write ESM TypeScript.
- Prefer small pure helpers with explicit return values for shared functions.
- Follow existing mapper/provider patterns before adding new abstractions.
- Avoid bool or ambiguous optional parameters that make call sites hard to read;
  prefer option objects, discriminated unions, named helpers, or clear domain
  types when they keep the call site self-documenting.
- Prefer exhaustive unions and explicit validation over loose string plumbing.
- Keep JSON written to `.codenuke/` schema-shaped and backward-compatible.
- Do not introduce test-only exports in production modules unless there is no
  cleaner way to exercise the behavior.
- Do not add helper functions that are referenced only once unless they name a
  real domain concept or isolate a risky operation.
- Keep generated output, local state, and fixture churn out of commits unless the
  change explicitly requires it.

## Mapper and workflow boundaries

Mappers should be conservative. A mapper is allowed to miss a feature slice; it
should not confidently include unrelated secret-bearing files, generated output,
vendored dependencies, or large irrelevant trees.

When changing mappers:

- Keep mapper-specific logic in `src/mappers/<domain>.ts` when possible.
- Reuse shared helpers from `src/mappers/shared.ts`,
  `src/mappers/projects.ts`, `src/mappers/workspaces.ts`, and
  `src/mappers/task-graph.ts` before adding another traversal pattern.
- Add focused mapper tests with realistic small fixtures.
- Preserve stable feature IDs unless the behavior change intentionally requires
  remapping.

When changing workflow state transitions:

- Cover resume, locking, triage status, patch attempt, and validation behavior
  with focused tests.
- Treat `.codenuke/` files as durable user state. Avoid silent destructive
  migrations.
- Keep provider output schema validation strict; do not accept loose fallback
  shapes just to make a provider response pass.

## CLI and provider surfaces

External integration surfaces include:

- CLI commands, flags, exit codes, and default output.
- `.codenuke/config.json`, feature records, finding records, patch attempts, and
  report files.
- Provider command construction for `codex`, `acpx`, `grok`, `opencode`,
  `mock`, and `mock-fail`.
- Documentation in `README.md` and `docs/`.
- The npm package contents and bin entrypoint.

Changing one of these surfaces should include tests and, when user-visible,
documentation updates.

## Tests

Vitest is the test framework. Prefer deep equality assertions on complete
objects when that produces clearer coverage than checking fields one by one.

Add or update focused tests for behavior changes, especially:

- mapper coverage and feature IDs
- workflow state transitions
- provider command construction
- JSON schema parsing and validation behavior
- CLI argument validation and reporting output
- package smoke behavior

Use targeted test runs while developing, then run the broader verification
sequence before handoff.

## Module size

Avoid large modules:

- Prefer adding a mapper-specific module instead of growing a central helper
  file.
- Be especially careful with central orchestration files such as `src/app.ts`,
  `src/provider.ts`, `src/mapper.ts`, `src/workflow.test.ts`, and
  `src/mappers/shared.ts`.
- If a file is already large, add new functionality in a focused module unless
  there is a strong reason to keep the code local.
- When extracting code, move the related tests and invariants toward the new
  implementation.

## Documentation

User-facing behavior belongs in `README.md` or `docs/`. Keep docs practical and
command-oriented. Update docs when changing workflows, config, providers,
reports, validation, package install behavior, or safety guarantees.

Website-only changes belong in `website/`; keep generated or rendered artifacts
out of unrelated code changes.

## Security and safety

- Do not commit `.codenuke/` state, credentials, provider transcripts with
  secrets, or generated `dist/` edits.
- Keep new provider and mapper code conservative about reading secret-bearing
  files.
- Review does not edit files; preserve that contract.
- `fix` is explicit and selected by finding ID; it must not commit, push, open
  PRs, or land changes.
- Keep dirty-worktree safeguards intact unless the user explicitly asks for a
  different safety model.

## Pull requests and commits

Use short semantic subjects such as:

- `fix(provider): quote codex exec args correctly on Windows`
- `feat(mapper): support monorepo Next project mapping`

Keep commits scoped and descriptive. PRs should explain the behavior change,
link related issues, mention docs/changelog updates when needed, and include the
exact checks run. Add screenshots only for website or rendered-doc changes.
