Status: ready-for-agent

# Package v0.1 with release conformance

## What to build

Finish the v0.1 release surface for the Autoresearch Refactoring Loop. The npm package should expose a working `codenuke` executable on Node 22 or newer, include the runtime engine and documentation, and prove the full `docs/spec.md` conformance gate through automated verification and package smoke checks.

## Acceptance criteria

- [ ] `npm i -g codenuke` or the package smoke equivalent exposes a working `codenuke` executable with `typescript` available as a runtime dependency.
- [ ] The packaged files include the engine, bin entrypoint, README, spec, and required runtime assets, and exclude generated local state.
- [ ] README quickstart and `docs/spec.md` agree on command names, artifacts, and the zero-config run path.
- [ ] The final conformance matrix shows every invariant, step contract, acceptance criterion, and release criterion as green or explicitly blocked with a release-stopping reason.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm eval`, and `pnpm pack:smoke` pass.
- [ ] The release notes explain the validation boundary: deterministic local conformance, scripted benchmark determinism, and LLM-backed variance limitations.

## Blocked by

- `.scratch/autoresearch-refactoring-loop/issues/01-codify-conformance-validation-matrix.md`
- `.scratch/autoresearch-refactoring-loop/issues/02-implement-deterministic-metric-primitives.md`
- `.scratch/autoresearch-refactoring-loop/issues/03-establish-zero-config-baseline-detection.md`
- `.scratch/autoresearch-refactoring-loop/issues/04-calibrate-behavior-fence-with-wilson-bounds.md`
- `.scratch/autoresearch-refactoring-loop/issues/05-score-candidate-reductions-with-immutable-gates.md`
- `.scratch/autoresearch-refactoring-loop/issues/06-derive-per-repo-value-calibration-scales.md`
- `.scratch/autoresearch-refactoring-loop/issues/07-run-autoresearch-loop-across-detected-regions.md`
- `.scratch/autoresearch-refactoring-loop/issues/08-raise-weak-behavior-fences-with-monotonic-replay.md`
- `.scratch/autoresearch-refactoring-loop/issues/09-measure-change-cost-benchmark-ground-truth.md`
- `.scratch/autoresearch-refactoring-loop/issues/10-validate-value-proxy-tracks-change-cost.md`
- `.scratch/autoresearch-refactoring-loop/issues/11-prove-worktree-isolation-and-scorer-immutability.md`
