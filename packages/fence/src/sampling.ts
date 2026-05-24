/**
 * RULE-008 — Deterministic mutation sampling (cap / seed).
 *
 * GIVEN a region's collected sites, the audit plan is built by a Fisher–Yates
 * shuffle driven by `mulberry32(seed)`, then `slice(0, cap)`. Same (cap, seed)
 * ⇒ byte-identical sample (this is the determinism property the whole fence
 * subsystem leans on). cap=60, seed=1337 are the legacy defaults.
 *
 * !!! DO NOT SHARE THIS PRNG WITH value-proxy's permutation PRNG. !!!
 * This `mulberry32` does `a |= 0` per call (legacy-exact, fence.ts). The
 * value-proxy Spearman PRNG (RULE-015, spearman.ts) does NOT do `a |= 0` and
 * uses a different seed (0x9e3779b9). They are intentionally non-interchangeable
 * — "deduplicating" them silently changes the seeded sample set and breaks
 * artifact re-derivation. RULE-008 ≠ RULE-015.
 */

import type { MutationSite } from "./operators.ts";

/**
 * PlannedMutation is the cross-package contract type — imported (type-only)
 * from "@codenuke/core" per the contract, NOT redefined. Shape:
 * `MutationSite & { rel: string }` (a site pinned to its repo-relative file).
 * The `import type` is runtime-erased so this pure module still runs before
 * core's value exports exist.
 */
import type { PlannedMutation } from "@codenuke/core";
export type { PlannedMutation };

/** Legacy sampling defaults (RULE-008; CLI-overridable). */
export const DEFAULT_CAP = 60;
export const DEFAULT_SEED = 1337;

/**
 * RULE-008 — mulberry32 PRNG, legacy-exact (note the per-call `a |= 0`).
 *
 * Returns a generator producing floats in [0, 1). The closure mutates `a` by
 * `a |= 0` (force to int32) at the top of each call — this is the detail that
 * makes the stream match the legacy sequence exactly. Two generators created
 * with the same seed emit identical streams.
 */
export const mulberry32 = (seed: number): (() => number) => {
  let a = seed;
  return () => {
    a |= 0; // legacy-exact per-call int32 coercion (do not remove)
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * RULE-008 — deterministic in-place Fisher–Yates shuffle driven by `rng`.
 * Returns a new array (does not mutate the input). Iterates from the end,
 * swapping element `i` with a `rng`-chosen index in `[0, i]`.
 */
const shuffle = <A>(items: readonly A[], rng: () => number): A[] => {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
};

/**
 * RULE-008 — build the deterministic audit plan from collected sites.
 *
 * Shuffles with `mulberry32(seed)` then keeps the first `cap`. Each kept site
 * is pinned to `rel` (repo-relative file) to become a `PlannedMutation`. Fewer
 * sites than `cap` ⇒ all are kept. Same (sites, cap, seed) ⇒ identical result.
 *
 * @param rel repo-relative source path the sites belong to (PlannedMutation.rel)
 */
export const sampleSites = (
  sites: readonly MutationSite[],
  cap: number,
  seed: number,
  rel = "",
): PlannedMutation[] =>
  shuffle(sites, mulberry32(seed))
    .slice(0, cap)
    .map((s) => ({ ...s, rel }));

/**
 * RULE-008 — sample a region's combined, already-pinned plan (sites from several
 * files, each carrying its own `rel`). Same shuffle/cap/seed contract as
 * `sampleSites`; used by the audit when a region spans multiple files. The input
 * order must be fixed (files sorted by rel, sites ascending) for determinism.
 */
export const samplePlanned = (
  planned: readonly PlannedMutation[],
  cap: number,
  seed: number,
): PlannedMutation[] => shuffle(planned, mulberry32(seed)).slice(0, cap);
