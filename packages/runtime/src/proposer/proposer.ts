/**
 * Proposer port ("use code-sdk") — architecture §5.
 *
 * Owns RULE-039(part), RULE-042, RULE-047 (subprocess mgmt + failure class),
 * RULE-057 (thread continuity), RULE-058 (budget).
 *
 * Ships ONE live adapter (`CodexProposerLive`, stub over @openai/codex-sdk) plus
 * a deterministic `FakeProposerLive` test double that emits a scripted event
 * stream and "applies a scripted patch" — so loop tests can run with no model.
 *
 * Cross-package contract: `ProposerRequest`, `ProposerResult`,
 * `ProposerThreadEntry`, `ProposerThreadState`, `ProposerTimeout` come from
 * `@codenuke/core`. We re-state the request/result shapes locally (matching
 * INTERFACE_CONTRACTS) so the port compiles before core exists; the live wiring
 * should import core's types directly.
 */
import type { ThreadEvent } from "@openai/codex-sdk"
import { FileSystem, Path } from "@effect/platform"
import { Context, Data, Effect, Layer, Option, Stream } from "effect"
import {
  type ResolvedProposerConfig,
  resolveProposerConfig,
} from "../config/config.ts"
import { codexSdkEnv, makeCodex, openThread } from "./codex-agent.ts"

// ---------------------------------------------------------------------------
// Constants (preserved exactly). The proposer-timeout / budget defaults are the
// authoritative copies in ../config/config.ts (DEFAULT_PROPOSER_TIMEOUT_MS /
// DEFAULT_PROPOSER_BUDGET_USD); here we expose only the proposer-local knobs to
// avoid duplicate-export collisions in the package barrel.
// ---------------------------------------------------------------------------
export const SIGTERM_GRACE_MS = 1_000 // RULE-047 SIGTERM→SIGKILL grace
export const HEARTBEAT_MS = 15_000 // RULE-047 heartbeat

// ---------------------------------------------------------------------------
// Local error fallback (authoritative `ProposerTimeout` lives in core).
// ---------------------------------------------------------------------------
export class ProposerTimeout extends Data.TaggedError("ProposerTimeout")<{
  readonly mode: string
  readonly elapsedMs: number
}> {}

export class ProposerBudgetExceeded extends Data.TaggedError("ProposerBudgetExceeded")<{
  readonly budgetUsd: string
}> {}

export class ProposerFailed extends Data.TaggedError("ProposerFailed")<{
  readonly message: string
  /** RULE-047 failure class: crash | crash-timeout | crash-budget */
  readonly failureClass: "crash" | "crash-timeout" | "crash-budget"
}> {}

export type ProposerError = ProposerTimeout | ProposerBudgetExceeded | ProposerFailed

// ---------------------------------------------------------------------------
// Request / result shapes (mirror INTERFACE_CONTRACTS proposer.ts:17,32).
// ---------------------------------------------------------------------------
export type ProposerMode = "reduce" | "raise-fence"

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
  readonly threadID?: string
}

/** RULE-047 — the streamed SDK events become ProgressEvent.ProposerEvent. */
export type ProposerEvent =
  | { readonly _tag: "CommandExecution"; readonly command: string }
  | { readonly _tag: "FileChange"; readonly path: string }
  | { readonly _tag: "AgentMessage"; readonly text: string }
  | { readonly _tag: "TurnCompleted"; readonly usage?: ProposerUsage; readonly threadID?: string }
  | { readonly _tag: "TurnFailed"; readonly error: string }

export interface ProposerUsage {
  readonly input_tokens: number
  readonly cached_input_tokens: number
  readonly output_tokens: number
  readonly reasoning_output_tokens: number
}

// ---------------------------------------------------------------------------
// Proposer port (Context.Tag).
// ---------------------------------------------------------------------------
export class Proposer extends Context.Tag("@codenuke/runtime/Proposer")<
  Proposer,
  {
    readonly propose: (req: ProposerRequest) => Stream.Stream<ProposerEvent, ProposerError>
  }
>() {}

// ---------------------------------------------------------------------------
// CodexProposerLive — the ONE live adapter (STUB over @openai/codex-sdk).
// ---------------------------------------------------------------------------
/*
 * Real implementation (selected by CN_CODEX_PROVIDER):
 *   import { Codex } from "@openai/codex-sdk"
 *   const codex = new Codex({ env: allowlistEnv(req.env) })
 *   const thread = req.threadID
 *     ? codex.resumeThread(req.threadID, opts)
 *     : codex.startThread(opts)            // opts: workingDirectory=worktree,
 *                                          // sandboxMode, approvalPolicy, model
 *   const streamed = thread.runStreamed(req.prompt, { signal })
 *   // map streamed.events → ProposerEvent (item.completed:command_execution →
 *   // CommandExecution; file_change → FileChange; agent_message → AgentMessage;
 *   // turn.completed → TurnCompleted; turn.failed/error → fail ProposerFailed)
 *   // AbortController aborts after req.timeoutMs → fail ProposerTimeout (RULE-047)
 *   // RULE-057 thread continuity persisted via the artifacts layer.
 */
/**
 * RULE-047 — map an SDK ThreadEvent to a ProposerEvent (or drop it). Shaped for
 * `Stream.filterMapEffect`: `Option.none()` drops; `Option.some(Effect)` keeps (and
 * may fail the turn for turn.failed/error).
 */
const mapEvent = (ev: ThreadEvent, threadID?: string | null): Option.Option<Effect.Effect<ProposerEvent, ProposerError>> => {
  switch (ev.type) {
    case "item.completed": {
      const item = ev.item
      if (item.type === "command_execution") {
        return Option.some(Effect.succeed({ _tag: "CommandExecution", command: item.command } satisfies ProposerEvent))
      }
      if (item.type === "file_change") {
        return Option.some(
          Effect.succeed({ _tag: "FileChange", path: item.changes.map((c) => c.path).join(", ") } satisfies ProposerEvent),
        )
      }
      if (item.type === "agent_message") {
        return Option.some(Effect.succeed({ _tag: "AgentMessage", text: item.text } satisfies ProposerEvent))
      }
      return Option.none()
    }
    case "turn.completed":
      return Option.some(
        Effect.succeed({
          _tag: "TurnCompleted",
          usage: ev.usage,
          ...(threadID ? { threadID } : {}),
        } satisfies ProposerEvent),
      )
    case "turn.failed":
      return Option.some(Effect.fail(new ProposerFailed({ message: ev.error.message, failureClass: "crash" })))
    case "error":
      return Option.some(Effect.fail(new ProposerFailed({ message: ev.message, failureClass: "crash" })))
    default:
      return Option.none()
  }
}

/** RULE-039/042 — inject region context into the Codex SDK env. */
export const proposerEnv = (
  parent: Record<string, string | undefined>,
  req: ProposerRequest,
): Record<string, string> => codexSdkEnv(parent, {
  CN_REGION: req.regionKey,
  CN_TARGET: req.regionTarget,
})

/**
 * CodexProposerLive — the REAL adapter over @openai/codex-sdk. Starts/resumes a
 * thread in the worktree, streams the turn, maps events → ProposerEvent, and
 * aborts after `timeoutMs` (RULE-047). The agent edits files in `workingDirectory`
 * (= the worktree), which is what the loop measures. Thread continuity (RULE-057
 * persistence) is a follow-up; `req.threadID` is honored when supplied.
 */
const classifyProposerError = (
  error: unknown,
  req: ProposerRequest,
  aborted: boolean,
): ProposerError => {
  const message = error instanceof Error ? error.message : String(error)
  if (aborted || error instanceof DOMException && error.name === "AbortError" || /abort/i.test(message)) {
    return new ProposerTimeout({ mode: req.mode, elapsedMs: req.timeoutMs })
  }
  if (/budget|spend|cost/i.test(message)) {
    return new ProposerBudgetExceeded({ budgetUsd: req.budgetUsd })
  }
  return new ProposerFailed({ message, failureClass: "crash" })
}

export const makeCodexProposerLive = (opts: {
  readonly env: Record<string, string | undefined>
  readonly config: ResolvedProposerConfig
}): Layer.Layer<Proposer> =>
  Layer.succeed(
    Proposer,
    Proposer.of({
      propose: (req) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const client = yield* makeCodex({ env: proposerEnv(opts.env, req) })
            const thread = openThread(client, opts.config, req.worktree, req.threadID)
            const controller = new AbortController()
            let timedOut = false
            const timer = setTimeout(() => {
              timedOut = true
              controller.abort()
            }, req.timeoutMs)
            timer.unref?.()
            const streamed = yield* Effect.tryPromise({
              try: () => thread.runStreamed(req.prompt, { signal: controller.signal }),
              catch: (e) => classifyProposerError(e, req, timedOut),
            })
            return Stream.fromAsyncIterable(
              streamed.events,
              (e) => classifyProposerError(e, req, timedOut),
            ).pipe(
              Stream.filterMapEffect((ev) => mapEvent(ev, thread.id)),
              Stream.ensuring(Effect.sync(() => clearTimeout(timer))),
            )
          }),
        ),
    }),
  )

const defaultConfig = resolveProposerConfig(process.env)

export const CodexProposerLive: Layer.Layer<Proposer> =
  defaultConfig instanceof Error
    ? Layer.succeed(
        Proposer,
        Proposer.of({
          propose: () =>
            Stream.fail(
              new ProposerFailed({
                message: defaultConfig.message,
                failureClass: "crash",
              }),
            ),
        }),
      )
    : makeCodexProposerLive({ env: process.env, config: defaultConfig })

// ---------------------------------------------------------------------------
// FakeProposerLive — deterministic double. USABLE: emits a scripted stream.
// ---------------------------------------------------------------------------
export interface FakeScript {
  /** Files the scripted "patch" touches, surfaced as FileChange events. */
  readonly fileChanges?: readonly string[]
  /** Commands the agent "ran", surfaced as CommandExecution events. */
  readonly commands?: readonly string[]
  /** Final agent message text. */
  readonly finalMessage?: string
  /** Usage reported on TurnCompleted. */
  readonly usage?: ProposerUsage
  readonly threadID?: string
  /** If set, the turn fails with this message (failureClass "crash"). */
  readonly fail?: string
}

/**
 * Build a deterministic ProposerEvent stream from a script. Order is fixed:
 * CommandExecution* → FileChange* → AgentMessage(final) → TurnCompleted, or a
 * single failed TurnFailed (+ ProposerFailed error) when `fail` is set.
 */
export const fakeProposerStream = (
  script: FakeScript,
): Stream.Stream<ProposerEvent, ProposerError> => {
  if (script.fail !== undefined) {
    const message = script.fail
    return Stream.fail(new ProposerFailed({ message, failureClass: "crash" }))
  }
  const events: ProposerEvent[] = []
  for (const command of script.commands ?? []) {
    events.push({ _tag: "CommandExecution", command })
  }
  for (const path of script.fileChanges ?? []) {
    events.push({ _tag: "FileChange", path })
  }
  if (script.finalMessage !== undefined) {
    events.push({ _tag: "AgentMessage", text: script.finalMessage })
  }
  events.push({ _tag: "TurnCompleted", usage: script.usage, ...(script.threadID ? { threadID: script.threadID } : {}) })
  return Stream.fromIterable(events)
}

/**
 * A FakeProposer Layer that always replays the SAME scripted stream regardless
 * of request — handy for the "loop tests could run" smoke test. For
 * request-dependent scripts, build a layer over a Map<regionKey, FakeScript>.
 */
export const makeFakeProposerLive = (script: FakeScript): Layer.Layer<Proposer> =>
  Layer.succeed(
    Proposer,
    Proposer.of({
      propose: () => fakeProposerStream(script),
    }),
  )

/** Default fake: applies a one-file scripted reduction. */
export const FakeProposerLive = makeFakeProposerLive({
  commands: [],
  fileChanges: ["src/example.ts"],
  finalMessage: "Removed one redundant statement (behavior-preserving).",
  usage: {
    input_tokens: 100,
    cached_input_tokens: 0,
    output_tokens: 20,
    reasoning_output_tokens: 0,
  },
})

/**
 * An APPLYING fake proposer — unlike the event-only fakes above, this one really
 * EDITS the worktree, so the loop can measure a real reduction and exercise
 * keep/revert. On each turn it removes the FIRST line containing `marker` from
 * `<worktree>/<rel>` (a deterministic behavior-preserving-ish reduction). When no
 * marked line remains it makes NO change (→ ΔL=0 → the loop reverts and stops).
 *
 * FileSystem/Path are captured at layer build so `propose`'s stream is `R = never`,
 * matching the port. Used by loop smokes/tests with no live model.
 */
export const makeApplyingFakeProposerLive = (opts: {
  readonly rel: string
  readonly marker: string
}): Layer.Layer<Proposer, never, FileSystem.FileSystem | Path.Path> =>
  Layer.effect(
    Proposer,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      const apply = (worktree: string): Effect.Effect<boolean> =>
        Effect.gen(function* () {
          const file = path.join(worktree, opts.rel)
          const content = yield* fs.readFileString(file)
          const lines = content.split("\n")
          const idx = lines.findIndex((l) => l.includes(opts.marker))
          if (idx < 0) return false
          lines.splice(idx, 1)
          yield* fs.writeFileString(file, lines.join("\n"))
          return true
        }).pipe(Effect.orElseSucceed(() => false))

      return Proposer.of({
        propose: (req) =>
          Stream.unwrap(
            apply(req.worktree).pipe(
              Effect.map((changed) =>
                fakeProposerStream({
                  fileChanges: changed ? [opts.rel] : [],
                  finalMessage: changed
                    ? `Removed one '${opts.marker}' line (behavior-preserving).`
                    : "No further reductions found.",
                  usage: {
                    input_tokens: 50,
                    cached_input_tokens: 0,
                    output_tokens: 10,
                    reasoning_output_tokens: 0,
                  },
                }),
              ),
            ),
          ),
      })
    }),
  )
