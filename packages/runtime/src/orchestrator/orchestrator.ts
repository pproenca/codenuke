/**
 * Orchestrator — the loop, startup gate, region/mode select, and doctor.
 *
 * Owns RULE-025/026 (surface guards — wiring), RULE-030 (fail-closed startup
 * gate, ordered, incl. changecost per the RULE-054 fix), RULE-031 (value-proxy
 * required for long runs), RULE-032 (doctor collects EVERY gap, no short-circuit),
 * RULE-038/039/040 (reduce/raise lifecycle + region/mode select), RULE-044
 * (scorer manual lifecycle), RULE-046 (proposer isolation), RULE-053 (shared
 * state reader — see state.ts).
 *
 * All effectful pieces are STUBS (`Effect.die("unimplemented: RULE-xxx")`).
 * RULE-031's pure threshold check and RULE-039's pure selection are implemented
 * for real (small, pure decisions) but their acceptance tests are skipped where
 * the surrounding lifecycle is effectful, per the brief.
 */
import { Context, Effect, Layer } from "effect"

// ---------------------------------------------------------------------------
// Constants — preserved exactly.
// ---------------------------------------------------------------------------
/** RULE-031 — value-proxy required iff iterations > LONG_RUN_ITERATIONS. */
export const LONG_RUN_ITERATIONS = 5
/** RULE-040 — strict-gain epsilon for raise replay. */
export const RAISE_GAIN_EPS = 1e-9
/** RULE-040 / RULE-042 — survivor display cap. */
export const SURVIVOR_DISPLAY_CAP = 12

// ---------------------------------------------------------------------------
// RULE-031 — pure threshold decision.
// ---------------------------------------------------------------------------
/** value-proxy validation is required iff iterations > LONG_RUN_ITERATIONS. */
export const shouldRequireValueProxyValidation = (iterations: number | undefined): boolean =>
  (iterations ?? LONG_RUN_ITERATIONS) > LONG_RUN_ITERATIONS

// ---------------------------------------------------------------------------
// RULE-039 — pure region & mode selection.
// ---------------------------------------------------------------------------
export interface RegionInfo {
  readonly key: string
  readonly lo: number
  readonly admissible: boolean | undefined
}

export type LoopMode = "reduce" | "raise"

/**
 * RULE-039 — choose a region: highest-`lo` blocked region, else first admissible,
 * else the default (first). An unmeasured region (admissible undefined) is treated
 * as blocked (→ raise). Pure.
 */
export const chooseRegion = (regions: readonly RegionInfo[]): RegionInfo | undefined => {
  if (regions.length === 0) return undefined
  const blocked = regions.filter((r) => r.admissible !== true)
  if (blocked.length > 0) {
    return blocked.reduce((best, r) => (r.lo > best.lo ? r : best))
  }
  const admissible = regions.find((r) => r.admissible === true)
  return admissible ?? regions[0]
}

/** RULE-039 — mode = region.admissible===true ? reduce : raise. */
export const selectMode = (region: RegionInfo): LoopMode =>
  region.admissible === true ? "reduce" : "raise"

// ---------------------------------------------------------------------------
// RULE-030 / RULE-032 — startup-gate & doctor gap model.
// ---------------------------------------------------------------------------
export type GapKind =
  | "fence-missing"
  | "fence-unusable"
  | "no-measured-region"
  | "calibration-missing"
  | "calibration-unusable"
  | "value-proxy-missing"
  | "value-proxy-unusable"
  | "changecost-missing" // RULE-054 fix — wired into the gate
  | "changecost-unusable"

export interface ReadinessGap {
  readonly kind: GapKind
  readonly message: string
}

/**
 * RULE-030 — the ordered readiness check order. The startup gate stops at the
 * FIRST gap; doctor (RULE-032) collects ALL. value-proxy steps are skipped
 * unless `requireValueProxy`. Changecost is included per the RULE-054 fix.
 */
export const READINESS_ORDER: readonly GapKind[] = [
  "fence-missing",
  "fence-unusable",
  "no-measured-region",
  "calibration-missing",
  "calibration-unusable",
  "changecost-missing", // RULE-054 fix: changecost provenance gated before value-proxy
  "changecost-unusable",
  "value-proxy-missing",
  "value-proxy-unusable",
]

/** Artifact readiness flags the gate/doctor evaluate (one bool pair per artifact). */
export interface ArtifactReadiness {
  readonly fencePresent: boolean
  readonly fenceUsable: boolean
  readonly hasMeasuredRegion: boolean
  readonly calibrationPresent: boolean
  readonly calibrationUsable: boolean
  readonly changecostPresent: boolean
  readonly changecostUsable: boolean
  readonly valueProxyPresent: boolean
  readonly valueProxyUsable: boolean
}

/**
 * RULE-030/032/054 — collect readiness gaps in the canonical READINESS_ORDER.
 * Changecost is gated BEFORE value-proxy (RULE-054 fix). value-proxy steps are
 * included only when `requireValueProxy` (RULE-031, long runs). The startup gate
 * uses `firstGap` (fail at first); doctor renders the full list (no short-circuit).
 */
export const collectGaps = (
  r: ArtifactReadiness,
  requireValueProxy: boolean,
): ReadinessGap[] => {
  const gaps: ReadinessGap[] = []
  const add = (kind: GapKind, message: string): void => {
    gaps.push({ kind, message })
  }
  if (!r.fencePresent) add("fence-missing", "fence artifact missing — run `codenuke fence`")
  else if (!r.fenceUsable) add("fence-unusable", "fence artifact present but unusable (stale/invalid)")
  if (r.fencePresent && r.fenceUsable && !r.hasMeasuredRegion) {
    add("no-measured-region", "fence artifact has no measured region")
  }
  if (!r.calibrationPresent) add("calibration-missing", "calibration missing — run `codenuke calibrate`")
  else if (!r.calibrationUsable) add("calibration-unusable", "calibration present but unusable")
  // RULE-054 fix — changecost provenance is gated (it was never re-validated in legacy).
  if (!r.changecostPresent) add("changecost-missing", "changecost missing — run `codenuke changecost`")
  else if (!r.changecostUsable) add("changecost-unusable", "changecost present but unusable")
  if (requireValueProxy) {
    if (!r.valueProxyPresent) {
      add("value-proxy-missing", "value-proxy validation missing — run `codenuke validate-proxy`")
    } else if (!r.valueProxyUsable) {
      add("value-proxy-unusable", "value-proxy present but unusable")
    }
  }
  return gaps
}

/** RULE-030 — the FIRST gap (fail-closed startup gate), or null when ready. */
export const firstGap = (
  r: ArtifactReadiness,
  requireValueProxy: boolean,
): ReadinessGap | null => collectGaps(r, requireValueProxy)[0] ?? null

// ---------------------------------------------------------------------------
// Orchestrator service. All effectful members are STUBS.
// ---------------------------------------------------------------------------
export class Orchestrator extends Context.Tag("@codenuke/runtime/Orchestrator")<
  Orchestrator,
  {
    /** RULE-030 — fail-closed startup gate; returns the FIRST gap or null. */
    readonly startupGate: (iterations: number) => Effect.Effect<ReadinessGap | null>
    /** RULE-032 — doctor: collect EVERY gap (no short-circuit). */
    readonly doctor: Effect.Effect<readonly ReadinessGap[]>
    /** RULE-038/039/040 — run the propose→score→keep/revert autoloop. */
    readonly runAutoloop: (iterations: number) => Effect.Effect<void>
    /** RULE-044 — scorer manual lifecycle commands. */
    readonly init: Effect.Effect<void>
    readonly score: (json: boolean) => Effect.Effect<void>
    readonly accept: Effect.Effect<void>
    readonly revert: Effect.Effect<void>
    readonly status: Effect.Effect<void>
    readonly cleanup: Effect.Effect<void>
  }
>() {}

export const OrchestratorLive = Layer.succeed(
  Orchestrator,
  Orchestrator.of({
    startupGate: () => Effect.die("unimplemented: RULE-030 startupGate (OrchestratorLive)"),
    doctor: Effect.die("unimplemented: RULE-032 doctor (OrchestratorLive)"),
    runAutoloop: () => Effect.die("unimplemented: RULE-038/039/040 runAutoloop (OrchestratorLive)"),
    init: Effect.die("unimplemented: RULE-044 init (OrchestratorLive)"),
    score: () => Effect.die("unimplemented: RULE-044 score (OrchestratorLive)"),
    accept: Effect.die("unimplemented: RULE-044 accept (OrchestratorLive)"),
    revert: Effect.die("unimplemented: RULE-044 revert (OrchestratorLive)"),
    status: Effect.die("unimplemented: RULE-044 status (OrchestratorLive)"),
    cleanup: Effect.die("unimplemented: RULE-044 cleanup (OrchestratorLive)"),
  }),
)
