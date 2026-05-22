Status: ready-for-agent

# Establish zero-config baseline detection for new codebases

## What to build

Make `codenuke doctor` and shared configuration resolution establish a reliable baseline on unfamiliar JavaScript and TypeScript repositories. A fresh repo should produce a detected source directory, a non-empty region set when source exists, terminating test and typecheck commands where available, and precise readiness gaps when prerequisites are missing.

## Acceptance criteria

- [ ] `doctor` reports the detected repo, baseline, source directory, target filter, regions, test command, optional typecheck command, fence artifact status, calibration status, and proposer availability.
- [ ] `srcDir` detection follows the spec order: `tsconfig.json`, `package.json` hints, first source-bearing `src` / `lib` / `app` / `source`, then repo root.
- [ ] Region detection returns immediate source-bearing subdirectories, or the `srcDir` itself for flat layouts, and is never empty when source exists.
- [ ] Detection fixtures cover `src` with subdirectories, flat `src`, `lib`, `app`, `source`, and source at repo root.
- [ ] Test command detection prefers terminating single-run commands and reports non-terminating commands as not ready.
- [ ] Typecheck detection uses `tsc -p tsconfig.json --noEmit` when local `tsc` and `tsconfig.json` exist, and otherwise skips G3 explicitly.
- [ ] `doctor` exits `0` only when checkable readiness requirements pass and exits `2` with specific gaps when the repo is not ready.

## Blocked by

- `.scratch/autoresearch-refactoring-loop/issues/01-codify-conformance-validation-matrix.md`
- `.scratch/autoresearch-refactoring-loop/issues/02-implement-deterministic-metric-primitives.md`
