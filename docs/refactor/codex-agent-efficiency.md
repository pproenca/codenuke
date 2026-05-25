---
summary: "Make codenuke's Codex proposer agents configurable, bounded, observable, and efficient enough for useful dogfood runs."
read_when:
  - Changing the Codex proposer, changecost implementer, dogfood loop, or proposer environment handling.
  - Debugging slow or rejected dogfood attempts, missing model/reasoning options, or Codex SDK behavior.
title: "Codex Agent Efficiency Refactor"
sidebarTitle: "Codex Agents"
---

# Codex Agent Efficiency Refactor

codenuke can spawn real Codex SDK agents from the reduce loop, but the current
agent path loses important configuration, gives the model a weak prompt, and
makes failures hard to diagnose. The result is expensive dogfood turns that are
safe to revert but unlikely to keep useful probation-sized reductions.

## Goal

Make every Codex-backed attempt use an explicit, validated agent configuration,
clear reduction instructions, bounded runtime/cost, and durable diagnostics while
preserving the current fail-closed keep/revert behavior.

Future-change scenarios:

- Tune dogfood attempts without code edits: setting `CN_REASONING_EFFORT=medium`,
  `CN_MODEL`, sandbox, timeout, and budget should change the next proposer run
  and be visible in testable request metadata.
- Add a second proposer adapter or CLI fallback: the loop should depend on
  resolved config fields and the existing proposer port, not raw `process.env`
  or a parallel agent-config object.
- Improve keep rate under probation: prompts should constrain candidates to one
  source file, diffsize under 80, no public exports, no tests/config, and a
  narrow region.
- Diagnose slow or empty turns: timeout, budget, auth/config failure, no-change,
  and rejected-score reasons should remain distinguishable in progress and
  `.codenuke/results.tsv`.

## Non-goals

- Do not weaken scoring, probation guardrails, startup readiness, or behavior
  fence requirements to get more keeps.
- Do not make Codex agents run outside the isolated worktree.
- Do not implement long-run value-proxy validation as part of this refactor.
- Do not delete fake proposer tests; they are the cheap loop smoke path.

## Upfront Decisions

Preserve:

- `run`/`loop` keep/revert semantics and result publication to
  `refs/codenuke/result`.
- The subprocess allowlist for git, tests, typecheck, and fence runner commands.
- The fake applying proposer selected by `CN_PROPOSER_PROVIDER=fake`.
- Redacted progress behavior for raw agent message text by default.

Delete:

- Direct use of `allowlistEnv(process.env)` as the Codex SDK environment.
- Hardcoded proposer timeout and budget in the loop once config resolution owns
  those values.
- Duplicate comments that describe a CLI adapter or full env forwarding when the
  implementation does not do that.

Shim:

- Keep existing env names (`CN_MODEL`, `CN_REASONING_EFFORT`,
  `CN_CODEX_SANDBOX`, `CN_CODEX_APPROVAL_POLICY`) and route them through
  config resolution plus a Codex-specific SDK env builder.
- Keep `ProposerRequest` close to the core schema. The current runtime-only
  `env` field is a migration smell; SDK env/config should move to loop options
  or adapter construction unless the core schema is deliberately evolved.
- Keep silent raw agent text in TTY while adding structured diagnostics that do
  not expose full message content.

Proof matrix:

- Codex option plumbing -> unit tests for config resolution,
  `codexThreadOptions`, and loop request construction.
- Env separation -> tests proving `CN_REASONING_EFFORT` reaches Codex while
  test/typecheck commands still receive only the subprocess allowlist.
- Prompt quality -> snapshot or focused string test for the probation-aware
  reduce prompt.
- Failure visibility -> loop/progress tests for timeout/crash/no-change reasons.
- Dogfood integration -> `CN_SRC=<small-region> CN_REASONING_EFFORT=medium pnpm dogfood 3`.

Stopping rule:

- Stop this refactor when `CN_REASONING_EFFORT=medium` is observably passed to
  Codex, the reduce prompt contains probation constraints, failures are reported
  without leaking raw message text, and the focused tests plus `git diff --check`
  pass.

## Progress

- [x] (2026-05-25 09:10Z) Scanned CLI, loop, proposer, Codex adapter,
  changecost implementer, env/config, progress tests, package scripts, and docs.
- [x] (2026-05-25 09:10Z) Confirmed no running `pnpm dogfood`,
  `scripts/dogfood.mjs`, or `apps/cli/dist/cli.cjs` process was present before
  writing this report.
- [x] (2026-05-25 09:10Z) Reviewed the first plan with the `opencode-ts`
  rubric and found over-extraction, parallel config, and schema drift risks.
- [ ] Implement Codex env/config separation through existing config and
  proposer ownership.
- [ ] Implement probation-aware prompt construction.
- [ ] Add failure and option-propagation tests.
- [ ] Run focused tests and dogfood proof.

## Surprises And Discoveries

- Observation: `CN_REASONING_EFFORT=medium` does not currently affect the reduce
  loop proposer.
  Evidence: `packages/runtime/src/loop/loop.ts:200` passes
  `allowlistEnv(process.env)`, while `packages/core/src/env/index.ts:15` only
  forwards `PATH`, `HOME`, `LANG`, `LC_ALL`, `TMPDIR`, `GIT_DIR`, and
  `GIT_WORK_TREE`. `packages/runtime/src/proposer/codex-agent.ts:61` only sets
  `modelReasoningEffort` when that env key reaches the adapter.
- Observation: changecost and reduce use different Codex env paths.
  Evidence: `packages/runtime/src/periodic/changecost-run.ts:106` passes
  `codexEnv(process.env)`, while reduce passes a narrowed env.
- Observation: the adapter comment says narrow env forwarding would strip Codex
  auth/config, but reduce currently strips those values.
  Evidence: `packages/runtime/src/proposer/codex-agent.ts:8` says full env is
  intentional; `packages/runtime/src/loop/loop.ts:200` contradicts it.
- Observation: the dogfood rejection `probation-diffsize` was predictable from
  prompt shape.
  Evidence: the loop prompt is only `reduce region ${opts.region}` at
  `packages/runtime/src/loop/loop.ts:192`, while probation caps are one source
  file and diffsize 80 in `packages/runtime/src/score/probation.ts:4`.

## Decision Log

- Decision: introduce a Codex-specific env/config builder instead of adding Codex
  keys to the global subprocess allowlist.
  Rationale: test/typecheck/git/fence commands should remain tightly scoped, but
  the SDK needs model, reasoning, sandbox, approval, auth, and Codex app config.
  Date/Author: 2026-05-25 / Codex.
- Decision: do not introduce a standalone `AgentRunConfig` as the target shape.
  Rationale: `ResolvedConfig` already owns proposer timeout/budget and should be
  extended or finished for model/reasoning/sandbox/approval. A parallel config
  object would create drift and violates the opencode-ts consolidation bias.
  Date/Author: 2026-05-25 / Codex.
- Decision: do not add runtime-only `config?` to `ProposerRequest` unless the
  authoritative core schema is changed in the same wave.
  Rationale: `packages/core/src/domain/index.ts` already owns the persisted
  request contract. SDK options and env are adapter/runtime concerns and should
  not leak into the cross-package domain shape by accident.
  Date/Author: 2026-05-25 / Codex.
- Decision: keep raw agent messages suppressed by default.
  Rationale: the current progress tests intentionally avoid leaking agent text;
  diagnostics should expose classification, timings, usage, and file counts
  instead.
  Date/Author: 2026-05-25 / Codex.
- Decision: prompt constraints belong in runtime loop/proposer ownership, not the
  metric scorer.
  Rationale: the scorer must keep rejecting bad candidates; the proposer prompt
  should reduce wasted attempts before scoring.
  Date/Author: 2026-05-25 / Codex.

## Current Branch State

Done:

- CLI wires `run` and `loop` to `runReduceLoop`.
- The SDK adapter supports `CN_MODEL`, `CN_REASONING_EFFORT`,
  `CN_CODEX_SANDBOX`, and `CN_CODEX_APPROVAL_POLICY` when they are present in
  the env passed to `codexThreadOptions`.
- The reduce loop runs agents in an isolated worktree and discards rejected
  changes.
- Probation scoring rejects oversized, multi-file, public-export, test, config,
  generated, binary, and import-cycle changes.

Scanned surface:

```text
source files scanned by ledger: 44
test files scanned by ledger: 35
docs files scanned by ledger: 6
scripts scanned by ledger: 2
package manifests scanned by ledger: 4
focused line-count surface: 3031 lines
subagent pass: not spawned; policy required explicit user request for parallel agents
```

Known temporary state:

- `ConfigLive` remains a stub, so runtime values are still assembled directly in
  CLI/loop code.
- The current plan treats finishing enough of config resolution as the first
  implementation wave instead of creating a second agent-config path.
- `budgetUsd` exists on `ProposerRequest` but is not plumbed into the SDK call.
- Thread continuity is documented and partially typed but not persisted by the
  loop.
- `promptFile` is always empty in the reduce loop.
- Agent failure errors are swallowed before scoring, so the final row can look
  like an ordinary rejected candidate.

## Context And Orientation

The live reduce path is:

```text
apps/cli/src/main.ts
  -> runReduceLoop(...)
  -> Proposer.propose(req)
  -> CodexProposerLive
  -> makeCodex({ env })
  -> openThread(...)
  -> thread.runStreamed(req.prompt, { signal })
```

The relevant ownership split should remain:

- `packages/core/src/env/index.ts`: narrow environment policy for subprocesses.
- `packages/runtime/src/proposer/codex-agent.ts`: Codex SDK environment and
  `ThreadOptions` assembly.
- `packages/runtime/src/proposer/proposer.ts`: proposer port, event mapping,
  SDK stream lifecycle, failure classification.
- `packages/runtime/src/loop/loop.ts`: candidate request construction, worktree
  lifecycle, scoring, keep/revert, and result journaling.
- `apps/cli/src/main.ts`: CLI env parsing and provider selection.
- `packages/runtime/src/periodic/changecost-run.ts`: Codex implementer path for
  benchmark tasks.

The current unsafe efficiency issue is not that the scorer is too strict. The
scorer is doing the right thing by rejecting the observed `ΔL=501` candidate.
The waste is upstream: the agent is not receiving enough constraints or
configuration to produce a candidate that fits the scorer's known admissible
surface.

## Known Remaining Refactor Surfaces

### Codex Env Boundary

Current state: reduce passes `allowlistEnv(process.env)` to `ProposerRequest.env`.
That drops model, reasoning effort, Codex sandbox, approval policy, auth, and
Codex app variables before `codexThreadOptions` sees them.

Risk: setting `CN_REASONING_EFFORT=medium` or `CN_MODEL` appears to work from
the shell but silently has no effect on reduce-loop agents.

Mitigation: add a Codex-specific SDK env builder in
`packages/runtime/src/proposer/codex-agent.ts` first, where it has a direct
caller. Extract it to a separate file only after a second real caller appears.
Keep `allowlistEnv` for OS subprocesses.

### Agent Config Ownership

Current state: `DEFAULT_PROPOSER_TIMEOUT_MS` and `DEFAULT_PROPOSER_BUDGET_USD`
exist in config, but the loop hardcodes `900_000` and `"8"`.

Risk: dogfood remains expensive and changes require source edits rather than
env/config overrides.

Mitigation: extend the existing config path instead of adding `AgentRunConfig`.
`ResolvedConfig` already owns proposer timeout and budget; add model,
reasoning effort, sandbox, and approval there or in a narrow nested proposer
config if the shape becomes noisy. Until full `ConfigLive` is implemented, use a
small pure resolver in `packages/runtime/src/config/config.ts` with an explicit
deletion condition.

### Prompt Construction

Current state: the prompt is `reduce region ${opts.region}`.

Risk: the model makes large edits, touches public API, runs many commands, or
changes tests/config, all of which the scorer then rejects.

Mitigation: construct a probation-aware prompt with explicit constraints,
expected output, and stop conditions. Include the selected region, target
surface, scorer guardrails, and current attempt budget.

### Thread Continuity

Current state: the adapter honors `req.threadId`, but the reduce loop never
reads or writes proposer thread state.

Risk: every iteration pays for fresh repo exploration and loses context about
previously rejected candidates.

Mitigation: evolve the existing `ProposerThreadState` schema in
`packages/core/src/domain/index.ts` instead of inventing a second record shape.
If baseline awareness is needed, add it to the schema deliberately and include
migration/backward-read behavior for schema version 1.

### Failure Classification And Observability

Current state: `ProposerTimeout`, `ProposerBudgetExceeded`, and `ProposerFailed`
types exist, but the live adapter currently maps aborts and SDK errors to
generic `ProposerFailed`, and the loop catches all proposer errors.

Risk: timeout, auth failure, SDK crash, budget overrun, and no-op turn collapse
into a later score rejection or no-change attempt.

Mitigation: map abort signals to `ProposerTimeout`, budget messages to
`ProposerBudgetExceeded` when the SDK cannot enforce budget directly, and write
the proposer failure class to progress/results.

### Dogfood Ergonomics

Current state: `scripts/dogfood.mjs` caps iterations at 1-5, which is good for
the short-run gate, but it has no convenience flags for small region, reasoning,
or fast timeout.

Risk: users run the broad default `packages` region and wait several minutes for
oversized rejected candidates.

Mitigation: document and optionally add env presets for `CN_SRC`, timeout, model,
and reasoning effort. Keep the default safe, but make useful dogfood attempts
easy to reproduce.

## Target Shape

The target is one explicit agent request assembly path with no parallel config
or request schema:

```text
loop owns: region, mode, candidate policy, worktree, scorer context
Config/ResolvedConfig owns: model, reasoning effort, sandbox, approval, timeout, budget
proposer adapter owns: SDK env, thread options, streaming, failures, usage
scorer owns: tests, typecheck, artifacts, guardrails, keep/revert verdict
```

Decision rule:

```text
Add Codex env helpers in codex-agent.ts first; extract only after reuse.
Use allowlistEnv only for codenuke-owned OS subprocesses.
Use probation prompt constraints whenever artifacts.confidence !== "validated".
Use persisted thread ids only through the core ProposerThreadState schema.
Stop and open a follow-up if SDK budget enforcement needs an unsupported API.
```

## Interfaces And Shims

```ts
// packages/runtime/src/config/config.ts
export interface ResolvedConfig {
  readonly proposerTimeoutMs: number
  readonly proposerBudgetUsd: string
  readonly proposerModel?: string
  readonly proposerReasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh"
  readonly codexSandboxMode: "read-only" | "workspace-write" | "danger-full-access"
  readonly codexApprovalPolicy: "on-request" | "on-failure" | "untrusted" | "never"
}
```

```ts
// packages/runtime/src/proposer/codex-agent.ts
export declare const codexSdkEnv: (
  parent: Record<string, string | undefined>,
  extra?: Record<string, string>,
) => Record<string, string>
```

```ts
// Keep in packages/runtime/src/loop/loop.ts first. Extract only when reuse
// appears or tests become awkward without a named pure function.
export interface ReducePromptInput {
  readonly region: string
  readonly target: string
  readonly probation: boolean
  readonly maxFiles: number
  readonly maxDiffsize: number
  readonly attempt: number
  readonly totalAttempts: number
}

export declare const buildReducePrompt: (input: ReducePromptInput) => string
```

```ts
// packages/runtime/src/proposer/proposer.ts
// Keep aligned with packages/core/src/domain/index.ts unless both are changed.
// Target shape removes the current runtime-only `env` drift.
export interface ProposerRequest {
  readonly mode: ProposerMode
  readonly prompt: string
  readonly promptFile: string
  readonly repo: string
  readonly worktree: string
  readonly regionKey: string
  readonly regionTarget: string
  readonly timeoutMs: number
  readonly budgetUsd: string
  readonly threadId?: string
}
```

```ts
// packages/core/src/domain/index.ts
// Evolve this existing schema if baseline-aware thread persistence is required.
export const ProposerThreadEntry = Schema.Struct({
  threadId: Schema.String,
  createdAt: Schema.String,
  lastUsedAt: Schema.String,
  baselineSha: Schema.optional(Sha40),
})

export const ProposerThreadState = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  provider: Schema.Literal("codex-sdk"),
  threads: Schema.Record({ key: Schema.String, value: ProposerThreadEntry }),
})
```

These sketches intentionally do not change scorer contracts. The scorer should
continue to reject any candidate that violates guardrails, regardless of how the
prompt was constructed.

## Migration Steps

1. Extend config resolution for proposer/Codex knobs.

   Risk: creating a second config path while `ConfigLive` is still incomplete.
   Mitigation: add pure config helpers in `packages/runtime/src/config/config.ts`
   and wire the loop from resolved config fields. Mark any interim env resolver
   with a deletion condition tied to `ConfigLive`.
   Proof:
   `pnpm test packages/runtime/test/config.test.ts`

2. Add Codex SDK env separation in proposer ownership.

   Risk: accidentally forwarding too much env or forwarding Codex keys to
   subprocesses.
   Mitigation: keep the helper in `codex-agent.ts`, use an explicit reviewed
   allowlist plus only narrowly documented prefixes, and add tests proving
   `allowlistEnv` still excludes Codex keys.
   Proof: a focused loop test with `CN_REASONING_EFFORT=medium` reaching
   `codexThreadOptions`.

3. Replace the weak reduce prompt.

   Risk: over-constraining the model can produce no-op attempts.
   Mitigation: start inline in `loop.ts` if readable. Extract
   `buildReducePrompt` only when the test would otherwise need to mock the loop
   or the prompt is reused by another proposer path.
   Proof: prompt test plus dogfood run on a narrow region.

4. Classify proposer failures before scoring.

   Risk: changing loop control flow can break fail-closed behavior.
   Mitigation: still score after failure only if the worktree might contain
   changes; otherwise record `proposer-failed:<class>` and discard.
   Proof: loop-progress tests for crash, timeout, and no-change.

5. Add thread-state persistence through the existing core schema.

   Risk: resuming stale conversations across baselines can produce irrelevant
   edits.
   Mitigation: update `ProposerThreadState` deliberately, include schema-version
   handling, and keep baseline invalidation in the runtime reader/writer.
   Proof: unit tests matching `docs/spec/BEHAVIOR_CONTRACT.md` RULE-057.

6. Improve dogfood affordances.

   Risk: dogfood becomes a separate execution path from real `run`.
   Mitigation: dogfood should only set env defaults and call the built CLI.
   Proof: package-script test plus one real `pnpm dogfood 3` after artifacts are
   ready.

## Concrete Steps

```sh
cd /Users/pedroproenca/Documents/Projects/codenuke
pnpm test packages/runtime/test/proposer.test.ts packages/runtime/test/config.test.ts
```

Expected: focused proposer/config tests pass after config and SDK env helpers are
added.

```sh
cd /Users/pedroproenca/Documents/Projects/codenuke
CN_SRC=packages/core/src/measure CN_REASONING_EFFORT=medium pnpm dogfood 3
```

Expected: dogfood prints a run using a narrow region; proposer options should
include medium reasoning by testable construction, even if all candidates are
still rejected by the scorer.

```sh
cd /Users/pedroproenca/Documents/Projects/codenuke
git diff --check
```

Expected: no whitespace errors.

## Audit Checklist

Before calling this refactor complete:

- `rg -n "env: allowlistEnv\\(process.env\\)" packages/runtime/src/loop`
  returns no reduce-loop Codex request construction.
- `rg -n "timeoutMs: 900_000|budgetUsd: \"8\"" packages/runtime/src/loop`
  returns no hardcoded proposer config after config wiring lands.
- `rg -n "reduce region \\$\\{opts.region\\}" packages/runtime/src/loop`
  returns no weak prompt construction.
- `CN_REASONING_EFFORT=medium` is covered by a test that reaches
  `modelReasoningEffort`.
- No implementation introduces a standalone `AgentRunConfig` while
  `ResolvedConfig` can own the fields.
- `ProposerRequest` remains aligned with the core schema, or the runtime and
  core schemas are changed together with tests.
- The current runtime-only `ProposerRequest.env` field is removed, or its
  retention is justified by a matching core schema change.
- Thread persistence uses `ProposerThreadState`; no separate record file/schema
  is introduced.
- Proposer timeout/crash/no-change outcomes appear in tests or progress
  snapshots without leaking full agent message text.
- The fake proposer smoke path still works.

## Verification Commands

Docs-only report validation:

```sh
git diff --check
```

Focused implementation validation:

```sh
pnpm test packages/runtime/test/proposer.test.ts packages/runtime/test/config.test.ts packages/runtime/test/loop-progress.test.ts
```

Broader runtime validation:

```sh
pnpm test packages/runtime/test/probation.test.ts packages/runtime/test/score.test.ts packages/runtime/test/startup-gate.test.ts
pnpm typecheck
```

Dogfood validation:

```sh
CN_SRC=packages/core/src/measure CN_REASONING_EFFORT=medium pnpm dogfood 3
```

## Idempotence And Recovery

- Retry: env/config and prompt helper tests are pure and can be rerun without
  modifying artifacts.
- Recovery: if a real dogfood run starts producing broad edits, interrupt it and
  rely on the loop's isolated worktree plus discard/revert behavior. Do not
  merge `refs/codenuke/result` unless reviewing kept commits first.
- Dirty worktree: keep docs/report edits separate from code changes. When
  implementing, stage only touched refactor files and never reset unrelated
  local changes.
- Process cleanup: use an exact process scan for `scripts/dogfood.mjs`,
  `apps/cli/dist/cli.cjs`, and `pnpm.*dogfood`; avoid killing Codex Desktop
  app-server processes unless the owning thread is known.

## Artifacts And Notes

Relevant files:

- `packages/runtime/src/loop/loop.ts`
- `packages/runtime/src/proposer/proposer.ts`
- `packages/runtime/src/proposer/codex-agent.ts`
- `packages/runtime/src/periodic/changecost-run.ts`
- `packages/core/src/env/index.ts`
- `apps/cli/src/main.ts`
- `scripts/dogfood.mjs`
- `packages/runtime/test/proposer.test.ts`
- `packages/runtime/test/loop-progress.test.ts`
- `docs/spec/INTERFACE_CONTRACTS.md`
- `docs/spec/BEHAVIOR_CONTRACT.md`

Observed process cleanup scan before report writing:

```text
No running pnpm dogfood, scripts/dogfood.mjs, or apps/cli/dist/cli.cjs process.
Codex Desktop app-server processes were present and intentionally not killed.
```

## Outcomes And Retrospective

Initial report only. No runtime code has been changed in this wave.
