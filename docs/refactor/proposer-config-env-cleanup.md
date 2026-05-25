---
summary: "Fingerprint and cleanup plan for proposer env parsing."
read_when:
  - "Changing CN_* proposer or Codex configuration"
  - "Moving proposer env parsing into ConfigLive"
title: "Proposer Config Env Cleanup"
sidebarTitle: "Proposer Env"
---

# Proposer Config Env Cleanup

`packages/runtime/src/config/config.ts` owns the interim pure resolver for Codex
proposer knobs. The slow part was not runtime speed; it was duplicated parsing
shape: every env knob repeated blank trimming, enum checks, and `ConfigInvalid`
propagation in slightly different local helpers.

## Goal

Make proposer env parsing table-driven and test-pinned while preserving the
current pure boundary:

- `resolveProposerConfig(env)` returns `ResolvedProposerConfig | ConfigInvalid`.
- `resolveProposerLimits(env)` returns timeout and budget without validating
  Codex-only knobs.
- Blank env strings behave like unset env strings.
- `CN_CODEX_SANDBOX=bypass|none` maps to `danger-full-access`.

Future-change scenarios:

- Add a new Codex enum value by editing one value list and one test, not a
  chain of string comparisons.
- Move env/file/autodetect resolution into `ConfigLive` without changing CLI,
  loop, or adapter contracts.
- Split generic proposer limits from Codex adapter options without hidden
  `process.env` reads in lower-level services.

## Non-goals

- Do not implement `ConfigLive`; it remains the larger env/file/autodetect
  resolver.
- Do not change SDK option names or subprocess env allowlisting.
- Do not change budget semantics in this wave.

## Upfront Decisions

Preserve:

- Public env names already used by tests: `CN_MODEL`, `CN_REASONING_EFFORT`,
  `CN_CODEX_SANDBOX`, `CN_CODEX_APPROVAL_POLICY`,
  `CN_PROPOSER_TIMEOUT_MS`, `CN_PROPOSER_BUDGET_USD`.
- Pure validation with `ConfigInvalid`, not Effect-based parsing.
- Existing caller shape in CLI, loop, periodic changecost, and Codex adapter.

Delete:

- Per-knob repeated `raw === undefined || raw.trim() === ""` handling.
- Literal enum chains such as `value === "minimal" || value === "low"`.
- Dead `ConfigInvalid` return path from string budget parsing.

Shim:

- None for this wave. Follow-up `ConfigLive` work can shim old `CN_TIMEOUT` /
  `CN_BUDGET` docs if those names are still intended.

Proof matrix:

- Config parsing -> `pnpm vitest run packages/runtime/test/config.test.ts`.
- Adapter passthrough -> `pnpm vitest run packages/runtime/test/proposer.test.ts`.
- Package type safety -> `pnpm --filter @codenuke/runtime run typecheck`.
- Whitespace and AST fingerprint -> TypeScript AST scan documented below.

Stopping rule:

- Stop this wave when the focused tests and runtime typecheck pass, and the AST
  fingerprint shows no repeated `raw.trim()` or hard-coded enum equality chains
  in proposer env parsers.

## Progress

- [x] (2026-05-25 09:27Z) Scanned config code, runtime/CLI callers, docs, tests,
  and package scripts.
- [x] (2026-05-25 09:27Z) Ran three read-only subagent passes for config/tests,
  callers/adapters, and docs/contracts.
- [x] (2026-05-25 09:27Z) Replaced duplicated env parsing with `envValue`,
  enum value tables, and typed enum parsing.
- [x] (2026-05-25 09:27Z) Added tests for whitespace trimming, blank defaults,
  sandbox aliases, invalid sandbox/approval, and non-integer timeout env.

## Current Branch State

Done:

- `packages/runtime/src/config/config.ts` has canonical value lists for
  reasoning effort, sandbox modes, sandbox aliases, and approval policies.
- `resolveProposerConfig` now composes `resolveProposerLimits` and Codex-specific
  parsing instead of duplicating timeout/budget logic.
- `packages/runtime/test/config.test.ts` pins previously implicit edge cases.

Scanned surface:

```text
config source/tests: 2 files, about 511 lines
runtime/CLI callers: 11 files, about 2,492 lines
docs/spec/refactor/README/package surface: about 3,900 lines
tests mentioning proposer env: 3 files
```

Known temporary state:

- `ConfigLive` is still a stub.
- Docs still drift from runtime behavior: `docs/spec/INTERFACE_CONTRACTS.md`
  says invalid sandbox/approval values fall back, while runtime rejects them.
- Specs mention `CN_TIMEOUT` / `CN_BUDGET`, while current code and tests use
  `CN_PROPOSER_TIMEOUT_MS` / `CN_PROPOSER_BUDGET_USD`.

## Fingerprint

Before cleanup, a TypeScript AST scan of `packages/runtime/src/config/config.ts`
identified the repeated parser shape:

```text
parsePositiveIntegerEnv: 1 raw.trim()
parseNonEmptyStringEnv: 2 raw.trim()
parseReasoningEffort: 2 raw.trim(), 5 value equality checks
parseSandboxMode: 2 raw.trim(), 5 value equality checks
parseApprovalPolicy: 2 raw.trim(), 4 value equality checks
resolveProposerConfig: 5 ConfigInvalid narrow/return checks
```

After cleanup:

```text
envValue: central blank/trim read
parseEnumEnv: central value-table enum parser
parseReasoningEffort / parseSandboxMode / parseApprovalPolicy: no equality chains
resolveProposerConfig: no budget parser dead-error branch
```

## Remaining Refactor Surfaces

### Duplicate Config Reads

CLI resolves proposer config before selecting the proposer layer, while
`runReduceLoop` resolves limits again from `process.env`.

Risk: one invocation can validate related config at two different layers.

Mitigation: pass resolved limits/config into loop options in a follow-up, then
remove hidden lower-level env reads.

### Docs Contract Drift

The current runtime rejects invalid sandbox/approval values, but interface docs
say they fall back.

Risk: users relying on docs will expect invalid values to be accepted.

Mitigation: choose one policy explicitly. If strict rejection is intended, update
`docs/spec/INTERFACE_CONTRACTS.md` and add CLI smoke coverage.

### ConfigLive Ownership

The pure helper exists because `ConfigLive` does not yet own env/file/autodetect
resolution.

Risk: more interim helpers accumulate around `process.env`.

Mitigation: keep the current pure helpers as implementation details and move
them behind `ConfigLive.resolve` once full resolution is implemented.

## Target Shape

```ts
export interface ResolvedProposerLimits {
  readonly proposerTimeoutMs: number
  readonly proposerBudgetUsd: string
}

export interface ResolvedProposerConfig extends ResolvedProposerLimits {
  readonly proposerModel?: string
  readonly proposerReasoningEffort?: ProposerReasoningEffort
  readonly codexSandboxMode: CodexSandboxMode
  readonly codexApprovalPolicy: CodexApprovalPolicy
}
```

Decision rule:

```text
Use resolveProposerLimits for generic loop request timeout/budget.
Use resolveProposerConfig for Codex adapter startup validation.
Keep envValue/parseEnumEnv local until ConfigLive takes ownership.
Stop and open a follow-up if config-file compatibility names need migration.
```

## Migration Steps

1. Current wave: centralize env parser mechanics and pin behavior.

   Risk: accidentally changing blank-string or alias behavior.
   Mitigation: focused tests for whitespace, blank defaults, and aliases.
   Proof: focused config/proposer tests plus runtime typecheck.

2. Next wave: resolve doc drift for invalid sandbox/approval and timeout/budget
   names.

   Risk: documenting the wrong compatibility policy.
   Mitigation: decide strict rejection versus fallback before editing docs.
   Proof: docs diff plus CLI smoke tests.

3. Later wave: move env ownership into `ConfigLive`.

   Risk: breaking current CLI startup validation.
   Mitigation: keep pure helper signatures and call them from the live resolver.
   Proof: package typecheck, config tests, CLI run-json smoke, loop progress
   tests.

## Validation

Commands run for this wave:

```sh
pnpm vitest run packages/runtime/test/config.test.ts packages/runtime/test/proposer.test.ts
pnpm --filter @codenuke/runtime run typecheck
node --input-type=module -e '<TypeScript AST fingerprint scan>'
git diff --check
git diff --check --cached
pnpm typecheck
pnpm test
```
