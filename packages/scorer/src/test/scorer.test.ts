// Characterization tests for the pure keep/revert decision (RULE-035 + 001/002 +
// gates). loop/scorer.mjs computes this inline (no export); values are reasoned
// exactly from the formulas in BUSINESS_RULES.md.
import { describe, expect, it } from "vitest";

import { decide, verdictLabel, type ScoreInputs } from "@codenuke/scorer";

const W = { dL: 1.0, dCx: 1.8, dDup: 0.35, scaleL: 150, scaleCx: 15, scaleDup: 5, r3: 1.0 };

const base = (over: Partial<ScoreInputs> = {}): ScoreInputs => ({
  before: { L: 100, complexity: 20, dupMass: 10 },
  after: { L: 80, complexity: 14, dupMass: 8 },
  testsPass: true,
  fenceUsable: true,
  blockedRegions: [],
  touchedFidelities: [0.95],
  diffsize: 30,
  typeErrors: 0,
  baselineTypeErrors: 0,
  weights: W,
  scales: null,
  ...over,
});

describe("decide — keep decision (RULE-035)", () => {
  it("KEEPs a genuine reduction with gain > risk and all gates green", () => {
    const v = decide(base());
    expect(v.gates).toEqual({ G1: true, G1prime: true, G3: true, G4: true });
    expect(v.admissible).toBe(true);
    // dL=20,dCx=6,dDup=2 → gain = 20/150 + 1.8*(6/15) + 0.35*(2/5) = 0.9933…
    expect(v.gain).toBeCloseTo(0.99333, 4);
    // risk = 0.002*30 + 1*(1-0.95) = 0.11
    expect(v.risk).toBeCloseTo(0.11, 6);
    expect(v.loss).toBeLessThan(0);
    expect(v.keep).toBe(true);
    expect(verdictLabel(v)).toBe("KEEP");
  });

  it("REJECTs on a failed gate (G4: no net AST decrease)", () => {
    const v = decide(base({ after: { L: 100, complexity: 14, dupMass: 8 } })); // dL = 0
    expect(v.gates.G4).toBe(false);
    expect(v.admissible).toBe(false);
    expect(v.loss).toBeNull(); // Infinity → null
    expect(v.keep).toBe(false);
    expect(verdictLabel(v)).toBe("REJECT (gate)");
  });

  it("REJECTs an admissible candidate with no gain (loss ≥ 0)", () => {
    const v = decide(
      base({
        before: { L: 102, complexity: 20, dupMass: 10 },
        after: { L: 100, complexity: 20, dupMass: 10 }, // dL=2 only
        diffsize: 200,
        touchedFidelities: [0.5],
      }),
    );
    expect(v.admissible).toBe(true);
    expect(v.loss).toBeGreaterThan(0);
    expect(v.keep).toBe(false);
    expect(verdictLabel(v)).toBe("REJECT (no gain)");
  });

  it("fails closed when the fence is unusable (G1′ false)", () => {
    const v = decide(base({ fenceUsable: false }));
    expect(v.gates.G1prime).toBe(false);
    expect(v.admissible).toBe(false);
    expect(verdictLabel(v)).toBe("REJECT (G1′ fence)");
  });

  it("blocks when a touched region is not admissible (G1′ false)", () => {
    const v = decide(base({ blockedRegions: ["alpha"] }));
    expect(v.gates.G1prime).toBe(false);
    expect(verdictLabel(v)).toBe("REJECT (G1′ fence)");
  });

  it("uses calibration scales over the weight defaults when provided", () => {
    const v = decide(base({ scales: { sL: 10, sCx: 3, sDup: 1 } }));
    // gain = 20/10 + 1.8*(6/3) + 0.35*(2/1) = 2 + 3.6 + 0.7 = 6.3
    expect(v.gain).toBeCloseTo(6.3, 6);
  });

  it("mfence is 1 when no regions are touched (fence term zero)", () => {
    const v = decide(base({ touchedFidelities: [], diffsize: 0 }));
    expect(v.mfence).toBe(1);
    expect(v.risk).toBe(0);
  });

  it("G3 tolerates pre-existing type errors but not new ones", () => {
    expect(decide(base({ typeErrors: 2, baselineTypeErrors: 2 })).gates.G3).toBe(true);
    expect(decide(base({ typeErrors: 3, baselineTypeErrors: 2 })).gates.G3).toBe(false);
  });
});
