# Speed Up codenuke Without Lowering the Bar

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must stay up to date as work proceeds.

This document follows /Users/pedroproenca/Documents/Projects/codenuke/PLANS.md.

## Purpose / Big Picture

After this change, `codenuke run` should spend less time on candidates that cannot possibly be kept, while accepted reductions still pass the same immutable scorer: tests pass, touched behavior-fence regions are admissible, type errors do not increase, AST size gets smaller, and `loss = risk - gain < 0`.

The user-visible result is a faster short dogfood loop with clearer rejection reasons. A maintainer should be able to run a small-region dogfood command and see fewer full test/typecheck cycles for candidates rejected by cheap guardrails such as no-change, oversized diff, out-of-region edits, public API edits, test edits, config edits, and generated-file edits.

The acceptance predicate must not change. This plan changes the cost schedule around the predicate:

    cheap search -> cheap vetoes -> expensive proof -> keep/revert

## Progress

- [x] (2026-05-27 07:51Z) Read /Users/pedroproenca/Documents/Projects/codenuke/PLANS.md and drafted this ExecPlan.
- [x] (2026-05-27 07:51Z) Inspected current loop, score, probation, fence, and proposer-efficiency docs.
- [x] (2026-05-27 08:02Z) Implemented Milestone 1: early score vetoes now avoid test/typecheck commands when cheap guardrails, fence gate, or G4 already reject the candidate.
- [x] (2026-05-27 08:02Z) Implemented Milestone 2: reduce prompts include deterministic discovery opportunity context when available.
- [x] (2026-05-27 08:02Z) Implemented Milestone 3: proposer thread ids can be persisted, selected by `mode:regionTarget`, and invalidated on baseline mismatch.
- [x] (2026-05-27 08:02Z) Implemented Milestone 4: `DOGFOOD_FAST=1 pnpm dogfood` selects a small region and prints proposer/runtime knobs.
- [x] (2026-05-27 08:02Z) Implemented the feasible core of Milestone 5: `Fence.replayRegion` re-tests prior survivors and recomputes Wilson with the original denominator.
- [x] (2026-05-27 08:02Z) Ran full validation: `pnpm test`, `pnpm typecheck`, `pnpm build`, and `git diff --check`.

## Surprises & Discoveries

- Observation: `scoreCurrentChange` computes changed files, diff size, before/after source text, and probation guardrail failures, but only after starting the expensive test and typecheck path.
  Evidence: /Users/pedroproenca/Documents/Projects/codenuke/packages/runtime/src/score/score.ts reads `changed` and `diffsize` at lines 35-56, runs `runTestCommand` and `runTypecheckCount` at lines 57-58, and computes `probationGuardrails` at lines 88-98.

- Observation: the fence engine already preserves determinism by parallelizing across regions and keeping mutants sequential within each region worktree.
  Evidence: /Users/pedroproenca/Documents/Projects/codenuke/packages/fence/src/audit.ts documents the concurrency invariant at lines 9-13 and implements region-level `Effect.forEach(..., { concurrency: input.fenceConcurrency })` at lines 147-152.

- Observation: current runtime prompts are probation-aware, but the loop still targets the broad selected region rather than a deterministic opportunity record.
  Evidence: /Users/pedroproenca/Documents/Projects/codenuke/packages/runtime/src/loop/loop.ts builds a prompt with region and guardrails at lines 103-130 and passes `target: opts.region` at lines 237-240.

- Observation: the Codex adapter can honor `req.threadId`, but the reduce loop does not persist or resume thread ids.
  Evidence: /Users/pedroproenca/Documents/Projects/codenuke/docs/refactor/codex-agent-efficiency.md records this at lines 272-283.

- Observation: replay preconditions must be explicit inputs because `@codenuke/fence` intentionally stays git-agnostic.
  Evidence: /Users/pedroproenca/Documents/Projects/codenuke/packages/fence/src/audit.ts now requires `baselineGreen`, `baselineFiles`, and `currentFiles` on `Fence.replayRegion` before re-testing survivors.

## Decision Log

- Decision: keep the scorer as the only authority for acceptance.
  Rationale: the product claim is behavior-preserving reduction. Speed work must reduce wasted attempts, not buy acceptance through weaker gates.
  Date/Author: 2026-05-27 / Codex.

- Decision: put cheap, deterministic vetoes before tests and typecheck, but keep the final score envelope path shared by `score`, `run`, and manual lifecycle commands.
  Rationale: a candidate that edits tests or exceeds probation diff size is already rejected. Running tests first adds latency without increasing confidence.
  Date/Author: 2026-05-27 / Codex.

- Decision: use deterministic discovery opportunities to narrow proposer scope, but never put discovery output into the judge.
  Rationale: discovery is search guidance. The deterministic scorer remains the acceptance boundary.
  Date/Author: 2026-05-27 / Codex.

- Decision: do not parallelize mutants within one region worktree.
  Rationale: the fence implementation intentionally mutates files in place; per-mutant concurrency in one tree would corrupt the source and break determinism.
  Date/Author: 2026-05-27 / Codex.

## Outcomes & Retrospective

Implemented behavior so far:

- `scoreCurrentChange` now computes the candidate surface and measurements before expensive proof. If probation guardrails, out-of-region edits, missing/blocked fence evidence, or non-shrinking AST already reject the candidate, score assembly skips the configured test and typecheck commands.
- `runReduceLoop` discovers deterministic opportunities from the selected region and includes one opportunity id, kind, files, estimated gain, and evidence summary in the reduce prompt. Discovery guides search only; the scorer remains the acceptance authority.
- Proposer thread state is persisted in `.codenuke/proposer-threads.json` through the existing schema, with optional `baselineSha` metadata for stale-context invalidation.
- `DOGFOOD_FAST=1 pnpm dogfood` selects `packages/core/src/discovery`, defaults `CN_PROPOSER_TIMEOUT_MS=180000`, defaults `CN_REASONING_EFFORT=medium`, and prints proposer/runtime settings before work starts.
- `Fence.replayRegion` can re-test prior survivors, keep the original Wilson denominator, and return only still-surviving mutants.

Remaining gap:

- `Fence.replayRegion` now enforces green-baseline and source-unchanged preconditions when the caller supplies baseline/current source snapshots. A CLI/runtime command that gathers those snapshots from the persisted artifact and worktree is still a follow-up. The full audit path remains unchanged and should stay the default evidence path until that wiring lands.

Validation completed:

    pnpm test
      33 passed, 1 skipped test file; 266 passed, 26 skipped, 7 todo tests.

    pnpm typecheck
      packages/core, packages/fence, packages/runtime, and apps/cli typecheck passed.

    pnpm build
      apps/cli build passed and produced dist/cli.cjs.

    git diff --check
      passed.

## Context and Orientation

codenuke is a CLI for autonomous, behavior-preserving code reduction. A proposer edits an isolated git worktree. The scorer then decides whether to keep or revert the candidate. The loop publishes kept results to `refs/codenuke/result` and does not edit the user's working tree.

Important files:

- /Users/pedroproenca/Documents/Projects/codenuke/packages/runtime/src/loop/loop.ts owns the reduce loop. It creates one worktree, builds a proposer request, invokes the proposer, scores the candidate, commits kept changes in the worktree, or discards rejected changes.
- /Users/pedroproenca/Documents/Projects/codenuke/packages/runtime/src/score/score.ts owns live score assembly. It reads changed files, computes measurements, runs tests and typecheck, reads validated artifacts, applies probation guardrails, and calls `decideEnvelope`.
- /Users/pedroproenca/Documents/Projects/codenuke/packages/runtime/src/score/probation.ts owns unknown-repo guardrails: max one source file, max diff size 80, no tests, no dependency/config files, no generated/binary files, no public export changes, and no new import cycles.
- /Users/pedroproenca/Documents/Projects/codenuke/packages/core/src/discovery/index.ts owns deterministic JS/TS opportunity discovery for duplicate subtrees, wrapper chains, unused symbols, similar functions, and local simplifications.
- /Users/pedroproenca/Documents/Projects/codenuke/packages/fence/src/audit.ts owns behavior-fence mutation auditing. It runs mutants sequentially inside each region worktree and can audit multiple regions concurrently.
- /Users/pedroproenca/Documents/Projects/codenuke/packages/runtime/src/proposer/proposer.ts and /Users/pedroproenca/Documents/Projects/codenuke/packages/runtime/src/proposer/codex-agent.ts own the proposer port and Codex SDK adapter.

Definitions:

- Candidate: the uncommitted diff produced by one proposer attempt inside an isolated worktree.
- Cheap veto: a deterministic rejection that can be computed from git diff metadata and source text without running the configured test or typecheck command.
- Expensive proof: test command, typecheck command, and behavior-fence-backed scoring.
- Acceptance predicate: the existing scorer decision: all hard gates pass and `loss < 0`.
- Opportunity: a deterministic record describing a likely reduction target. It guides the proposer but does not affect acceptance.

## Plan of Work

Milestone 1: Add an early veto ladder to scoring.

In /Users/pedroproenca/Documents/Projects/codenuke/packages/runtime/src/score/score.ts, split score assembly into cheap and expensive phases. The cheap phase should read changed paths, all changed paths, source before/after text, diff size, artifact readiness for the selected region, and probation guardrail failures. If the candidate has no source changes, edits outside the selected region, lacks a usable fence record for the touched region, or has blocking probation guardrail failures, return a rejected score envelope without calling `runTestCommand` or `runTypecheckCount`.

The final envelope must still be built by the existing `decideEnvelope` path so progress output, JSON shape, guardrail reporting, and metric provenance remain stable. Tests should use fake command specs that fail if invoked to prove the early veto path avoids expensive commands.

Milestone 2: Drive proposer attempts from deterministic opportunities.

In /Users/pedroproenca/Documents/Projects/codenuke/packages/runtime/src/loop/loop.ts, discover opportunities for the selected region at the baseline and select a stable target per attempt. Start conservatively: pass only one opportunity summary into `buildReducePrompt`, with an id, kind, file list, and suggested target text. If no opportunities exist, keep the current region-level prompt.

Do not let an opportunity bypass probation. The prompt should still include max files, max diff size, no tests/config/docs, no public exports, and the "stop without changing files" instruction.

Milestone 3: Persist and resume proposer threads.

Use the existing `ProposerThreadState` schema from /Users/pedroproenca/Documents/Projects/codenuke/packages/core/src/domain/index.ts. Add runtime helpers to read and write /Users/pedroproenca/Documents/Projects/codenuke/.codenuke/proposer-threads.json. The loop should look up the key `${mode}:${regionTarget}` and pass the thread id into `ProposerRequest.threadId` when the baseline is still valid.

If the baseline SHA changes, invalidate or ignore the old thread. On proposer failure, keep the previous thread record unchanged. On success with a returned thread id, update `lastUsedAt`.

Milestone 4: Add dogfood presets and docs.

In /Users/pedroproenca/Documents/Projects/codenuke/scripts/dogfood.mjs and developer docs, add a small-region, bounded-run path that makes the fast loop easy to reproduce. Preserve safe defaults. Document the recommended env knobs:

    CN_SRC=<small region>
    CN_PROPOSER_TIMEOUT_MS=<short timeout for dogfood>
    CN_MODEL=<configured model>
    CN_REASONING_EFFORT=medium

The script should print the resolved region, timeout, model, reasoning effort, test command, and typecheck command before running.

Milestone 5: Add scoped fence replay or refresh.

Implement the effectful `Fence.replayRegion` path currently marked as a follow-up in /Users/pedroproenca/Documents/Projects/codenuke/packages/fence/src/audit.ts. Use existing survivor specs from the artifact and re-test only survivors for the selected region. This keeps the Wilson denominator fixed and can only preserve or improve the lower bound when new characterization tests catch old survivors.

This milestone is independent of the inner-loop speed path. It improves the cost of maintaining evidence without changing how candidates are accepted.

## Concrete Steps

Use /Users/pedroproenca/Documents/Projects/codenuke as the working directory.

1. Create tests for Milestone 1 before editing score code.

       pnpm vitest run packages/runtime/test/score.test.ts packages/runtime/test/probation.test.ts

   Add tests that assert guardrail-blocked candidates do not call test/typecheck commands. Expected failure before implementation: the new tests observe test/typecheck invocation.

2. Refactor /Users/pedroproenca/Documents/Projects/codenuke/packages/runtime/src/score/score.ts.

   Keep the exported `scoreCurrentChange` signature stable. Extract helper functions only if they clarify phase boundaries:

       collectCandidateSurface(...)
       cheapRejectReason(...)
       buildRejectedEnvelope(...)

   Do not change `decideEnvelope` semantics.

3. Validate Milestone 1.

       pnpm vitest run packages/runtime/test/score.test.ts packages/runtime/test/probation.test.ts packages/core/test/scoring.test.ts packages/core/test/metric-vector.test.ts
       pnpm --filter @codenuke/runtime run typecheck

   Expected result: all commands exit 0. The score tests should prove early-veto candidates do not run expensive commands.

4. Add opportunity-target prompt tests.

       pnpm vitest run packages/core/test/discovery.test.ts packages/runtime/test/loop.test.ts packages/runtime/test/progress.test.ts

   Expected initial failure: loop prompt tests do not yet include opportunity ids or targets.

5. Wire opportunity selection into /Users/pedroproenca/Documents/Projects/codenuke/packages/runtime/src/loop/loop.ts.

   Preserve fallback behavior when no opportunities are found. Keep opportunity selection deterministic by sorting on opportunity id and using the current attempt number.

6. Validate Milestone 2.

       pnpm vitest run packages/core/test/discovery.test.ts packages/runtime/test/loop.test.ts packages/runtime/test/progress.test.ts
       pnpm --filter @codenuke/runtime run typecheck

7. Add thread-state tests and implementation.

       pnpm vitest run packages/runtime/test/services-stub.test.ts packages/runtime/test/proposer.test.ts

   Replace skipped/todo thread-continuity coverage with executable tests.

8. Validate dogfood script and docs.

       node scripts/dogfood.mjs --help
       git diff --check

   If the script has no help mode, use a dry-run or fake proposer smoke instead:

       CN_PROPOSER_PROVIDER=fake DOGFOOD_ITERATIONS=1 pnpm dogfood

9. Validate the integrated fast path.

       pnpm test
       pnpm typecheck

   For a local smoke, use a small source region and fake proposer first:

       CN_PROPOSER_PROVIDER=fake CN_SRC=packages/core/src/discovery pnpm dogfood

## Validation and Acceptance

Milestone 1 is accepted when:

- A candidate rejected for no-change, out-of-region edit, probation diff size, test edit, dependency/config edit, generated/binary edit, public API change, or import cycle does not invoke the configured test or typecheck commands.
- A candidate with no cheap veto still invokes the same test and typecheck commands as before.
- `score --json`, `run`, and manual lifecycle scoring still emit the same score envelope fields.

Milestone 2 is accepted when:

- The loop prompt includes a deterministic opportunity id and target when opportunities exist.
- The fallback prompt remains valid when no opportunities exist.
- Every accepted candidate still goes through the scorer. Opportunity kind never appears as an acceptance gate.

Milestone 3 is accepted when:

- A second reduce request for the same mode and region resumes the stored thread id.
- A different mode or region starts a fresh thread.
- A changed baseline SHA does not resume stale thread context.
- Proposer failures do not overwrite the last good thread record.

Milestone 4 is accepted when:

- Dogfood output shows resolved small-run configuration before work begins.
- The recommended dogfood path can run with `CN_PROPOSER_PROVIDER=fake`.
- Docs include the exact env knobs needed for bounded local runs.

Milestone 5 is accepted when:

- Replaying a region tests only prior survivors.
- Wilson lower bound is recomputed with the original denominator.
- Source drift or red baseline preconditions fail closed.

Overall acceptance:

- The scorer's acceptance predicate is unchanged.
- Rejected dead-on-arrival candidates avoid expensive proof.
- Full tests and typecheck pass.
- The final Outcomes & Retrospective includes before/after timing from at least one fake proposer run and, if credentials are available, one real Codex dogfood run.

## Idempotence and Recovery

All implementation steps are additive and can be retried. Test files should create temporary repos or worktrees and clean them up through existing helpers.

If Milestone 1 breaks score envelope compatibility, revert only the score refactor and keep the tests that describe intended behavior. Do not weaken tests, typecheck, fence, or `loss < 0`.

If opportunity targeting produces worse proposer behavior, keep the opportunity discovery data behind a config or internal loop flag while preserving the old region-level prompt fallback.

If thread persistence resumes stale context, disable resume by ignoring stored thread ids until baseline-aware invalidation is correct. Do not delete the schema or unrelated thread records.

If fence replay is incomplete, leave the current full audit path intact. Replay must be an optimization over existing evidence, not a replacement that trusts stale artifacts.

## Artifacts and Notes

Initial code references:

    /Users/pedroproenca/Documents/Projects/codenuke/packages/runtime/src/loop/loop.ts
      Lines 1-15 describe the current per-iteration propose -> score -> keep/revert lifecycle.
      Lines 103-130 build the current probation-aware reduce prompt.
      Lines 230-299 run the proposer and then score each candidate.

    /Users/pedroproenca/Documents/Projects/codenuke/packages/runtime/src/score/score.ts
      Lines 35-56 collect changed files and diff size.
      Lines 57-58 run test and typecheck before cheap guardrails.
      Lines 80-98 compute fence usability and probation guardrails.

    /Users/pedroproenca/Documents/Projects/codenuke/packages/runtime/src/score/probation.ts
      Lines 4-6 define probation caps.
      Lines 100-142 compute current cheap guardrail failures.

    /Users/pedroproenca/Documents/Projects/codenuke/packages/fence/src/audit.ts
      Lines 9-13 define the safe concurrency model.
      Lines 131-152 run mutants sequentially per region and regions concurrently.

Expected timing note format for Outcomes & Retrospective:

    Scenario: fake proposer creates a probation-diffsize candidate.
    Before: score phase ran test/typecheck and took <duration>.
    After: score phase returned early veto `probation-diffsize` and took <duration>.
    Command: <exact command>
    Result: <exit code and key output lines>

## Interfaces and Dependencies

Keep these interfaces stable unless this plan is explicitly revised:

- `scoreCurrentChange(opts)` from /Users/pedroproenca/Documents/Projects/codenuke/packages/runtime/src/score/score.ts remains the live score entry point.
- `decideEnvelope(args)` from /Users/pedroproenca/Documents/Projects/codenuke/packages/runtime/src/score/envelope.ts remains the score envelope constructor.
- `probationGuardrails(args)` from /Users/pedroproenca/Documents/Projects/codenuke/packages/runtime/src/score/probation.ts remains the source of probation failures.
- `discoverOpportunities(files, root)` from /Users/pedroproenca/Documents/Projects/codenuke/packages/core/src/discovery/index.ts remains deterministic and does not depend on LLM output.
- `ProposerRequest.threadId` from /Users/pedroproenca/Documents/Projects/codenuke/packages/runtime/src/proposer/proposer.ts is the only loop-to-adapter thread resume field.
- `ProposerThreadState` from /Users/pedroproenca/Documents/Projects/codenuke/packages/core/src/domain/index.ts is the only persisted thread-state schema.
- `Fence.runAudit` and `Fence.replayRegion` from /Users/pedroproenca/Documents/Projects/codenuke/packages/fence/src/audit.ts preserve deterministic artifact behavior.

No new external runtime dependency is required for Milestones 1 through 4. Milestone 5 should use existing Effect, git, filesystem, and test command infrastructure.

## Revision Notes

- 2026-05-27 / Codex: Initial ExecPlan created from the speed-without-lowering-bar design discussion. The plan focuses on reducing wasted verification work while preserving the existing acceptance predicate.
