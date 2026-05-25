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

  it("rejects type-only named export surface changes", () => {
    expect(
      failures({
        before: { "src/a.ts": "export type { A }\nexport { type B }\n" },
        after: { "src/a.ts": "export type { Renamed }\nexport { type B }\n" },
      }),
    ).toContain("public-api-change")
  })

  it("rejects value export changes when the local binding is named type", () => {
    expect(
      failures({
        before: { "src/a.ts": "const type = 1\nexport { type as oldName }\n" },
        after: { "src/a.ts": "const type = 1\nexport { type as newName }\n" },
      }),
    ).toContain("public-api-change")
  })

  it("rejects changes between value and type-only exports", () => {
    expect(
      failures({
        before: { "src/a.ts": "const Foo = 1\nexport { Foo }\n" },
        after: { "src/a.ts": "type Foo = number\nexport type { Foo }\n" },
      }),
    ).toContain("public-api-change")
  })

  it("rejects changes between runtime and type-only default exports", () => {
    expect(
      failures({
        before: { "src/a.ts": "export default class Foo {}\n" },
        after: { "src/a.ts": "export default interface Foo {}\n" },
      }),
    ).toContain("public-api-change")
  })

  it("rejects changes that remove class type exports", () => {
    expect(
      failures({
        before: { "src/a.ts": "export class Foo {}\n" },
        after: { "src/a.ts": "export const Foo = 1\n" },
      }),
    ).toContain("public-api-change")
  })

  it("allows moving class declarations behind named exports", () => {
    expect(
      failures({
        before: { "src/a.ts": "export class Foo {}\n" },
        after: { "src/a.ts": "class Foo {}\nexport { Foo }\n" },
      }),
    ).not.toContain("public-api-change")
  })

  it("rejects removing a same-name local type surface from a named export", () => {
    expect(
      failures({
        before: { "src/a.ts": "type Foo = number\nconst Foo = 1\nexport { Foo }\n" },
        after: { "src/a.ts": "const Foo = 1\nexport { Foo }\n" },
      }),
    ).toContain("public-api-change")
  })

  it("rejects changes that remove default class type exports", () => {
    expect(
      failures({
        before: { "src/a.ts": "export default class Foo {}\n" },
        after: { "src/a.ts": "export default function Foo() {}\n" },
      }),
    ).toContain("public-api-change")
  })

  it("allows moving default class declarations behind identifier exports", () => {
    expect(
      failures({
        before: { "src/a.ts": "export default class Foo {}\n" },
        after: { "src/a.ts": "class Foo {}\nexport default Foo\n" },
      }),
    ).not.toContain("public-api-change")
  })

  it("rejects removing default class type surfaces through identifier exports", () => {
    expect(
      failures({
        before: { "src/a.ts": "class Foo {}\nexport default Foo\n" },
        after: { "src/a.ts": "function Foo() {}\nexport default Foo\n" },
      }),
    ).toContain("public-api-change")
  })

  it("does not use local declarations to classify re-export clauses", () => {
    expect(
      failures({
        before: { "src/a.ts": "type Foo = number\nexport { Foo } from './mod'\n" },
        after: { "src/a.ts": "type Foo = number\nexport type { Foo } from './mod'\n" },
      }),
    ).toContain("public-api-change")
  })

  it("rejects exported namespace member changes", () => {
    expect(
      failures({
        before: { "src/a.ts": "export namespace API { export const oldName = 1 }\n" },
        after: { "src/a.ts": "export namespace API { export const newName = 1 }\n" },
      }),
    ).toContain("public-api-change")
  })

  it("rejects local namespace member changes when exposed by named export", () => {
    expect(
      failures({
        before: { "src/a.ts": "namespace API { export const oldName = 1 }\nexport { API }\n" },
        after: { "src/a.ts": "namespace API { export const newName = 1 }\nexport { API }\n" },
      }),
    ).toContain("public-api-change")
  })

  it("rejects merged namespace member changes when exposed by named export", () => {
    expect(
      failures({
        before: {
          "src/a.ts": "namespace API { export const oldName = 1 }\nnamespace API { export const stable = 1 }\nexport { API }\n",
        },
        after: {
          "src/a.ts": "namespace API { export const newName = 1 }\nnamespace API { export const stable = 1 }\nexport { API }\n",
        },
      }),
    ).toContain("public-api-change")
  })

  it("rejects ambient module export changes", () => {
    expect(
      failures({
        changed: ["src/a.d.ts"],
        allChanged: ["src/a.d.ts"],
        before: { "src/a.d.ts": 'declare module "pkg" { export const oldName: string }\n' },
        after: { "src/a.d.ts": 'declare module "pkg" { export const newName: string }\n' },
      }),
    ).toContain("public-api-change")
  })

  it("rejects implicit ambient module declaration changes", () => {
    expect(
      failures({
        changed: ["src/a.d.ts"],
        allChanged: ["src/a.d.ts"],
        before: { "src/a.d.ts": 'declare module "pkg" { interface Old {} }\n' },
        after: { "src/a.d.ts": 'declare module "pkg" { interface New {} }\n' },
      }),
    ).toContain("public-api-change")
  })

  it("rejects type-only namespace member changes", () => {
    expect(
      failures({
        before: { "src/a.ts": "namespace API { export interface Old {} }\nexport type { API }\n" },
        after: { "src/a.ts": "namespace API { export interface New {} }\nexport type { API }\n" },
      }),
    ).toContain("public-api-change")
  })

  it("rejects top-level ambient declaration changes", () => {
    expect(
      failures({
        changed: ["src/a.d.ts"],
        allChanged: ["src/a.d.ts"],
        before: { "src/a.d.ts": "interface Old {}\n" },
        after: { "src/a.d.ts": "interface New {}\n" },
      }),
    ).toContain("public-api-change")
  })

  it("rejects top-level ambient namespace member changes", () => {
    expect(
      failures({
        changed: ["src/a.d.ts"],
        allChanged: ["src/a.d.ts"],
        before: { "src/a.d.ts": "declare namespace API { interface Old {} }\n" },
        after: { "src/a.d.ts": "declare namespace API { interface New {} }\n" },
      }),
    ).toContain("public-api-change")
  })

  it("rejects dotted ambient namespace member changes", () => {
    expect(
      failures({
        changed: ["src/a.d.ts"],
        allChanged: ["src/a.d.ts"],
        before: { "src/a.d.ts": "declare namespace React.JSX { interface Old {} }\n" },
        after: { "src/a.d.ts": "declare namespace React.JSX { interface New {} }\n" },
      }),
    ).toContain("public-api-change")
  })

  it("rejects export assignment surface changes", () => {
    expect(
      failures({
        changed: ["src/a.d.ts"],
        allChanged: ["src/a.d.ts"],
        before: { "src/a.d.ts": "declare class Foo {}\nexport = Foo\n" },
        after: { "src/a.d.ts": "declare function Foo(): void\nexport = Foo\n" },
      }),
    ).toContain("public-api-change")
  })

  it("allows private declaration changes in external declaration files", () => {
    expect(
      failures({
        changed: ["src/a.d.ts"],
        allChanged: ["src/a.d.ts"],
        before: { "src/a.d.ts": "export {}\ninterface Old {}\n" },
        after: { "src/a.d.ts": "export {}\ninterface New {}\n" },
      }),
    ).not.toContain("public-api-change")
  })

  it("rejects exported declaration namespace member changes in external declaration files", () => {
    expect(
      failures({
        changed: ["src/a.d.ts"],
        allChanged: ["src/a.d.ts"],
        before: { "src/a.d.ts": "export {}\nexport namespace API { interface Old {} }\n" },
        after: { "src/a.d.ts": "export {}\nexport namespace API { interface New {} }\n" },
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
