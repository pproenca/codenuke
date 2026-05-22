Status: done

# Parameterize and raise the proposer timeout (300s is too short for real repos)

## What to build

`loop/autoloop.mjs` hardcodes the proposer wall-clock timeout (`const TIMEOUT = 300000;`, ~line 38) and applies it to every proposer call (`shTry(..., { timeout: TIMEOUT })`, ~lines 213/216). There is no env or config override.

Observed 2026-05-22 on `../codecharter`: with an adequate budget (`CN_BUDGET=10`), the `raise` proposer was killed at exactly 300s **mid-work**. It had already written valid characterization tests (`src/scan.test.ts`, `src/init.test.ts`) but had not finished, so the iteration logged an empty `proposer error:` and kept nothing. Five minutes is too short for an agent to read a multi-thousand-LOC repo and author tests.

Resolve a proposer timeout from `CN_TIMEOUT` > `codenuke.loop.json` (`proposerTimeoutMs`) > a higher default (suggest 900000 = 15 min) in `loop/config.mjs`, and use it in `autoloop.mjs`.

## Acceptance criteria

- [ ] Proposer timeout resolves from `CN_TIMEOUT` > `codenuke.loop.json` > a higher default (≥ ~15 min), surfaced on `config`.
- [ ] A timed-out proposer is recorded with a distinct status (e.g. `crash-timeout`); today it logs an empty `proposer error:`.
- [ ] `loop/config.test.mjs` covers the resolution order and the default.
- [ ] `docs/spec.md` proposer section documents the timeout and override.

## Blocked by

None - can start immediately. Related: issue 15 (the timeout currently leaks the proposer).

## Resolution

Proposer timeout now resolves from `CN_TIMEOUT` > `codenuke.loop.json` `proposerTimeoutMs` >
`900000` (15 minutes), is surfaced on config, and is used for both `CN_PROPOSER` and the
default `claude -p` adapter. Timed-out proposers are classified as `crash-timeout` in
`results.tsv`.
