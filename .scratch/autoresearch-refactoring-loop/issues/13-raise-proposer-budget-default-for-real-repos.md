Status: ready-for-agent

# Raise the proposer budget default so a real-repo raise can complete

## What to build

The default `proposerBudgetUsd` is `1.50` (`loop/config.mjs`, `pick("CN_BUDGET", "proposerBudgetUsd", "1.50")`). On a real repo this is too low for the `raise` move: authoring characterization tests requires the agent to read substantial source first, which costs more than $1.50.

Observed 2026-05-22 running the loop on `../codecharter` (~5,700 LOC TS): iter 1 `raise` crashed immediately with
`proposer error: …"errors":["Reached maximum budget ($1.5)"]`. Re-running with `CN_BUDGET=10` let the proposer proceed and do real work (it then hit the proposer timeout — see issue 14).

Raise the default to a value adequate for a real-repo raise (suggest ~$8, document the rationale), keep the `CN_BUDGET` / `codenuke.loop.json` override, and log a budget-exhausted proposer with a distinct, greppable status so it is not confused with other failures.

## Acceptance criteria

- [ ] Default proposer budget is adequate for a `raise` on a multi-thousand-LOC repo, with a documented rationale; `CN_BUDGET` and `codenuke.loop.json` still override.
- [ ] A budget-exhausted proposer is recorded in `results.tsv` with a distinct status (e.g. `crash-budget`) rather than an opaque `crash`.
- [ ] `docs/spec.md` proposer section documents the default and override.

## Blocked by

None - can start immediately.
