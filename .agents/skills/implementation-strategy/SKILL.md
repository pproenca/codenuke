---
name: implementation-strategy
description: Apply codenuke's TypeScript and Effect implementation strategy when writing, refactoring, or reviewing repository code. Use for Effect service shape, package boundaries, domain rules, trust-boundary IO, naming/control-flow style, tests, and decisions about Effect.gen versus .pipe. Incorporates the opencode-ts code patterns while preserving codenuke-specific architecture.
---

# Implementation Strategy

Use this skill to make new codenuke code look like it belongs in this repo.
The opencode-ts patterns are useful, but codenuke's architecture and local code
win when they conflict.

## Core Invariant

codenuke is a behavior-preserving reduction engine. The proposer mutates an
isolated git worktree; the scorer/fence decide whether to keep or revert. Code
must preserve the trust boundary:

- Commands are argv arrays, never shell strings.
- Candidate edits happen in managed worktrees, not the user's working tree.
- Scoring, artifact validation, and path guards fail closed.
- Package dependencies flow inward: `core` is pure domain, `fence` owns mutation
  audit logic, `runtime` composes IO/services, `cli` wires commands.
- Existing `RULE-###` comments and docs are contract labels. Keep them accurate.

## Workflow

1. Orient before editing.
   Read the owning file, nearby tests, and relevant docs in `docs/` or `CLAUDE.md`
   when a `RULE-###` or architecture claim is involved. Do not ask for context a
   grep or file read can answer.

2. Choose the owner.
   Put pure measurement/scoring/domain contracts in `packages/core`, mutation
   audit and replay in `packages/fence`, git/proposer/config/orchestration IO in
   `packages/runtime`, and command parsing/output in `apps/cli`.

3. Reuse the local port.
   Prefer existing services, pure helpers, errors, and validators before adding a
   utility. If the behavior only appears once, inline it first.

4. Implement with the local Effect style.
   Use `Context.Tag` service ports, `Layer.succeed` for pure services, and
   `Layer.effect` when the layer captures platform dependencies. Use
   `Data.TaggedError` for local tagged errors unless surrounding code already uses
   a different Effect error convention.

5. Prove the touched surface.
   For docs/skill-only edits, run syntax/diff sanity checks. For TypeScript
   behavior, use the `codenuke-testing` skill and run the narrowest command that
   proves the changed surface.

## Effect Shape

Use both `Effect.gen` and `.pipe`. Each one has a job.

Use `Effect.gen` for:

- Injecting or retrieving dependencies.
- Conditional business logic.
- Sequential operations.
- Multi-step orchestration.
- Returning `yield* Effect.fail(...)` from guarded branches.

Use `.pipe` for:

- Error mapping and recovery.
- Tracing/logging/ensuring wrappers.
- Layer composition and dependency provision.
- Simple transforms over an existing Effect.

```ts
const run = Effect.gen(function* () {
  const store = yield* Store
  const item = yield* store.get(id)

  if (!item.enabled) {
    return yield* Effect.fail(new DisabledItem({ id }))
  }

  return yield* store.save({ ...item, status: "ready" })
}).pipe(
  Effect.withSpan("item.ready", { attributes: { id } }),
  Effect.catchTag("DisabledItem", handleDisabled),
)
```

```ts
const Live = Layer.mergeAll(
  Store.Live,
  Logger.Live,
).pipe(
  Layer.provide(Database.Live),
)

const Id = Schema.String.pipe(
  Schema.nonEmptyString(),
  Schema.brand("Id"),
)
```

Business logic belongs inside `Effect.gen`; cross-cutting composition belongs
around it with `.pipe`.

## Service Pattern

Use service ports for shared effectful capabilities:

```ts
export class Git extends Context.Tag("@codenuke/runtime/Git")<
  Git,
  {
    readonly resolveSha: (worktree: string, ref: string) => Effect.Effect<string, GitFailed | PathEscape>
  }
>() {}

export const GitLive = Layer.effect(
  Git,
  Effect.gen(function* () {
    const executor = yield* CommandExecutor.CommandExecutor

    return Git.of({
      resolveSha: (worktree, ref) =>
        guardRef(ref).pipe(
          Effect.zipRight(gitString(worktree, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])),
          Effect.map((s) => s.trim()),
        ),
    })
  }),
)
```

Keep service methods as Effects. Do not hide async work in plain classes,
callbacks, or raw promises when the surrounding module is Effect-based.

## Style DNA

Adopt the opencode-ts pressure toward small, direct code:

- Prefer single-word locals when clear: `repo`, `root`, `rel`, `row`, `cfg`,
  `opts`, `state`, `err`, `sha`, `tx`.
- Avoid introducing multi-word names when a nearby short noun is clear.
- Inline values used once unless naming them explains a domain invariant.
- Prefer `const`; use early returns or ternaries over reassignment.
- Avoid `else` in new code unless it makes a dense domain decision clearer.
- Avoid unnecessary destructuring; dot access keeps context visible.
- Prefer functional array methods where they stay readable. Use loops when order,
  mutation, or sequential Effect execution is the actual invariant.
- Rely on inference for locals. Add explicit types for exported contracts,
  service ports, public object shapes, and places where inference would hide an
  important boundary.
- Preserve the formatter and style of the touched file. Do not reformat a file to
  import opencode's punctuation preferences.

## Trust Boundary Rules

- Never accept shell strings for configured commands. Use `CommandSpec`-style
  `{ file, args, timeoutMs, env }` shapes and argv-based `Command.make(...)`.
- Never pass the full environment to subprocesses. Use the existing allowlist
  helper or add to the single allowlist owner if the domain requires it.
- Do not duplicate path guards. Route worktree reads through the existing safe
  path/read service for the package.
- Do not bypass artifact validation or startup readiness checks because a CLI path
  is "manual".
- Keep fence determinism: parallelism is per region; mutants stay sequential
  inside one region worktree.
- Keep timestamps, clocks, and random seeds injected where deterministic artifacts
  depend on them.

## Schema And Errors

- Use the schema/error style already present in the owning package.
- Use domain interfaces for exported contracts and pure data shapes.
- Use `Data.TaggedError` for Effect error channels in current codenuke services.
- Use Zod or Effect Schema only where the surrounding boundary already uses it or
  the change is explicitly adding runtime decoding.
- Decode untrusted persisted or external data before using it. Do not cast through
  `as any` or `as unknown as`.

## Test Pattern

- Test pure helpers directly where the rule is pure.
- Test Effect services with real layers or narrow fake ports, not broad mocks.
- Keep test doubles deterministic and local to the port they replace.
- For concurrency/determinism rules, assert stable output across concurrency 1
  and N when that is the contract.
- Do not duplicate production algorithms in tests. Assert the externally visible
  rule or invariant.

## Opencode Reference Gateway

When a task needs examples beyond this compact strategy, load only the relevant
opencode-ts reference:

- Style and review gates: `../opencode-ts/references/style-dna.md`
- Existing helpers and primitive signatures: `../opencode-ts/references/primitives.md`
  or `../opencode-ts/references/helpers-deep-dive.md`
- Service module shape: `../opencode-ts/references/service-module.md`
- Tool/module boundaries: `../opencode-ts/references/tool-module.md`
- Schemas, state, and errors: `../opencode-ts/references/schemas-and-state.md`
- Tests: `../opencode-ts/references/test-writing.md`
- Refactors: start with the matrix in `../opencode-ts/references/refactoring-patterns.md`
- Review voice: `../opencode-ts/references/review-voice.md`

Adapt those examples to codenuke. Do not import opencode-specific modules,
runtime assumptions, package layout, or provider behavior into this repository.

## Check Gate

Before finishing a code diff, reject and fix it if any of these are true:

- Do not build walls of `.map`, `.andThen`, or `.flatMap` for sequential logic.
- Do not use generators for simple transforms.
- Do not turn the whole codebase into one style. Combine the two styles deliberately.
- Do not add `any`, `as any`, or `as unknown as`.
- Do not add shell-string command execution.
- Do not add a second implementation of an existing path guard, artifact reader,
  scoring helper, command validator, or package-owned service.
- Do not move behavior across package boundaries just to make an import convenient.
- Do not change `RULE-###` behavior without updating the relevant tests/docs.
- Do not broaden a refactor beyond the user's requested surface.
