/**
 * Progress streaming spine — architecture §6.
 *
 * Defines the `ProgressEvent` ADT (tagged union), a PURE NDJSON serializer
 * `toNdjson(ev): string`, and a `ProgressBus` service backed by a bounded
 * `Queue`. Two renderers consume the bus: a TTY renderer (human, color-aware)
 * and an NDJSON renderer (`--json`, one JSON object per line on stdout).
 *
 * The `Scored` event carries the public v2 score envelope. The NDJSON serializer
 * emits that envelope byte-for-byte so JSON consumers get one versioned contract.
 */
import type { ScoreEnvelope } from "@codenuke/core"
import { Context, Effect, Layer, Queue, Stream } from "effect"
import type { ProposerEvent } from "../proposer/proposer.ts"

export type LoopPhase = "proposer" | "tests"

// ---------------------------------------------------------------------------
// ProgressEvent ADT (architecture §6, seeded from fence's RuntimeEvent union).
// ---------------------------------------------------------------------------
export type ProgressEvent =
  | { readonly _tag: "RunStarted"; readonly iterations: number; readonly baselineSha: string }
  | { readonly _tag: "RegionSelected"; readonly region: string; readonly mode: "reduce" | "raise" }
  | { readonly _tag: "IterationStarted"; readonly iter: number; readonly total: number }
  | { readonly _tag: "PhaseStarted"; readonly iter: number; readonly phase: LoopPhase }
  | { readonly _tag: "PhaseFinished"; readonly iter: number; readonly phase: LoopPhase; readonly ok: boolean; readonly ms: number }
  | { readonly _tag: "ProposerEvent"; readonly ev: ProposerEvent }
  | { readonly _tag: "MutationProgress"; readonly region: string; readonly done: number; readonly total: number }
  | { readonly _tag: "Scored"; readonly envelope: ScoreEnvelope }
  | { readonly _tag: "KeptOrReverted"; readonly kept: boolean; readonly reason: string }
  | { readonly _tag: "ArtifactWritten"; readonly path: string; readonly kind: string }
  | { readonly _tag: "RunFinished"; readonly kept: number; readonly reverted: number; readonly iterations: number; readonly reductionPct: number; readonly resultRef: string | null }
  | { readonly _tag: "Heartbeat"; readonly ms: number; readonly iter?: number; readonly phase?: LoopPhase }
  | { readonly _tag: "Message"; readonly level: "info" | "warn" | "error"; readonly text: string }

const cap = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`)

const compactProposerEvent = (ev: ProposerEvent): Record<string, unknown> => {
  switch (ev._tag) {
    case "CommandExecution":
      return { kind: "CommandExecution", command: cap(ev.command, 160) }
    case "FileChange":
      return { kind: "FileChange", path: cap(ev.path, 240) }
    case "TurnCompleted":
      return ev.usage === undefined ? { kind: "TurnCompleted" } : { kind: "TurnCompleted", usage: ev.usage }
    case "TurnFailed":
      return { kind: "TurnFailed", error: cap(ev.error, 160) }
    case "AgentMessage":
      return { kind: "AgentMessage" }
  }
}

// ---------------------------------------------------------------------------
// PURE NDJSON serializer — toNdjson(ev): string.
//
// One JSON object per line (no trailing newline; the renderer appends "\n").
// `Scored` emits the breaking v2 envelope directly, not a flattened Verdict.
// ---------------------------------------------------------------------------
export const toNdjson = (ev: ProgressEvent): string => {
  switch (ev._tag) {
    case "Scored":
      return JSON.stringify(ev.envelope)
    case "ProposerEvent":
      return JSON.stringify({ type: "proposer", ...compactProposerEvent(ev.ev) })
    default:
      return JSON.stringify({ type: toType(ev._tag), ...stripTag(ev) })
  }
}

const toType = (tag: string): string => tag.charAt(0).toLowerCase() + tag.slice(1)

const stripTag = (ev: ProgressEvent): Record<string, unknown> => {
  const { _tag, ...rest } = ev as Record<string, unknown> & { _tag: string }
  return rest
}

// ---------------------------------------------------------------------------
// TTY (human) renderer — PURE line formatter. Color-aware honoring NO_COLOR.
// ---------------------------------------------------------------------------
export const renderTty = (ev: ProgressEvent, color: boolean = false): string => {
  const dim = (s: string) => (color ? `[2m${s}[0m` : s)
  switch (ev._tag) {
    case "RunStarted":
      return `run: ${ev.iterations} iterations @ ${ev.baselineSha.slice(0, 7)}`
    case "RegionSelected":
      return `region: ${ev.region} (${ev.mode})`
    case "IterationStarted":
      return `#${ev.iter}/${ev.total} start`
    case "PhaseStarted":
      return `#${ev.iter} ${ev.phase} started`
    case "PhaseFinished":
      return `#${ev.iter} ${ev.phase} ${ev.ok ? "ok" : "failed"} ${ev.ms}ms`
    case "ProposerEvent":
      return ev.ev._tag === "AgentMessage" ? "" : dim(`proposer: ${ev.ev._tag}`)
    case "MutationProgress":
      return dim(`mutate ${ev.region}: ${ev.done}/${ev.total}`)
    case "Scored": {
      const v = ev.envelope.verdict
      const guardrail = ev.envelope.guardrails.failures[0]
      if (v === null) {
        const reason = guardrail ? ` ${guardrail.code}` : ""
        return `scored: ${ev.envelope.status}${reason}`
      }
      const failed = v.failedGates.length ? ` failed=[${v.failedGates.join(",")}]` : ""
      const guard = guardrail ? ` guardrail=${guardrail.code}` : ""
      return `scored: ${ev.envelope.status} keep=${v.keep} loss=${v.loss ?? "null"}${failed}${guard}`
    }
    case "KeptOrReverted":
      return `${ev.kept ? "KEEP" : "REVERT"}: ${ev.reason}`
    case "ArtifactWritten":
      return dim(`wrote ${ev.kind}: ${ev.path}`)
    case "Heartbeat":
      return dim(`${ev.iter === undefined ? "" : `#${ev.iter} `}${ev.phase ?? "work"} ${ev.ms}ms`)
    case "RunFinished":
      return `run finished: kept=${ev.kept} reverted=${ev.reverted} reduction=${ev.reductionPct.toFixed(1)}%`
    case "Message":
      return `[${ev.level}] ${ev.text}`
  }
}

// ---------------------------------------------------------------------------
// ProgressBus service — bounded Queue (architecture §6: Queue not PubSub).
// ---------------------------------------------------------------------------
export const PROGRESS_BUS_CAPACITY = 1024

interface ProgressEnd {
  readonly _tag: "ProgressEnd"
}

type ProgressQueueItem = ProgressEvent | ProgressEnd

export class ProgressBus extends Context.Tag("@codenuke/runtime/ProgressBus")<
  ProgressBus,
  {
    /** Push a progress event onto the bus (producers). */
    readonly emit: (ev: ProgressEvent) => Effect.Effect<void>
    /** Drain the bus as a Stream (the single active renderer consumes this). */
    readonly stream: Stream.Stream<ProgressEvent>
    /** Signal end-of-stream so the renderer's drain completes. */
    readonly shutdown: Effect.Effect<void>
  }
>() {}

/**
 * ProgressBusLive — a real, usable bounded-Queue bus. (The renderers below
 * consume `stream`.) This is genuinely implemented since it has no IO surface
 * beyond an in-memory Queue.
 */
export const ProgressBusLive = Layer.scoped(
  ProgressBus,
  Effect.gen(function* () {
    const queue = yield* Queue.bounded<ProgressQueueItem>(PROGRESS_BUS_CAPACITY)
    return ProgressBus.of({
      emit: (ev) => Queue.offer(queue, ev).pipe(Effect.asVoid),
      stream: Stream.fromQueue(queue).pipe(
        Stream.takeWhile((ev): ev is ProgressEvent => ev._tag !== "ProgressEnd"),
      ),
      shutdown: Queue.offer(queue, { _tag: "ProgressEnd" }).pipe(Effect.asVoid),
    })
  }),
)

// ---------------------------------------------------------------------------
// Renderers — drain the bus into stdout/stderr. STUBS for the IO (Console
// wiring is in apps/cli); the pure formatters (toNdjson / renderTty) above are
// what tests assert.
// ---------------------------------------------------------------------------

/** NDJSON renderer: stdout = one JSON line per event; diagnostics → stderr. */
export const ndjsonRenderer = (stream: Stream.Stream<ProgressEvent>): Effect.Effect<void> =>
  Stream.runForEach(stream, (ev) => Effect.sync(() => process.stdout.write(toNdjson(ev) + "\n")))

/** TTY renderer: human lines → stderr (data stays on stdout). */
export const ttyRenderer = (
  stream: Stream.Stream<ProgressEvent>,
  color: boolean = false,
): Effect.Effect<void> =>
  Stream.runForEach(stream, (ev) => Effect.sync(() => process.stderr.write(renderTty(ev, color) + "\n")))
