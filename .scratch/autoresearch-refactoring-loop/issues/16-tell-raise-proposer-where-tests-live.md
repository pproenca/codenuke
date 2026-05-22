Status: done

# Tell the raise proposer where the repo's tests live

## What to build

The `raise` move asks the proposer to add characterization tests, but the prompt (`loop/program.md` plus the raise prompt built in `loop/autoloop.mjs`) does not tell the proposer the repo's test-file location or naming convention.

Observed 2026-05-22 on `../codecharter`: the agent wrote co-located `src/scan.test.ts` / `src/init.test.ts`, but codecharter's runner (`tsx test-support/run-tests.mts`) only discovers `test/*.test.ts`. The new tests were correct (they even handled an output-equivalent mutant), but they would never be run by the test command — so the monotonic replay could not see them and the fence could not rise, making the raise a guaranteed `raise-nogain` even on success.

Detect the repo's test directory / glob in `loop/config.mjs` (from existing test files and/or the test runner config), pass it into the raise prompt, and have the raise surface-check require that new tests land where the configured test command will discover them.

## Acceptance criteria

- [ ] The raise prompt states the repo's test directory / naming convention, derived from the repo (not hardcoded).
- [ ] The raise surface-check validates that proposer-written tests are in a location the configured `testCommand` will discover; otherwise it is rejected with a clear reason.
- [ ] Detection handles both separate (`test/*.test.ts`) and co-located (`src/**/*.test.ts`) layouts.
- [ ] Covered by a test that fails before the fix (tests written outside the discovered location are silently ignored).

## Blocked by

None - can start immediately.

## Resolution

The config now derives a test layout from existing `test/` or `tests/` directories, falling back
to colocated tests under the source root. The raise prompt tells the proposer that discovered
layout, and the raise surface check rejects tests outside it with a clear `raise-badtest`.
Accepted raise commits now stage the actual test files written in that surface, so separate
`test/` directory tests are not lost after replay.
