---
name: implementation-strategy
description: Apply this repo's Effect implementation style when writing, refactoring, or reviewing TypeScript Effect code. Use for decisions about Effect.gen versus .pipe, dependency access, conditional business logic, sequential operations, error handling, tracing, layer construction, and simple transforms.
---

# Implementation Strategy

Use both `Effect.gen` and `.pipe`. Each one has a job.

## Decision Matrix

- Injecting or retrieving dependencies: `Effect.gen`
- Conditional logic: `Effect.gen`
- Sequential operations: `Effect.gen`
- Multi-step business logic: `Effect.gen`
- Error handling: `.pipe`
- Tracing and logging wrappers: `.pipe`
- Layer building: `.pipe`
- Simple transforms: `.pipe`

## Style Rule

Put business logic inside `Effect.gen`. Put cross-cutting composition outside with `.pipe`.

Prefer `Effect.gen` when the code reads like a procedure:

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

Prefer `.pipe` when the code reads like composition:

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

## Avoid

- Do not build walls of `.map`, `.andThen`, or `.flatMap` for sequential logic.
- Do not use generators for simple transforms.
- Do not turn the whole codebase into one style. Combine the two styles deliberately.
