Status: done

# `bun test` is auto-selected whenever bun is on PATH, even for non-bun repos

## Context / problem

`loop/config.mjs` `detectTestCommand` returns `bun test` when `commandAvailable("bun")` is true — i.e. whenever bun is installed on the machine — before the package-manager (`pnpm` / `yarn` / `npm test`) fallback. This is intentional and tested (`config.test.mjs`: "detects bun test before package-manager fallback when bun is on PATH").

But machine-global bun availability does not mean the _repo_ uses bun. On `../codecharter` (2026-05-22, bun installed) detection returned `bun test`, which fails — codecharter's tests run via `pnpm test` → `tsx test-support/run-tests.mts`. `doctor` reported `test: not-ready (bun test)` until overridden with `CN_TEST="pnpm test"` (now pinned in codecharter's `codenuke.loop.json`).

## Options to weigh (triage)

- Gate `bun test` on a bun lockfile (`bun.lockb` / `bun.lock`) in the repo, not just bun-on-PATH.
- Prefer a `package.json` `scripts.test` (run via the repo's package manager) when one is present.
- Keep behavior; document `CN_TEST` as the override (lowest effort).

## Acceptance criteria (once a direction is chosen)

- [ ] Decision recorded; if changed, `bun test` is selected only when the repo actually uses bun (e.g. a bun lockfile is present).
- [ ] `config.test.mjs` updated accordingly (the current bun-on-PATH test encodes the behavior being revisited).
- [ ] A repo with a non-bun lockfile and a `test` script resolves to that runner even when bun is installed on the machine.
- [ ] `docs/spec.md` "Test command selection" reflects the outcome.

## Blocked by

None - needs a maintainer decision before implementation.

## Resolution

Decision: `bun test` is selected only when the repo declares Bun via `bun.lock`, `bun.lockb`,
or `packageManager: "bun@..."` and `bun` is available on PATH. Non-Bun repos with a pnpm/yarn/npm
lockfile fall back to their package-manager test command even if Bun is installed globally.
