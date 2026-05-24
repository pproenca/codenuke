/**
 * Engine-state reader — the ONE Schema-validated decoder (RULE-053 FIX).
 *
 * RULE-053: require 40-hex `baselineSha`, integer `baselineTsc`/`startL`/`iter`,
 * `accepted: string[]`; then the SHA must `git rev-parse` back to itself, else
 * `StateStale` ⇒ exit 1 (parity, NOT silent re-init).
 *
 * The PURE half — Schema decode/validate + the "SHA mismatch ⇒ StateStale"
 * decision — is implemented for real and tested. The fs read is effectful and
 * lives on the orchestrator service (stubbed). Both scorer and orchestrator
 * share THIS decoder (closes the asymmetric-trust / CWE-502 defect).
 *
 * `EngineState` and `StateStale` are owned by `@codenuke/core`; the local
 * Schema below mirrors the core shape so the decoder compiles before core's
 * src exists.
 */
import { Data, Either, ParseResult, Schema } from "effect"

// ---------------------------------------------------------------------------
// Local errors (authoritative in @codenuke/core).
// ---------------------------------------------------------------------------
export class StateStale extends Data.TaggedError("StateStale")<{
  readonly expectedSha: string
  readonly resolvedSha: string
}> {}

export class StateInvalid extends Data.TaggedError("StateInvalid")<{
  readonly message: string
}> {}

// ---------------------------------------------------------------------------
// RULE-053 — EngineState Schema (mirrors @codenuke/core EngineState).
// ---------------------------------------------------------------------------
const Sha40 = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{40}$/, { message: () => "baselineSha must be 40-hex" }),
)

export const EngineStateSchema = Schema.Struct({
  baselineSha: Sha40,
  baselineTsc: Schema.Int.pipe(Schema.nonNegative()),
  startL: Schema.Int.pipe(Schema.nonNegative()),
  accepted: Schema.Array(Schema.String),
  iter: Schema.Int.pipe(Schema.nonNegative()),
})

export type EngineState = Schema.Schema.Type<typeof EngineStateSchema>

const decode = Schema.decodeUnknownEither(EngineStateSchema)

/**
 * RULE-053 (pure decode/validate). Decode raw parsed JSON into an EngineState,
 * returning `StateInvalid` on shape failure.
 */
export const decodeEngineState = (raw: unknown): Either.Either<EngineState, StateInvalid> =>
  Either.mapLeft(decode(raw), (e) =>
    new StateInvalid({ message: ParseResult.TreeFormatter.formatErrorSync(e) }),
  )

/**
 * RULE-053 (pure SHA-reconcile decision). Given a validated state and the SHA
 * `git rev-parse` resolved the baseline to, decide staleness. A mismatch ⇒
 * `StateStale` (caller maps to exit 1) — never a silent re-init.
 */
export const reconcileSha = (
  state: EngineState,
  resolvedSha: string,
): Either.Either<EngineState, StateStale> =>
  resolvedSha === state.baselineSha
    ? Either.right(state)
    : Either.left(new StateStale({ expectedSha: state.baselineSha, resolvedSha }))
