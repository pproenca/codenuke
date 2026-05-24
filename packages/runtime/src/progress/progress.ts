/**
 * Progress streaming spine — architecture §6.
 *
 * Defines the `ProgressEvent` ADT (tagged union), a PURE NDJSON serializer
 * `toNdjson(ev): string`, and a `ProgressBus` service backed by a bounded
 * `Queue`. Two renderers consume the bus: a TTY renderer (human, color-aware)
 * and an NDJSON renderer (`--json`, one JSON object per line on stdout).
 *
 * The `Scored` event carries the FULL Verdict including `failedGates` — that is
 * the sole observable sink for the RULE-063 fix. The NDJSON serializer is the
 * tested pure piece (`toNdjson` round-trips failedGates).
 *
 * `ProposerEvent` is referenced from the proposer port; `Verdict` is owned by
 * `@codenuke/core`. We declare a structural `Verdict`-like shape locally so the
 * serializer compiles before core exists.
 */
import { Context, Data, Effect, Layer, Queue, Stream } from "effect"
import type { ProposerEvent } from "../proposer/proposer.ts"

// ---------------------------------------------------------------------------
// Verdict (structural mirror of @codenuke/core Verdict, incl. RULE-063 fix).
// ---------------------------------------------------------------------------
export type GateName = "G1" | "G1prime" | "G3" | "G4"

export interface VerdictLike {
  readonly admissible: boolean
  readonly keep: boolean
  readonly loss: number | null
  readonly gain: number
  readonly risk: number
  readonly mfence: number
  readonly gates: { readonly G1: boolean; readonly G1prime: boolean; readonly G3: boolean; readonly G4: boolean }
  /** RULE-063 FIX: ALL failing gate names, not just the highest-priority label. */
  readonly failedGates: readonly GateName[]
}

// ---------------------------------------------------------------------------
// ProgressEvent ADT (architecture §6, seeded from fence's RuntimeEvent union).
// ---------------------------------------------------------------------------
export type ProgressEvent =
  | { readonly _tag: "RunStarted"; readonly iterations: number; readonly baselineSha: string }
  | { readonly _tag: "RegionSelected"; readonly region: string; readonly mode: "reduce" | "raise" }
  | { readonly _tag: "ProposerEvent"; readonly ev: ProposerEvent }
  | { readonly _tag: "MutationProgress"; readonly region: string; readonly done: number; readonly total: number }
  | { readonly _tag: "Scored"; readonly verdict: VerdictLike }
  | { readonly _tag: "KeptOrReverted"; readonly kept: boolean; readonly reason: string }
  | { readonly _tag: "ArtifactWritten"; readonly path: string; readonly kind: string }
  | { readonly _tag: "Heartbeat"; readonly ms: number }
  | { readonly _tag: "Message"; readonly level: "info" | "warn" | "error"; readonly text: string }

// ---------------------------------------------------------------------------
// PURE NDJSON serializer — toNdjson(ev): string.
//
// One JSON object per line (no trailing newline; the renderer appends "\n").
// `Scored` flattens the verdict so `failedGates` is a top-level observable field
// (the RULE-063 fix sink).
// ---------------------------------------------------------------------------
export const toNdjson = (ev: ProgressEvent): string => {
  switch (ev._tag) {
    case "Scored":
      return JSON.stringify({
        type: "scored",
        admissible: ev.verdict.admissible,
        keep: ev.verdict.keep,
        loss: ev.verdict.loss,
        gain: ev.verdict.gain,
        risk: ev.verdict.risk,
        mfence: ev.verdict.mfence,
        gates: ev.verdict.gates,
        // RULE-063 fix: surface EVERY failing gate, not just the top label.
        failedGates: ev.verdict.failedGates,
        blocked: ev.verdict.failedGates.length > 0,
      })
    case "ProposerEvent":
      return JSON.stringify({ type: "proposer", ev: ev.ev })
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
    case "ProposerEvent":
      return dim(`proposer: ${ev.ev._tag}`)
    case "MutationProgress":
      return dim(`mutate ${ev.region}: ${ev.done}/${ev.total}`)
    case "Scored": {
      const v = ev.verdict
      const failed = v.failedGates.length ? ` failed=[${v.failedGates.join(",")}]` : ""
      return `scored: keep=${v.keep} loss=${v.loss ?? "null"}${failed}`
    }
    case "KeptOrReverted":
      return `${ev.kept ? "KEEP" : "REVERT"}: ${ev.reason}`
    case "ArtifactWritten":
      return dim(`wrote ${ev.kind}: ${ev.path}`)
    case "Heartbeat":
      return dim(`… ${ev.ms}ms`)
    case "Message":
      return `[${ev.level}] ${ev.text}`
  }
}

// ---------------------------------------------------------------------------
// ProgressBus service — bounded Queue (architecture §6: Queue not PubSub).
// ---------------------------------------------------------------------------
export const PROGRESS_BUS_CAPACITY = 1024

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
    const queue = yield* Queue.bounded<ProgressEvent>(PROGRESS_BUS_CAPACITY)
    return ProgressBus.of({
      emit: (ev) => Queue.offer(queue, ev).pipe(Effect.asVoid),
      stream: Stream.fromQueue(queue),
      shutdown: Queue.shutdown(queue),
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
