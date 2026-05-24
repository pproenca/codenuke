import { describe, expect, it } from "@effect/vitest"
import {
  ConfigInvalid,
  DEFAULT_FENCE_LB,
  DEFAULT_PROPOSER_TIMEOUT_MS,
  rejectShellStringEnv,
  ShellStringRejected,
  validateCommandSpec,
  validateNumerics,
} from "../src/config/config.ts"

describe("config — RULE-048 (reject legacy shell-string commands)", () => {
  it("RULE-048 CN_TEST set as a string is rejected with ShellStringRejected", () => {
    const e = rejectShellStringEnv({ CN_TEST: "npm test" })
    expect(e).toBeInstanceOf(ShellStringRejected)
    expect(e?.envVar).toBe("CN_TEST")
  })

  it("RULE-048 CN_TYPECHECK / CN_PROPOSER / CN_IMPLEMENTER are each rejected", () => {
    for (const k of ["CN_TYPECHECK", "CN_PROPOSER", "CN_IMPLEMENTER"]) {
      const e = rejectShellStringEnv({ [k]: "x" })
      expect(e).toBeInstanceOf(ShellStringRejected)
      expect(e?.envVar).toBe(k)
    }
  })

  it("RULE-048 a clean env (no shell-string vars) passes", () => {
    expect(rejectShellStringEnv({ PATH: "/usr/bin", CN_TAG: "run" })).toBeNull()
  })

  it("RULE-048 a CommandSpec string value is rejected; an object resolves", () => {
    expect(validateCommandSpec("testCommand", "npm test")).toBeInstanceOf(ShellStringRejected)
    const ok = validateCommandSpec("testCommand", { file: "npm", args: ["test"] })
    expect(ok).toEqual({ file: "npm", args: ["test"], timeoutMs: undefined, env: undefined })
  })

  it("RULE-048 a CommandSpec with non-string args is ConfigInvalid (JSON-array-of-strings)", () => {
    const e = validateCommandSpec("testCommand", { file: "npm", args: [1, 2] })
    expect(e).toBeInstanceOf(ConfigInvalid)
  })

  it("RULE-048 an empty file is ConfigInvalid", () => {
    expect(validateCommandSpec("testCommand", { file: "" })).toBeInstanceOf(ConfigInvalid)
  })
})

describe("config — RULE-049 (numeric / weight bounds)", () => {
  it("RULE-049 no overrides → fenceLB==0.9, proposerTimeoutMs==900000", () => {
    const r = validateNumerics({})
    expect(r).not.toBeInstanceOf(ConfigInvalid)
    if (!(r instanceof ConfigInvalid)) {
      expect(r.fenceLB).toBe(DEFAULT_FENCE_LB)
      expect(r.proposerTimeoutMs).toBe(DEFAULT_PROPOSER_TIMEOUT_MS)
    }
  })

  it("RULE-049 CN_FENCE_LB=1.5 (out of [0,1]) → ConfigInvalid naming fenceLB", () => {
    const e = validateNumerics({ fenceLB: 1.5 })
    expect(e).toBeInstanceOf(ConfigInvalid)
    if (e instanceof ConfigInvalid) expect(e.key).toBe("fenceLB")
  })

  it("RULE-049 a weight override dCx=\"abc\" → ConfigInvalid naming dCx", () => {
    const e = validateNumerics({ weights: { dCx: "abc" } })
    expect(e).toBeInstanceOf(ConfigInvalid)
    if (e instanceof ConfigInvalid) expect(e.key).toBe("weights.dCx")
  })

  it("RULE-049 a valid weight override is applied", () => {
    const r = validateNumerics({ weights: { dCx: 2.5 } })
    expect(r).not.toBeInstanceOf(ConfigInvalid)
    if (!(r instanceof ConfigInvalid)) expect(r.weights.dCx).toBe(2.5)
  })

  it("RULE-049 a non-positive timeout → ConfigInvalid", () => {
    expect(validateNumerics({ proposerTimeoutMs: 0 })).toBeInstanceOf(ConfigInvalid)
    expect(validateNumerics({ testTimeoutMs: -1 })).toBeInstanceOf(ConfigInvalid)
  })

  it("RULE-049 the three timeout knobs default independently", () => {
    const r = validateNumerics({})
    if (!(r instanceof ConfigInvalid)) {
      expect(r.proposerTimeoutMs).toBe(900_000)
      expect(r.testTimeoutMs).toBe(300_000)
      expect(r.fenceTimeoutMs).toBe(45_000)
    }
  })
})
