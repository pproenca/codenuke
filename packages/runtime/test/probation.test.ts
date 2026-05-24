import { describe, expect, it } from "@effect/vitest"
import { metricContext, scoreEnvelope, type ScoreEnvelope, type Verdict } from "@codenuke/core"
import { rejectedScoreReason } from "../src/loop/loop.ts"
import { probationGuardrails } from "../src/score/score.ts"

const failures = (overrides: Partial<Parameters<typeof probationGuardrails>[0]> = {}) =>
  probationGuardrails({
    probation: true,
    changed: ["src/a.ts"],
    allChanged: ["src/a.ts"],
    diffsize: 10,
    before: { "src/a.ts": "export const a = 1\n" },
    after: { "src/a.ts": "export const a = 2\n" },
    beforeGraph: { "src/a.ts": "export const a = 1\n" },
    afterGraph: { "src/a.ts": "export const a = 2\n" },
    ...overrides,
  }).map((failure) => failure.code)

describe("probation guardrails", () => {
  it("rejects multi-file and oversized source edits", () => {
    expect(
      failures({
        allChanged: ["src/a.ts", "src/b.ts"],
        diffsize: 81,
        before: { "src/a.ts": "export const a = 1\n", "src/b.ts": "export const b = 1\n" },
        after: { "src/a.ts": "export const a = 2\n", "src/b.ts": "export const b = 2\n" },
      }),
    ).toEqual(expect.arrayContaining(["probation-too-many-files", "probation-diffsize"]))
  })

  it("rejects config, lockfile, test, generated, and binary/snapshot edits", () => {
    expect(
      failures({
        allChanged: [
          "package.json",
          "pnpm-lock.yaml",
          "src/a.test.ts",
          "src/generated/client.ts",
          "fixtures/output.snap",
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        "dependency-config-edit",
        "test-edit",
        "generated-binary-edit",
      ]),
    )
  })

  it("rejects public export surface changes", () => {
    expect(
      failures({
        before: { "src/a.ts": "export const a = 1\n" },
        after: { "src/a.ts": "export const renamed = 1\n" },
      }),
    ).toContain("public-api-change")
  })

  it("rejects star re-export surface changes", () => {
    expect(
      failures({
        before: { "src/a.ts": "export * from './public-a'\n" },
        after: { "src/a.ts": "export * from './public-b'\n" },
      }),
    ).toContain("public-api-change")
  })

  it("rejects new import cycles when detectable", () => {
    expect(
      failures({
        allChanged: ["src/a.ts", "src/b.ts"],
        beforeGraph: {
          "src/a.ts": "import { b } from './b'\nexport const a = b\n",
          "src/b.ts": "export const b = 1\n",
        },
        afterGraph: {
          "src/a.ts": "import { b } from './b'\nexport const a = b\n",
          "src/b.ts": "import { a } from './a'\nexport const b = a\n",
        },
      }),
    ).toContain("import-cycle")
  })
})

const metric = metricContext({
  confidence: "bootstrap",
  weights: {
    dL: 1,
    dCx: 1.8,
    dDup: 0.35,
    scaleL: 150,
    scaleCx: 15,
    scaleDup: 5,
    r3: 1,
  },
  provenance: {
    baselineSha: "a".repeat(40),
    configHash: "config",
    artifactHashes: {},
    toolchain: {},
  },
})

const keepVerdict: Verdict = {
  admissible: true,
  keep: true,
  loss: -1,
  gain: 2,
  risk: 1,
  mfence: 1,
  gates: { G1: true, G1prime: true, G3: true, G4: true },
  failedGates: [],
  dL: 10,
  dCx: 0,
  dDup: 0,
}

describe("loop rejection reporting", () => {
  it("reports guardrail codes before negative loss for rejected envelopes", () => {
    const envelope: ScoreEnvelope = scoreEnvelope({
      verdict: keepVerdict,
      metric,
      guardrails: {
        passed: false,
        failures: [
          {
            code: "public-api-change",
            message: "probation rejects changed public exports",
            severity: "reject",
            path: "src/a.ts",
          },
        ],
      },
    })

    expect(envelope.status).toBe("rejected")
    expect(envelope.verdict?.keep).toBe(true)
    expect(rejectedScoreReason(envelope)).toBe("public-api-change")
  })
})
