Status: ready-for-agent

# Calibrate the Behavior Fence with Wilson bounds

## What to build

Implement `codenuke fence` as the zero-config Behavior Fence calibration command. It should run AST-aware mutations for every detected region in an isolated worktree, compute Wilson 95% confidence intervals, and write `.codenuke/fence-fidelity.json` keyed by the same region set later consumed by `run`.

## Acceptance criteria

- [ ] `fence` creates a throwaway worktree at the configured baseline and aborts if the baseline test command is red.
- [ ] The artifact includes `baseline`, `generatedAt`, `method: "ast-aware"`, `threshold`, `capPerRegion`, `seed`, and per-region `caught`, `total`, `p`, `lo`, `hi`, `admissible`, and `survivorSpecs`.
- [ ] A region is admissible if and only if `lo >= fenceLB`; unmeasured regions are not admissible.
- [ ] Mutation sites are real AST operator tokens only; operator-looking characters inside strings and comments are not mutation sites.
- [ ] Seeded sampling is reproducible for the same inputs and seed.
- [ ] A mutant that times out is counted as caught and does not leave the worktree dirty.
- [ ] `fence` artifact region keys exactly match the shared detected region set from configuration.

## Blocked by

- `.scratch/autoresearch-refactoring-loop/issues/01-codify-conformance-validation-matrix.md`
- `.scratch/autoresearch-refactoring-loop/issues/02-implement-deterministic-metric-primitives.md`
- `.scratch/autoresearch-refactoring-loop/issues/03-establish-zero-config-baseline-detection.md`
