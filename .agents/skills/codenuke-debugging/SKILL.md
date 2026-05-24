---
name: codenuke-debugging
description: "Debug codenuke proposer, scorer, config, worktree, fence, calibration, changecost, package, and CLI behavior by choosing narrow signals before changing code."
---

# codenuke Debugging

Use this when behavior differs between tests, package smoke, scorer decisions, proposer edits, or artifact validation.

## Loop

1. State the suspected boundary: config, proposer prompt, worktree setup, git command, artifact validation, measurement, scoring, package bundle, or CLI entry.
2. Reproduce narrowly with the same config/env shape.
3. Inspect current code and adjacent characterization tests before patching.
4. Patch the owning package.
5. Rerun the failing probe, then broaden only if the contract requires it.

## Code Pointers

- CLI/package entry: `apps/cli/`.
- Orchestration: `packages/orchestrator/src/main/runtime.ts`.
- Config resolution and runtime prompt path: `packages/config/src/main/config.ts`, `packages/config/src/main/program.md`.
- Worktree/proposer substrate: `packages/substrate/src/main/`.
- Artifact validation: `packages/artifacts/src/main/artifacts.ts`.
- Fence and replay: `packages/fence/src/main/`.
- Scoring: `packages/scorer/src/main/`.
- Measurement: `packages/measure/src/main/`.
- Change-cost and value-proxy: `packages/changecost/src/main/`, `packages/value-proxy/src/main/`.

## Common Boundaries

- Config vs runtime: check `CN_*`, `codenuke.loop.json`, and auto-detected defaults.
- Source vs tests: reducers may edit only configured source; raise paths are test-surface only.
- Legacy parity: `.mjs` files under `test-fixtures/legacy-loop/` are test oracles, not runtime.
- Package smoke: `npm pack ./apps/cli` proves bundled files and runtime prompt data.
- Trust model: repo/operator command strings are trusted; engine-owned commands should avoid shell interpolation.

## Output

Report the boundary tested, exact command/env shape with secrets redacted, observed signal, fix location, proof, and remaining risk.
