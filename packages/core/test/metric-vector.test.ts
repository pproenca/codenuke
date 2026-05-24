import { describe, expect, it } from "@effect/vitest";
import {
  decide,
  guardrailReport,
  metricContext,
  scoreEnvelope,
  type ScoreInputs,
  type Weights,
} from "../src/index.ts";

const weights: Weights = {
  dL: 1,
  dCx: 1.8,
  dDup: 0.35,
  scaleL: 150,
  scaleCx: 15,
  scaleDup: 5,
  r3: 1,
};

const inputs: ScoreInputs = {
  before: { L: 300, complexity: 30, dupMass: 12 },
  after: { L: 240, complexity: 24, dupMass: 10 },
  testsPass: true,
  fenceUsable: true,
  blockedRegions: [],
  touchedFidelities: [0.95],
  diffsize: 20,
  typeErrors: 0,
  baselineTypeErrors: 0,
  weights,
  scales: null,
};

const metric = metricContext({
  confidence: "calibrated",
  weights,
  provenance: {
    baselineSha: "a".repeat(40),
    configHash: "config",
    artifactHashes: {
      fence: "fence-hash",
      calibration: "calibration-hash",
      changecost: "changecost-hash",
      valueProxy: "missing",
    },
    toolchain: {
      node: "v22.0.0",
      codenuke: "0.5.0",
      typescript: "5.7",
    },
  },
});

describe("metric vectors", () => {
  it("pins gain/risk/loss and v2 envelope JSON deterministically", () => {
    const verdict = decide(inputs);
    expect(verdict.dL).toBe(60);
    expect(verdict.dCx).toBe(6);
    expect(verdict.dDup).toBe(2);
    expect(verdict.mfence).toBe(0.95);
    expect(verdict.gain).toBeCloseTo(1.26, 12);
    expect(verdict.risk).toBeCloseTo(0.09, 12);
    expect(verdict.loss).toBeCloseTo(-1.17, 12);
    expect(verdict.keep).toBe(true);

    const envelope = scoreEnvelope({ verdict, metric });
    expect(envelope).toMatchObject({
      schemaVersion: 2,
      _tag: "Scored",
      status: "accepted",
      guardrails: { passed: true, failures: [] },
      metric: { confidence: "calibrated" },
    });
    expect(JSON.stringify(envelope)).toBe(JSON.stringify(scoreEnvelope({ verdict: decide(inputs), metric })));
  });

  it("pins guardrail failure status and null verdict blocked envelope", () => {
    const envelope = scoreEnvelope({
      verdict: null,
      metric,
      guardrails: guardrailReport([
        { code: "probation-diffsize", message: "probation diffsize cap is 80", severity: "block" },
      ]),
    });
    expect(envelope.status).toBe("blocked");
    expect(envelope.verdict).toBeNull();
    expect(envelope.guardrails.failures).toEqual([
      { code: "probation-diffsize", message: "probation diffsize cap is 80", severity: "block" },
    ]);
  });
});
