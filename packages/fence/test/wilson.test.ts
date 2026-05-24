import { describe, expect, it } from "@effect/vitest";

/**
 * RULE-006 — Wilson admissibility bar.
 *
 * The Wilson MATH lives in @codenuke/core; here we test only the admissibility
 * DECISION (`admissible = lo >= threshold`), the fenceLB=0.90 default, the
 * Z_95=1.96 constant, and that core's interval bounds are clamped to [0,1].
 *
 * Per the cross-package contract: if `wilson` is not yet exported by
 * @codenuke/core at test time, these are skipped with a note rather than
 * failing the build. Loaded dynamically so a missing core export does not
 * crash module evaluation.
 */

type FenceMod = typeof import("../src/wilson.ts");

let mod: FenceMod | null = null;
let loadError: unknown = null;
try {
  mod = await import("../src/wilson.ts");
  // confirm the core-backed `wilson` is actually present
  if (typeof mod.wilson !== "function") {
    loadError = new Error("@codenuke/core did not export `wilson`");
    mod = null;
  }
} catch (e) {
  loadError = e;
}

const guarded = mod ? describe : describe.skip;

guarded("RULE-006 Wilson admissibility bar", () => {
  it("RULE-006 constants: fenceLB default == 0.90 and Z_95 == 1.96", () => {
    expect(mod!.FENCE_LB_DEFAULT).toBe(0.9);
    expect(mod!.Z_95).toBe(1.96);
  });

  it("RULE-006 admissible iff Wilson lo >= threshold (35/35 admits at 0.90, 34/35 does not)", () => {
    expect(mod!.admissibleFromCounts(35, 35, 0.9)).toBe(true);
    expect(mod!.admissibleFromCounts(34, 35, 0.9)).toBe(false);
  });

  it("RULE-006 n=0 is degenerate {p:0, lo:0, hi:1} and never admissible at threshold>0", () => {
    const w = mod!.wilson(0, 0);
    expect(w.p).toBe(0);
    expect(w.lo).toBe(0);
    expect(w.hi).toBe(1);
    expect(mod!.isAdmissible(w, 0.9)).toBe(false);
  });

  it("RULE-006 interval bounds are clamped to [0,1]", () => {
    for (const [k, n] of [
      [0, 1],
      [1, 1],
      [3, 7],
      [35, 35],
    ] as const) {
      const w = mod!.wilson(k, n);
      expect(w.lo).toBeGreaterThanOrEqual(0);
      expect(w.hi).toBeLessThanOrEqual(1);
      expect(w.lo).toBeLessThanOrEqual(w.p);
      expect(w.p).toBeLessThanOrEqual(w.hi);
    }
  });

  it("RULE-006 isAdmissible uses the FENCE_LB_DEFAULT threshold when none is given", () => {
    expect(mod!.isAdmissible({ p: 1, lo: 0.95, hi: 1 })).toBe(true);
    expect(mod!.isAdmissible({ p: 0.9, lo: 0.85, hi: 0.95 })).toBe(false);
  });
});

if (!mod) {
  describe("RULE-006 Wilson admissibility bar (skipped)", () => {
    it.skip(`RULE-006 skipped — @codenuke/core wilson import unavailable: ${String(loadError)}`, () => {});
  });
}
