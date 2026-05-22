Status: ready-for-agent

# Codify the conformance validation matrix

## What to build

Create a traceable validation matrix for the Product Contract in `docs/spec.md`. The matrix should make every invariant, step contract, acceptance criterion, and release criterion mechanically accountable before implementation work spreads across the loop.

The matrix must treat `docs/spec.md` as the source of truth for command names and behavior. It must also define the deterministic testing convention for later slices: mathematical checks, positive controls, loop tests, fence-raising tests, and change-cost tests use scripted `CN_PROPOSER` / `CN_IMPLEMENTER` commands in CI; the real `claude -p` adapter receives only targeted smoke coverage that does not make correctness depend on model output.

## Acceptance criteria

- [ ] Every `INV-*`, loop step contract, behavior-fence step contract, change-cost step contract, `AC-*`, and v0.1 release criterion from `docs/spec.md` is listed with an owning implementation issue and an intended automated check.
- [ ] The matrix explicitly records that `fence`, `accept`, `revert`, and `cleanup` are the command names for this work because `docs/spec.md` is the source of truth.
- [ ] The matrix states that deterministic and positive-control tests use scripted `CN_PROPOSER` / `CN_IMPLEMENTER`, while real `claude -p` adapter coverage is limited to smoke tests.
- [ ] The matrix reflects the corrected determinism rule: `fence`, `score`, and `calibrate` must be deterministic for the same inputs and seed; `changecost` is deterministic with a scripted `CN_IMPLEMENTER`, while LLM-backed runs are evaluated through paired comparison rather than exact replay.
- [ ] A contributor can identify the missing check owner for any future spec criterion without reading unrelated implementation files.

## Blocked by

None - can start immediately
