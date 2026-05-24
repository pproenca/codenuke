/**
 * RULE-043 — Monotonic fence replay (keep iff strictly-higher lower bound).
 *
 * Replay re-tests ONLY the prior survivors against newly-added characterization
 * tests. The denominator is FIXED at `previous.total` (only the numerator can
 * rise), so fidelity is monotonic — it can only stay or rise. A replay is KEPT
 * (the raise iteration counts as a gain) iff the new Wilson lower bound is
 * STRICTLY higher than the old:
 *
 *     keep = lo_after > lo_before + EPSILON
 *
 * with the legacy strict-gain epsilon 1e-9 (RULE-040 AND-clause).
 *
 * This module owns the PURE pieces:
 *   - `EPSILON` and `isStrictlyHigherLowerBound` (the keep comparison), and
 *   - `recomputeReplay`: given previous counts and how many survivors were now
 *     killed, derive the new (caught, total) and Wilson interval via core's
 *     `wilson` (RULE-006/043 math).
 *
 * The EFFECTFUL parts — reading worktree sources, running tests, the
 * RULE-051 precondition (sources unchanged + green) — live in the `Fence`
 * service (audit.ts) and are skipped in this scaffold.
 */

import { wilson, type WilsonInterval } from "@codenuke/core";

/** Re-export core's Wilson primitive so replay consumers have one import site. */
export { wilson };
export type { WilsonInterval };

/** Strict-gain epsilon for the replay keep decision (RULE-040/043). */
export const EPSILON = 1e-9;

/**
 * RULE-043 — the keep comparison (pure). True iff `loAfter` is strictly higher
 * than `loBefore` by more than EPSILON. Equal lower bounds ⇒ NOT kept
 * (`raise-nogain`).
 */
export const isStrictlyHigherLowerBound = (loBefore: number, loAfter: number): boolean =>
  loAfter > loBefore + EPSILON;

/**
 * RULE-043 — recompute a region's interval after a replay (pure).
 *
 * The denominator stays at `previousTotal`; the new caught count is
 * `previousCaught + nowKilled` (survivors the added tests now catch). Returns
 * the new Wilson interval and whether the replay strictly improved fidelity vs
 * `loBefore`.
 *
 * `nowKilled` is bounded by the prior survivor count
 * (`previousTotal - previousCaught`); callers pass the count of survivors that
 * went red on replay. A survivor whose file vanished is treated as still-green
 * (conservative) and therefore is NOT counted in `nowKilled` (RULE-043).
 */
export const recomputeReplay = (
  previousCaught: number,
  previousTotal: number,
  nowKilled: number,
  loBefore: number,
): { readonly caught: number; readonly total: number; readonly interval: WilsonInterval; readonly improved: boolean } => {
  const caught = previousCaught + nowKilled;
  const total = previousTotal;
  const interval = wilson(caught, total);
  return {
    caught,
    total,
    interval,
    improved: isStrictlyHigherLowerBound(loBefore, interval.lo),
  };
};
