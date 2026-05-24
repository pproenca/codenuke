/**
 * RULE-006 — Wilson admissibility bar.
 *
 * The Wilson *math* lives in @codenuke/core (`wilson(caught, total)`). This
 * module owns only the fence's admissibility DECISION on top of it:
 *
 *     admissible = wilson(caught, total).lo >= threshold
 *
 * with the default fence lower bound `fenceLB = 0.90` (config.ts:464, env
 * CN_FENCE_LB, clamped [0,1]) and the 95% quantile constant `Z_95 = 1.96`
 * (stats.ts:13, hardcoded in core's wilson).
 *
 * Per the cross-package contract we import `wilson` + `WilsonInterval` from
 * core and DO NOT reimplement the interval here.
 */

import { wilson, type WilsonInterval } from "@codenuke/core";

/** Default fence lower-bound admissibility threshold (RULE-006). */
export const FENCE_LB_DEFAULT = 0.9;

/** 95% normal quantile used by core's Wilson interval (RULE-006). */
export const Z_95 = 1.96;

/** Re-export core's Wilson primitive so fence consumers have one import site. */
export { wilson };
export type { WilsonInterval };

/**
 * RULE-006 — the admissibility decision.
 * A region is admissible iff its Wilson lower bound is at least `threshold`.
 * `n=0` ⇒ core returns `{p:0, lo:0, hi:1}` ⇒ never admissible at threshold>0
 * (fail-closed for unmeasured regions).
 */
export const isAdmissible = (interval: WilsonInterval, threshold: number = FENCE_LB_DEFAULT): boolean =>
  interval.lo >= threshold;

/**
 * RULE-006 — convenience: compute the interval from counts and decide.
 * Equivalent to `isAdmissible(wilson(caught, total), threshold)`.
 */
export const admissibleFromCounts = (
  caught: number,
  total: number,
  threshold: number = FENCE_LB_DEFAULT,
): boolean => isAdmissible(wilson(caught, total), threshold);
