import { describe, expect, it } from "@effect/vitest"
import {
  ConfigInvalid,
  DEFAULT_FENCE_LB,
  DEFAULT_PROPOSER_TIMEOUT_MS,
  rejectShellStringEnv,
  resolveProposerConfig,
  resolveProposerLimits,
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

describe("config — Codex proposer env knobs", () => {
  it("resolves model, reasoning, sandbox, approval, timeout, and budget from CN_* env", () => {
    const r = resolveProposerConfig({
      CN_MODEL: " gpt-5-codex ",
      CN_REASONING_EFFORT: " medium ",
      CN_CODEX_SANDBOX: " read-only ",
      CN_CODEX_APPROVAL_POLICY: " on-request ",
      CN_PROPOSER_TIMEOUT_MS: " 1234 ",
      CN_PROPOSER_BUDGET_USD: " 2.50 ",
    })
    expect(r).not.toBeInstanceOf(ConfigInvalid)
    if (!(r instanceof ConfigInvalid)) {
      expect(r).toMatchObject({
        proposerModel: "gpt-5-codex",
        proposerReasoningEffort: "medium",
        codexSandboxMode: "read-only",
        codexApprovalPolicy: "on-request",
        proposerTimeoutMs: 1234,
        proposerBudgetUsd: "2.50",
      })
    }
  })

  it("uses defaults for blank proposer env knobs", () => {
    const r = resolveProposerConfig({
      CN_MODEL: " ",
      CN_REASONING_EFFORT: " ",
      CN_CODEX_SANDBOX: " ",
      CN_CODEX_APPROVAL_POLICY: " ",
      CN_PROPOSER_TIMEOUT_MS: " ",
      CN_PROPOSER_BUDGET_USD: " ",
    })
    expect(r).not.toBeInstanceOf(ConfigInvalid)
    if (!(r instanceof ConfigInvalid)) {
      expect(r).toMatchObject({
        proposerTimeoutMs: 900_000,
        proposerBudgetUsd: "8",
        codexSandboxMode: "workspace-write",
        codexApprovalPolicy: "never",
      })
      expect(r.proposerModel).toBeUndefined()
      expect(r.proposerReasoningEffort).toBeUndefined()
    }
  })

  it("normalizes sandbox aliases to danger-full-access", () => {
    for (const value of ["bypass", "none"]) {
      const r = resolveProposerConfig({ CN_CODEX_SANDBOX: value })
      expect(r).not.toBeInstanceOf(ConfigInvalid)
      if (!(r instanceof ConfigInvalid)) expect(r.codexSandboxMode).toBe("danger-full-access")
    }
  })

  it("rejects invalid reasoning effort before an agent run is assembled", () => {
    const e = resolveProposerConfig({ CN_REASONING_EFFORT: "maximum" })
    expect(e).toBeInstanceOf(ConfigInvalid)
    if (e instanceof ConfigInvalid) expect(e.key).toBe("CN_REASONING_EFFORT")
  })

  it("resolves generic proposer limits without validating Codex-only knobs", () => {
    const r = resolveProposerLimits({
      CN_REASONING_EFFORT: "maximum",
      CN_CODEX_SANDBOX: "invalid",
      CN_PROPOSER_TIMEOUT_MS: "1234",
      CN_PROPOSER_BUDGET_USD: "2.50",
    })
    expect(r).toEqual({ proposerTimeoutMs: 1234, proposerBudgetUsd: "2.50" })
  })

  it("rejects invalid sandbox, approval, and non-integer timeout env values", () => {
    const sandbox = resolveProposerConfig({ CN_CODEX_SANDBOX: "open" })
    expect(sandbox).toBeInstanceOf(ConfigInvalid)
    if (sandbox instanceof ConfigInvalid) expect(sandbox.key).toBe("CN_CODEX_SANDBOX")

    const approval = resolveProposerConfig({ CN_CODEX_APPROVAL_POLICY: "always" })
    expect(approval).toBeInstanceOf(ConfigInvalid)
    if (approval instanceof ConfigInvalid) expect(approval.key).toBe("CN_CODEX_APPROVAL_POLICY")

    const timeout = resolveProposerConfig({ CN_PROPOSER_TIMEOUT_MS: "1.5" })
    expect(timeout).toBeInstanceOf(ConfigInvalid)
    if (timeout instanceof ConfigInvalid) expect(timeout.key).toBe("CN_PROPOSER_TIMEOUT_MS")
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
