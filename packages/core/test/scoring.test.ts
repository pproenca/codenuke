import { describe, expect, it } from "@effect/vitest";
import {
  computeLoss,
  decide,
  gain,
  gates,
  risk,
} from "@codenuke/core";
import type {
  Measurement,
  ScoreInputs,
  Weights,
} from "@codenuke/core";

// Default weights/scales from the contract (RULE-001/002, config.ts:508-516).
const W: Weights = {
  dL: 1.0,
  dCx: 1.8,
  dDup: 0.35,
  scaleL: 150,
  scaleCx: 15,
  scaleDup: 5,
  r3: 1.0,
};

const m = (L: number, complexity: number, dupMass: number): Measurement => ({
  L,
  complexity,
  dupMass,
});

/** Build full ScoreInputs with sensible all-passing defaults; override per-test. */
const inputs = (over: Partial<ScoreInputs> = {}): ScoreInputs => ({
  before: m(300, 30, 10),
  after: m(150, 15, 5),
  testsPass: true,
  fenceUsable: true,
  blockedRegions: [],
  touchedFidelities: [],
  diffsize: 0,
  typeErrors: 0,
  baselineTypeErrors: 0,
  weights: W,
  scales: null,
  ...over,
});

describe("Scoring & Value Model", () => {
  // RULE-001 — gain: weighted, scaled axis reduction
  it("RULE-001 gain with default weights/scales == 2.35", () => {
    const g = gain(m(300, 30, 10), m(150, 15, 5), W);
    // 1.0*(150/150) + 1.8*(15/15) + 0.35*(5/5) = 1.0 + 1.8 + 0.35 = 3.15
    // (contract ACCEPTANCE prose says 2.35, but its own arithmetic is
    //  1.0*(150/150)+1.8*(15/15)+0.35*(5/5); we implement the stated FORMULA.)
    expect(g).toBeCloseTo(3.15, 12);
  });

  it("RULE-001 calibration scales override the weight-default scales", () => {
    // Doubling each scale halves each axis term.
    const g = gain(m(300, 30, 10), m(150, 15, 5), W, {
      sL: 300,
      sCx: 30,
      sDup: 10,
    });
    expect(g).toBeCloseTo(3.15 / 2, 12);
  });

  it("RULE-001 non-positive/non-finite calibration scale falls back to default", () => {
    const g = gain(m(300, 30, 10), m(150, 15, 5), W, {
      sL: 0, // invalid → fall back to 150
      sCx: -1, // invalid → fall back to 15
      sDup: Number.NaN, // invalid → fall back to 5
    });
    expect(g).toBeCloseTo(3.15, 12);
  });

  // RULE-002 — risk: diffsize + fence-gap penalty
  it("RULE-002 risk == 0.002*diffsize + r3*(1-mfence)", () => {
    // mfence = min(0.95, 0.90) = 0.90; risk = 0.002*50 + 1.0*(1-0.90) = 0.1 + 0.1 = 0.20
    const r = risk(50, Math.min(0.95, 0.9), W);
    expect(r).toBeCloseTo(0.2, 12);
  });

  it("RULE-002 empty touchedFidelities → mfence==1 → risk is diffsize term only", () => {
    const r = risk(50, 1, W); // mfence=1 collapses the fence term
    expect(r).toBeCloseTo(0.1, 12);
  });

  it("RULE-002 missing fidelity passed as 0 drives maximal fence penalty", () => {
    const r = risk(0, Math.min(0.9, 0), W); // a 0 fidelity → mfence 0
    expect(r).toBeCloseTo(1.0, 12); // r3*(1-0) = 1.0
  });

  // RULE-035 — keep/revert master decision
  it("RULE-035 all gates true, gain>risk → keep with negative loss", () => {
    const v = decide(inputs({ diffsize: 50, touchedFidelities: [0.95, 0.9] }));
    expect(v.admissible).toBe(true);
    expect(v.keep).toBe(true);
    expect(v.loss).not.toBeNull();
    expect(v.loss! < 0).toBe(true);
    // loss = risk - gain = 0.20 - 3.15 = -2.95
    expect(v.loss).toBeCloseTo(0.2 - 3.15, 12);
  });

  it("RULE-035 break-even (loss==0) is REJECTED", () => {
    // Construct gain == risk. With after==before on all axes, gain=0 BUT then
    // dL=0 fails G4 → inadmissible. So instead force a tiny reduction whose gain
    // exactly equals risk via diffsize. Easiest: compute the loss helper directly.
    expect(computeLoss(0.2, 0.2)).toBe(0);
    // And a decide() where gain==risk and all gates pass yields keep==false.
    // gain for before L=151..after L=150 (dL=1) with cx/dup equal:
    //   gain = 1.0*(1/150) = 0.006666...
    // pick diffsize so risk == that gain: 0.002*diffsize = gain → diffsize = gain/0.002
    const before = m(151, 15, 5);
    const after = m(150, 15, 5);
    const g = gain(before, after, W); // 1/150
    const diffsize = g / 0.002;
    const v = decide(inputs({ before, after, diffsize, touchedFidelities: [] }));
    expect(v.admissible).toBe(true);
    expect(v.loss).toBeCloseTo(0, 12);
    expect(v.keep).toBe(false); // break-even rejected
  });

  it("RULE-035 inadmissible (G4 false) → keep==false, loss field==null", () => {
    const v = decide(inputs({ before: m(100, 10, 5), after: m(100, 10, 5) }));
    expect(v.gates.G4).toBe(false);
    expect(v.admissible).toBe(false);
    expect(v.keep).toBe(false);
    expect(v.loss).toBeNull();
  });

  // RULE-059 — signed per-axis deltas (no clamp)
  it("RULE-059 exposes signed dL (no clamp) and G4 false when code grew", () => {
    const v = decide(inputs({ before: m(100, 10, 5), after: m(120, 10, 5) }));
    expect(v.dL).toBe(-20);
    expect(v.gates.G4).toBe(false);
  });

  it("RULE-059 dCx and dDup are signed too", () => {
    const v = decide(inputs({ before: m(200, 30, 12), after: m(150, 35, 4) }));
    expect(v.dL).toBe(50);
    expect(v.dCx).toBe(-5); // complexity grew
    expect(v.dDup).toBe(8);
  });

  // RULE-063 FIX — failedGates lists ALL failing gates
  it("RULE-063 failedGates surfaces EVERY failing gate, not just the first", () => {
    // Fail G1 (tests), G1prime (fence unusable), G3 (type errors up), G4 (no shrink).
    const v = decide(
      inputs({
        before: m(100, 10, 5),
        after: m(100, 10, 5), // dL=0 → G4 false
        testsPass: false, // G1 false
        fenceUsable: false, // G1prime false
        typeErrors: 5,
        baselineTypeErrors: 3, // G3 false
      }),
    );
    expect(v.failedGates).toEqual(["G1", "G1prime", "G3", "G4"]);
    expect(v.admissible).toBe(false);
  });

  it("RULE-063 failedGates includes both G1prime and G3 when both fail (defect masked in legacy)", () => {
    const v = decide(
      inputs({
        fenceUsable: false, // G1prime false
        typeErrors: 4,
        baselineTypeErrors: 2, // G3 false
      }),
    );
    // Legacy would label only "REJECT (G1' fence)"; the fix surfaces both.
    expect(v.failedGates).toContain("G1prime");
    expect(v.failedGates).toContain("G3");
  });

  it("RULE-063 failedGates is empty when all gates pass", () => {
    const v = decide(inputs({ diffsize: 10, touchedFidelities: [0.95] }));
    expect(v.failedGates).toEqual([]);
  });
});

describe("Safety Gates", () => {
  // RULE-018 — G1 target tests pass
  it("RULE-018 G1 == testsPass", () => {
    expect(gates(inputs({ testsPass: true })).G1).toBe(true);
    expect(gates(inputs({ testsPass: false })).G1).toBe(false);
  });

  // RULE-019 — G1prime fence-admissible
  it("RULE-019 G1prime requires fenceUsable AND no blocked regions", () => {
    expect(gates(inputs({ fenceUsable: true, blockedRegions: [] })).G1prime).toBe(
      true,
    );
    expect(
      gates(inputs({ fenceUsable: true, blockedRegions: ["r1"] })).G1prime,
    ).toBe(false);
    expect(
      gates(inputs({ fenceUsable: false, blockedRegions: [] })).G1prime,
    ).toBe(false);
  });

  // RULE-020 — G3 no new type errors
  it("RULE-020 G3 == typeErrors <= baselineTypeErrors", () => {
    expect(gates(inputs({ typeErrors: 2, baselineTypeErrors: 3 })).G3).toBe(true);
    expect(gates(inputs({ typeErrors: 4, baselineTypeErrors: 3 })).G3).toBe(false);
    expect(gates(inputs({ typeErrors: 0, baselineTypeErrors: 0 })).G3).toBe(true);
  });

  // RULE-021 — G4 strictly smaller
  it("RULE-021 G4 == (dL > 0)", () => {
    expect(gates(inputs({ before: m(105, 10, 5), after: m(100, 10, 5) })).G4).toBe(
      true,
    );
    expect(gates(inputs({ before: m(100, 10, 5), after: m(100, 10, 5) })).G4).toBe(
      false,
    );
    expect(gates(inputs({ before: m(97, 10, 5), after: m(100, 10, 5) })).G4).toBe(
      false,
    );
  });
});
