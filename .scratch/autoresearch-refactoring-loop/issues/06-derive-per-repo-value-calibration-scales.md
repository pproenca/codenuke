Status: ready-for-agent

# Derive per-repo value calibration scales

## What to build

Implement `codenuke calibrate` so the scorer's value term is scaled to the target repository instead of relying only on built-in heuristic magnitudes. Calibration should sample recent commits touching the source directory, derive robust positive scales for AST, complexity, and duplication changes, and write `.codenuke/calibration.json`.

## Acceptance criteria

- [ ] `calibrate` writes `.codenuke/calibration.json` with `baseline`, `generatedAt`, `commitsSampled`, and positive `scales.sL`, `scales.sCx`, and `scales.sDup`.
- [ ] The same baseline and repository history produce identical scale values.
- [ ] Calibration samples only commits relevant to the configured source directory.
- [ ] When there are not enough usable commits, calibration records the sample count and falls back to documented built-in defaults without weakening scorer gates.
- [ ] `score` reads calibration scales when present and uses the same built-in defaults when absent.
- [ ] `doctor` reports whether calibration is present and whether the keep-threshold magnitude is repo-calibrated or heuristic.

## Blocked by

- `.scratch/autoresearch-refactoring-loop/issues/01-codify-conformance-validation-matrix.md`
- `.scratch/autoresearch-refactoring-loop/issues/02-implement-deterministic-metric-primitives.md`
- `.scratch/autoresearch-refactoring-loop/issues/03-establish-zero-config-baseline-detection.md`
- `.scratch/autoresearch-refactoring-loop/issues/05-score-candidate-reductions-with-immutable-gates.md`
