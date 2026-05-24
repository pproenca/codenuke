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

- CLI entry: `apps/cli/src/main.ts` (@effect/cli tree); exit codes `apps/cli/src/exit-codes.ts`.
- Orchestration: `packages/runtime/src/orchestrator/orchestrator.ts`, state in `packages/runtime/src/orchestrator/state.ts`; loop/lifecycle in `packages/runtime/src/loop/{loop.ts,lifecycle.ts}`.
- Config resolution: `packages/runtime/src/config/config.ts`.
- Worktree/proposer substrate: `packages/runtime/src/git/git.ts` (worktrees), `packages/runtime/src/proposer/{proposer.ts,codex-agent.ts}`.
- Artifact validation: `packages/core/src/artifacts/index.ts` (readiness/anti-tamper in `packages/runtime/src/loop/loop.ts`).
- Fence and replay: `packages/fence/src/*` (`operators/sampling/survivor/wilson/replay/audit/runner/path-guard`).
- Scoring and the pure kernel: `packages/core/src/scoring/index.ts`, `packages/core/src/kernel/index.ts`.
- Measurement: `packages/core/src/measure/index.ts`.
- Change-cost and value-proxy: `packages/runtime/src/periodic/{calibrate,value-proxy,changecost,periodic-run,changecost-run}.ts`.

## Common Boundaries

- Config vs runtime: check `CN_*`, `codenuke.loop.json`, and auto-detected defaults.
- Source vs tests: reducers may edit only configured source; raise paths are test-surface only.
- Behavior parity: pinned by acceptance tests keyed to `RULE-###` ids (`docs/spec/BEHAVIOR_CONTRACT.md`); the old `.mjs` loop oracles are gone.
- Package smoke: `npm pack ./apps/cli` proves the bundled `dist/cli.cjs` bin and its packed files.
- Trust model: repo/operator commands are trusted but argv-only (`CommandSpec` file + args; legacy shell strings rejected, RULE-048); all codenuke-owned subprocesses run `shell:false` with an env allowlist.

## Output

Report the boundary tested, exact command/env shape with secrets redacted, observed signal, fix location, proof, and remaining risk.
