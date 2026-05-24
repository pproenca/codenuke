/**
 * Calibration (C9) — periodic artifact.
 *
 * PURE math implemented for real and tested:
 *  - RULE-010  calibration scales = median of positive per-axis deltas
 *              over CommitDelta[] (with default fallback when < 3 qualify).
 *
 * STUBBED (effectful): the git-history fetch (`rev-list --first-parent
 * --max-count=80`) + before/after measurement + artifact write
 * (CalibrationServiceLive). RULE-023 status validation lives in core/artifacts.
 *
 * Cross-package contract: `CommitDelta`, `CalibrationArtifact` come from
 * `@codenuke/core`. The local `CommitDelta` shape below mirrors it for the
 * pure derivation; the live wiring imports core's type.
 */
import { Context, Effect, Layer } from "effect"

// ---------------------------------------------------------------------------
// Constants — preserved exactly (RULE-010 / RULE-023).
// ---------------------------------------------------------------------------
export const MIN_CALIBRATION_COMMITS = 3
export const HISTORY_WINDOW = 80 // git rev-list --first-parent --max-count=80
export const DEFAULT_CALIBRATION_SCALES = { sL: 150, sCx: 15, sDup: 5 } as const

// ---------------------------------------------------------------------------
// RULE-010 — median-of-positive-deltas derivation (PURE).
// ---------------------------------------------------------------------------

/**
 * One commit's ABSOLUTE per-axis delta (contrast RULE-059's signed deltas).
 * `dL/dCx/dDup = |after − before|` per axis.
 */
export interface CommitDelta {
  readonly dL: number
  readonly dCx: number
  readonly dDup: number
}

export interface CalibrationScales {
  readonly sL: number
  readonly sCx: number
  readonly sDup: number
}

/** Median of a numeric list. `median([])===0`; even length = mean of middle two. */
export const median = (xs: readonly number[]): number => {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/**
 * RULE-010 — per-axis scale = median of positive deltas of that axis IF ≥ 3
 * commits have any positive delta; else fall back to the default per axis.
 * Also falls back when the median is ≤ 0 (`positiveScale`).
 */
export const deriveScales = (deltas: readonly CommitDelta[]): CalibrationScales => {
  // "keep commits with any positive delta" — the qualifying set.
  const qualifying = deltas.filter((d) => d.dL > 0 || d.dCx > 0 || d.dDup > 0)

  const positiveScale = (values: readonly number[], fallback: number): number => {
    if (qualifying.length < MIN_CALIBRATION_COMMITS) return fallback
    const positives = values.filter((v) => v > 0)
    const m = median(positives)
    return m > 0 ? m : fallback
  }

  return {
    sL: positiveScale(qualifying.map((d) => d.dL), DEFAULT_CALIBRATION_SCALES.sL),
    sCx: positiveScale(qualifying.map((d) => d.dCx), DEFAULT_CALIBRATION_SCALES.sCx),
    sDup: positiveScale(qualifying.map((d) => d.dDup), DEFAULT_CALIBRATION_SCALES.sDup),
  }
}

export interface DerivedCalibration {
  readonly scales: CalibrationScales
  readonly commitsSampled: number
  readonly enoughHistory: boolean
}

/** Bundle scales + provenance (RULE-023 inputs). */
export const deriveCalibration = (deltas: readonly CommitDelta[]): DerivedCalibration => {
  const qualifying = deltas.filter((d) => d.dL > 0 || d.dCx > 0 || d.dDup > 0)
  return {
    scales: deriveScales(deltas),
    commitsSampled: qualifying.length,
    enoughHistory: qualifying.length >= MIN_CALIBRATION_COMMITS,
  }
}

// ---------------------------------------------------------------------------
// CalibrationService (C9) — git-history fetch + artifact write. STUB.
// ---------------------------------------------------------------------------
export class CalibrationService extends Context.Tag("@codenuke/runtime/CalibrationService")<
  CalibrationService,
  {
    /** Sample history, derive scales, write calibration.json. */
    readonly run: Effect.Effect<DerivedCalibration>
  }
>() {}

export const CalibrationServiceLive = Layer.succeed(
  CalibrationService,
  CalibrationService.of({
    run: Effect.die("unimplemented: RULE-010 git-history fetch + calibration artifact IO (CalibrationServiceLive)"),
  }),
)
