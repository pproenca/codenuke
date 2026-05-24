---
summary: "Refactor plan for moving proposer execution to the Codex SDK while making fence progress live and inspectable."
read_when:
  - Replacing codex exec subprocess proposer calls with the Codex SDK
  - Making codenuke fence output explain what is happening during long audits
  - Debugging proposer thread state, fence-raise turns, or blocked-region UX
  - Reviewing whether agent orchestration is leaking into deterministic scoring
title: "Codex SDK and fence observability refactor"
sidebarTitle: "Codex SDK fence"
---

# Codex SDK and fence observability refactor

codenuke should move Codex interaction behind a typed proposer adapter and make
the deterministic fence audit explain itself while it runs. These are related
because both show up in the same user workflow, but they should not collapse
into one mechanism.

Desired runtime shape:

```text
codenuke run
  -> resolve config, worktree, artifacts, and scoring gates locally
  -> select reduce or raise-fence mode
  -> call a typed proposer adapter
  -> validate dirty paths, tests, typecheck, fence, and value locally
  -> keep or revert locally

codenuke fence
  -> resolve config and print it
  -> create an isolated worktree
  -> run baseline tests
  -> scan mutation sites
  -> mutate one site, run tests, restore source, repeat
  -> write .codenuke/fence-fidelity.json incrementally
```

Codex may propose edits. Codex must not own mutation accounting, artifact
validity, path guards, scorer decisions, git keep/revert policy, or trusted-repo
command execution policy.

## Diagnosis

The current fence command is correct but quiet. It buffers most output in memory
and returns it at the end. During the expensive phase, the user cannot tell
whether codenuke is creating a worktree, running baseline tests, scanning files,
or repeatedly executing the test command for sampled mutants.

The previous proposer path was subprocess-shaped. `runProposer` wrote the prompt
file, then either ran a trusted `CN_PROPOSER` shell string or called the Codex
CLI substrate. That kept behavior simple, but it hid useful agent state:

- no durable Codex thread id
- no explicit resume model for interrupted proposer turns
- no structured proposer result beyond process success/failure
- no clean place to display "Codex is working on raise-fence for region X"
- no adapter boundary that can support both Codex CLI rollback and Codex SDK proposer

The target is not "make fence an agent." The target is:

- fence becomes live, deterministic, and inspectable
- Codex interaction becomes typed, resumable, and replaceable
- the scorer remains local and immutable from the candidate tree

## Boundaries

Deterministic codenuke code owns:

- config resolution from `CN_*`, `codenuke.loop.json`, and auto-detection
- git worktree creation and cleanup
- allowed edit surface enforcement
- mutation site discovery, sampling, replay, and Wilson lower-bound math
- `.codenuke/fence-fidelity.json`, calibration, value-proxy, and result rows
- test, typecheck, artifact validation, and keep/revert gates
- trusted-repo warnings for configured external argv commands

Codex SDK proposer owns:

- starting or resuming a Codex thread for one proposer turn
- sending reduce and raise-fence prompts
- running inside the isolated candidate worktree
- returning a typed turn summary, thread id, and raw result metadata
- surfacing agent-level failure, timeout, cancellation, or no-result states

The SDK adapter must not bypass codenuke's path guards. A successful SDK turn
only means "Codex finished"; codenuke still decides whether the resulting dirty
tree is admissible.

## Target Interfaces

Introduce a proposer adapter boundary in the owning orchestrator package:

```ts
export type ProposerMode = "reduce" | "raise-fence";

export interface ProposerRequest {
  readonly mode: ProposerMode;
  readonly prompt: string;
  readonly repo: string;
  readonly worktree: string;
  readonly regionKey: string;
  readonly regionTarget: string;
  readonly timeoutMs: number;
  readonly budgetUsd: string;
  readonly threadId?: string;
  readonly env: NodeJS.ProcessEnv;
}

export interface ProposerResult {
  readonly ok: boolean;
  readonly provider: "codex-cli" | "codex-sdk";
  readonly threadId?: string;
  readonly summary?: string;
  readonly out: string;
  readonly timedOut?: boolean;
  readonly error?: string;
  readonly usage?: Usage | null;
  readonly elapsedMs?: number;
  readonly commandEvents?: readonly CommandExecutionItem[];
  readonly fileChanges?: readonly FileChangeItem[];
}

export interface ProposerAdapter {
  propose(request: ProposerRequest): Promise<ProposerResult>;
}
```

Keep two adapters during migration:

```text
CodexCliProposerAdapter  temporary CN_CODEX_PROVIDER=cli rollback
CodexSdkProposerAdapter  new @openai/codex-sdk behavior
```

Selection should be explicit:

```text
CN_CODEX_PROVIDER=cli    use Codex CLI adapter
CN_CODEX_PROVIDER=sdk    use Codex SDK adapter
default                  use Codex SDK adapter
```

`CN_PROPOSER` is intentionally rejected. Tests and local experiments should use
the in-process proposer adapter boundary instead of reintroducing shell strings.

## Thread State

Persist proposer thread state separately from scorer facts. The loop may use
thread ids to resume Codex context, but scorer decisions must remain derivable
from source, artifacts, config, and command results.

Candidate state shape:

```ts
type ProposerThreadState = {
  readonly schemaVersion: 1;
  readonly provider: "codex-sdk";
  readonly threads: Record<
    string,
    {
      readonly threadId: string;
      readonly mode: "reduce" | "raise-fence";
      readonly regionKey: string;
      readonly regionTarget: string;
      readonly createdAt: string;
      readonly lastUsedAt: string;
    }
  >;
};
```

Store it under `.codenuke/proposer-threads.json` or embed it in the existing
state file only if that does not make scorer state harder to audit.

Thread keys should be stable and boring:

```text
raise-fence:packages/config
reduce:packages/config
```

If a thread cannot be resumed, start a new one and record that fact in
`results.tsv` or the live log. Do not fail a deterministic candidate merely
because agent context could not be resumed.

## Fence Output Contract

`codenuke fence` should print live output, not just return a buffered report.
The first screen should reveal the exact target:

```text
fence audit
repo: /Users/pedroproenca/Documents/Projects/codenuke
baseline: HEAD -> 9f2fc48
source: packages
target: packages
regions: config, exec, fence, scorer
test command: pnpm test
worktree: /tmp/codenuke-run-packages-fence
artifact: .codenuke/fence-fidelity.json
cap: 60 mutations/region
seed: 1337
```

Then print phase logs:

```text
[1/6] resolving baseline
[2/6] creating isolated worktree
[3/6] checking baseline tests
[4/6] scanning mutation sites
[5/6] running mutation audit
[6/6] writing fence artifact
```

The mutation phase should say what the loop is doing:

```text
[5/6] running mutation audit: 0/180 complete
  config  12/60  caught=10 survivors=2 elapsed=84s avg=7.0s/test eta=19m36s
  exec    pending
  fence   pending
```

A finished region should explain the result:

```text
== config
mutations tested: 60
caught by tests: 55
survived: 5
fence score: 91.7%
confidence lower bound: 82.1%
threshold: 90.0%
status: BLOCKED

meaning: tests missed 5 behavior changes. codenuke may add characterization
tests before reducing this region.
```

Show the first few survivors when blocked:

```text
survivors:
  packages/config/src/main/config.ts:91 operator === -> !==
  packages/config/src/main/config.ts:174 operator && -> ||
  ... 3 more in .codenuke/fence-fidelity.json
```

This output should be available in normal TTY usage. JSON or quiet modes can
come later, but they should not be a prerequisite for fixing the default UX.

## Event Sink

Avoid sprinkling raw `console.log` calls through fence and orchestrator code.
Introduce a small event sink that can write live text now and structured events
later:

```ts
export type RuntimeEvent =
  | { readonly type: "phase"; readonly label: string; readonly index: number; readonly total: number }
  | { readonly type: "config"; readonly key: string; readonly value: string }
  | { readonly type: "region-plan"; readonly region: string; readonly sites: number; readonly sampled: number }
  | { readonly type: "mutation-progress"; readonly region: string; readonly done: number; readonly total: number; readonly caught: number; readonly survivors: number; readonly elapsedMs: number }
  | { readonly type: "region-result"; readonly region: string; readonly caught: number; readonly total: number; readonly lo: number; readonly threshold: number; readonly admissible: boolean }
  | { readonly type: "proposer-start"; readonly provider: string; readonly mode: string; readonly region: string; readonly threadId?: string }
  | { readonly type: "proposer-result"; readonly provider: string; readonly ok: boolean; readonly summary?: string; readonly threadId?: string };

export interface RuntimeReporter {
  emit(event: RuntimeEvent): void;
}
```

The initial implementation can render plain text. Tests can use an in-memory
reporter and assert important events without depending on every line of prose.

## Work Packages

1. Add live fence reporting.
   Create a `RuntimeReporter`, wire `auditFence` to emit config, phase, plan,
   progress, and result events, and keep the existing returned stdout contract
   for tests and callers.

2. Improve fence result wording.
   Replace terse region summaries with caught/survived/lower-bound/threshold
   fields and show a capped survivor preview for blocked regions.

3. Extract proposer adapter.
   Move `runProposer` behavior behind `ProposerAdapter`. Reject `CN_PROPOSER`
   shell strings and keep the direct Codex CLI path only behind
   `CN_CODEX_PROVIDER=cli`.

4. Make the Codex SDK adapter the default.
   Add the SDK dependency only when the packaging and runtime surface are clear.
   The adapter should start or resume a thread, run one prompt with
   `runStreamed()`, and return a typed result with usage and event telemetry. It
   should not score, stage, commit, or clean paths.

5. Persist SDK thread ids.
   Store thread ids per mode and region. Log whether a turn is new or resumed.
   Treat resume failure as an agent-context miss, not as scorer evidence.

6. Wire live proposer status into `run`.
   Print provider, mode, region, thread id, prompt path, and result summary
   around reduce and raise-fence proposer turns.

7. Report command and SDK cost.
   Surface token usage, elapsed wall time, command counts, file changes,
   timeout state, and budget exhaustion in loop output and result rows where
   applicable.

## Acceptance Rules

The refactor is healthy only if these remain true:

- `codenuke fence` tells the user which repo, source, target, regions, test
  command, worktree, cap, seed, and artifact it is using before expensive work.
- During mutation audit, the user sees live progress at least once per region
  and at least every 10 sampled mutations.
- Fence artifacts remain deterministic for the same baseline, cap, seed, and
  source tree.
- Codex SDK success never bypasses source/test path guards.
- Scorer behavior is unchanged for the same candidate tree and artifacts.
- `CN_PROPOSER` shell strings remain rejected.
- The Codex CLI adapter remains available only as `CN_CODEX_PROVIDER=cli`
  rollback for one compatibility window.
- Long-running proposer thread ids are observable in logs and persisted state.

Stop and redesign if:

- fence output is only visible after the command exits
- Codex SDK code reaches into scorer or artifact validation
- thread state becomes required to explain a keep/revert decision
- SDK adoption changes public CLI behavior without an opt-in migration period
- the package tarball grows or fails smoke because SDK runtime files are not
  bundled deliberately

## Proof Plan

Focused proof for fence output:

```sh
pnpm --filter @codenuke/fence test
pnpm --filter @codenuke/orchestrator test
pnpm typecheck
```

Focused proof for SDK adapter extraction:

```sh
pnpm --filter @codenuke/orchestrator test
pnpm typecheck
pnpm build
```

Package proof before making SDK the default:

```sh
rm -rf /tmp/codenuke-pack /tmp/codenuke-cli-install
mkdir -p /tmp/codenuke-pack /tmp/codenuke-cli-install
pnpm build
npm pack ./apps/cli --pack-destination /tmp/codenuke-pack
npm install --prefix /tmp/codenuke-cli-install /tmp/codenuke-pack/codenuke-0.4.0.tgz
/tmp/codenuke-cli-install/node_modules/.bin/codenuke --version
```

Dogfood proof:

```sh
CN_SRC=packages CN_TARGET=packages pnpm dogfood 1
```

The first SDK dogfood should run with an explicit opt-in:

```sh
CN_CODEX_PROVIDER=sdk CN_SRC=packages CN_TARGET=packages pnpm dogfood 1
```

Do not use dogfood success alone as release proof. It proves the workflow is
usable; typecheck, build, tests, and package smoke prove the shipped CLI.
