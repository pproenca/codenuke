/**
 * Config resolution service (env → codenuke.loop.json → autodetect).
 *
 * Owns RULE-026 (surface — partial), RULE-033/034 (file/region classification),
 * RULE-048 (reject legacy shell-string commands), RULE-049 (numeric/weight bounds).
 *
 * The PURE validators (RULE-048, RULE-049) are implemented here for real and
 * are unit-tested. The effectful resolver (`ConfigLive`) reads the filesystem /
 * env and is a stub (`Effect.die("unimplemented: RULE-033/034")`).
 *
 * Cross-package contract: `Config`, `CommandSpec`, `Weights`, `ConfigInvalid`,
 * `ShellStringRejected` are owned by `@codenuke/core/domain`. We import them when
 * available; the pure validators below operate on plain inputs and return/raise
 * the core error types so they remain the single source of truth for shapes.
 */
import { Context, Data, Effect, Layer } from "effect"

// ---------------------------------------------------------------------------
// Constants (preserved exactly from legacy / INTERFACE_CONTRACTS §C-D)
// ---------------------------------------------------------------------------
export const DEFAULT_FENCE_LB = 0.9
export const DEFAULT_PROPOSER_TIMEOUT_MS = 900_000
export const DEFAULT_PROPOSER_BUDGET_USD = "8"
export const DEFAULT_CODEX_SANDBOX_MODE = "workspace-write" as const
export const DEFAULT_CODEX_APPROVAL_POLICY = "never" as const
/** New knobs added per architecture §7 (three distinct timeout knobs). */
export const DEFAULT_TEST_TIMEOUT_MS = 300_000
export const DEFAULT_FENCE_TIMEOUT_MS = 45_000

export const DEFAULT_WEIGHTS = {
  dL: 1.0,
  dCx: 1.8,
  dDup: 0.35,
  r3: 1.0,
  scaleL: 150,
  scaleCx: 15,
  scaleDup: 5,
} as const

/** The four legacy shell-string command env vars rejected on sight (RULE-048). */
export const REJECTED_SHELL_STRING_ENV = [
  "CN_TEST",
  "CN_TYPECHECK",
  "CN_PROPOSER",
  "CN_IMPLEMENTER",
] as const

// ---------------------------------------------------------------------------
// Local error fallbacks.
//
// The authoritative `ConfigInvalid` / `ShellStringRejected` live in
// `@codenuke/core`. Until that package's `src/index.ts` exists we define
// structurally-compatible local tagged errors so this package builds. Tests
// that need the *exact* core errors guard their import (see test/config.test.ts).
// ---------------------------------------------------------------------------
export class ShellStringRejected extends Data.TaggedError("ShellStringRejected")<{
  readonly envVar: string
  readonly message: string
}> {}

export class ConfigInvalid extends Data.TaggedError("ConfigInvalid")<{
  readonly key: string
  readonly message: string
}> {}

// ---------------------------------------------------------------------------
// PURE validators — RULE-048
// ---------------------------------------------------------------------------

/**
 * RULE-048 — reject legacy shell-string command env vars.
 *
 * Given the raw environment, if any of CN_TEST/CN_TYPECHECK/CN_PROPOSER/
 * CN_IMPLEMENTER is set (as a string), fail with `ShellStringRejected` carrying
 * a migration message. Pure: `Record<string,string|undefined> -> Either-ish`.
 */
export const rejectShellStringEnv = (
  env: Record<string, string | undefined>,
): ShellStringRejected | null => {
  for (const key of REJECTED_SHELL_STRING_ENV) {
    const v = env[key]
    if (typeof v === "string" && v.length > 0) {
      return new ShellStringRejected({
        envVar: key,
        message: `${key} is a legacy shell string and is no longer accepted. Use ${key}_FILE + ${key}_ARGS_JSON (a CommandSpec).`,
      })
    }
  }
  return null
}

/** Raw CommandSpec input as it arrives from config/env (before validation). */
export interface CommandSpecInput {
  readonly file?: unknown
  readonly args?: unknown
  readonly timeoutMs?: unknown
  readonly env?: unknown
}

export interface CommandSpec {
  readonly file: string
  readonly args: readonly string[]
  readonly timeoutMs?: number
  readonly env?: Record<string, string>
}

/**
 * RULE-048 (CommandSpec validation half) — a string value is rejected; an object
 * must have a non-empty `file`, `args` as `string[]`, `timeoutMs` finite > 0,
 * `env` a string record.
 */
export const validateCommandSpec = (
  key: string,
  spec: unknown,
): CommandSpec | ConfigInvalid | ShellStringRejected => {
  if (typeof spec === "string") {
    return new ShellStringRejected({
      envVar: key,
      message: `${key} no longer accepts shell strings; provide a CommandSpec object { file, args }`,
    })
  }
  if (spec === null || typeof spec !== "object") {
    return new ConfigInvalid({ key, message: `${key} must be a CommandSpec object` })
  }
  const s = spec as CommandSpecInput
  if (typeof s.file !== "string" || s.file.length === 0) {
    return new ConfigInvalid({ key, message: `${key}.file must be a non-empty string` })
  }
  let args: readonly string[] = []
  if (s.args !== undefined) {
    if (!Array.isArray(s.args) || !s.args.every((a) => typeof a === "string")) {
      return new ConfigInvalid({ key, message: `${key}.args must be a JSON array of strings` })
    }
    args = s.args as readonly string[]
  }
  let timeoutMs: number | undefined
  if (s.timeoutMs !== undefined) {
    if (typeof s.timeoutMs !== "number" || !Number.isFinite(s.timeoutMs) || s.timeoutMs <= 0) {
      return new ConfigInvalid({ key, message: `${key}.timeoutMs must be a finite number > 0` })
    }
    timeoutMs = s.timeoutMs
  }
  let env: Record<string, string> | undefined
  if (s.env !== undefined) {
    if (s.env === null || typeof s.env !== "object" || Array.isArray(s.env)) {
      return new ConfigInvalid({ key, message: `${key}.env must be a string record` })
    }
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(s.env as Record<string, unknown>)) {
      if (typeof v !== "string") {
        return new ConfigInvalid({ key, message: `${key}.env.${k} must be a string` })
      }
      out[k] = v
    }
    env = out
  }
  return { file: s.file, args, timeoutMs, env }
}

// ---------------------------------------------------------------------------
// PURE validators — RULE-049 (numeric / weight bounds)
// ---------------------------------------------------------------------------

export interface NumericInputs {
  readonly fenceLB?: unknown
  readonly proposerTimeoutMs?: unknown
  readonly testTimeoutMs?: unknown
  readonly fenceTimeoutMs?: unknown
  readonly weights?: unknown
}

export interface ResolvedNumerics {
  readonly fenceLB: number
  readonly proposerTimeoutMs: number
  readonly testTimeoutMs: number
  readonly fenceTimeoutMs: number
  readonly weights: typeof DEFAULT_WEIGHTS
}

export type ProposerReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh"
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access"
export type CodexApprovalPolicy = "on-request" | "on-failure" | "untrusted" | "never"

export interface ResolvedProposerConfig {
  readonly proposerTimeoutMs: number
  readonly proposerBudgetUsd: string
  readonly proposerModel?: string
  readonly proposerReasoningEffort?: ProposerReasoningEffort
  readonly codexSandboxMode: CodexSandboxMode
  readonly codexApprovalPolicy: CodexApprovalPolicy
}

export interface ResolvedProposerLimits {
  readonly proposerTimeoutMs: number
  readonly proposerBudgetUsd: string
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

const REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh"] as const
const CODEX_SANDBOX_MODES = ["read-only", "workspace-write", "danger-full-access"] as const
const CODEX_SANDBOX_ALIASES = {
  bypass: "danger-full-access",
  none: "danger-full-access",
} as const
const CODEX_APPROVAL_POLICIES = ["on-request", "on-failure", "untrusted", "never"] as const

type Env = Record<string, string | undefined>

const envValue = (env: Env, key: string): string | undefined => {
  const value = env[key]?.trim()
  return value === "" ? undefined : value
}

const envValueAny = (env: Env, keys: readonly string[]): string | undefined => {
  for (const key of keys) {
    const value = envValue(env, key)
    if (value !== undefined) return value
  }
  return undefined
}

const envEntryAny = (env: Env, keys: readonly string[]): readonly [string, string] | undefined => {
  for (const key of keys) {
    const value = envValue(env, key)
    if (value !== undefined) return [key, value]
  }
  return undefined
}

const isOneOf = <T extends string>(value: string, values: readonly T[]): value is T =>
  values.some((v) => v === value)

function parseEnumEnv<T extends string>(opts: {
  readonly key: string
  readonly value: string | undefined
  readonly fallback: T
  readonly values: readonly T[]
  readonly aliases?: Readonly<Record<string, T>>
  readonly message: string
}): T | ConfigInvalid
function parseEnumEnv<T extends string>(opts: {
  readonly key: string
  readonly value: string | undefined
  readonly values: readonly T[]
  readonly aliases?: Readonly<Record<string, T>>
  readonly message: string
}): T | ConfigInvalid | undefined
function parseEnumEnv<T extends string>(opts: {
  readonly key: string
  readonly value: string | undefined
  readonly fallback?: T
  readonly values: readonly T[]
  readonly aliases?: Readonly<Record<string, T>>
  readonly message: string
}): T | ConfigInvalid | undefined {
  if (opts.value === undefined) return opts.fallback
  const alias = opts.aliases?.[opts.value]
  if (alias !== undefined) return alias
  if (isOneOf(opts.value, opts.values)) return opts.value
  return new ConfigInvalid({ key: opts.key, message: opts.message })
}

/**
 * RULE-049 — bounds-check numeric settings & weight overrides.
 *   fenceLB ∈ [0,1] (default 0.9); proposerTimeoutMs/testTimeoutMs/fenceTimeoutMs
 *   finite > 0; each weight override finite (else fail, naming the key);
 *   `weights` (if present) must be a plain object.
 */
export const validateNumerics = (input: NumericInputs): ResolvedNumerics | ConfigInvalid => {
  let fenceLB = DEFAULT_FENCE_LB
  if (input.fenceLB !== undefined) {
    if (!isFiniteNumber(input.fenceLB) || input.fenceLB < 0 || input.fenceLB > 1) {
      return new ConfigInvalid({ key: "fenceLB", message: "fenceLB must be a finite number in [0,1]" })
    }
    fenceLB = input.fenceLB
  }

  const timeout = (
    key: "proposerTimeoutMs" | "testTimeoutMs" | "fenceTimeoutMs",
    raw: unknown,
    def: number,
  ): number | ConfigInvalid => {
    if (raw === undefined) return def
    if (!isFiniteNumber(raw) || raw <= 0) {
      return new ConfigInvalid({ key, message: `${key} must be a finite number > 0` })
    }
    return raw
  }

  const proposerTimeoutMs = timeout("proposerTimeoutMs", input.proposerTimeoutMs, DEFAULT_PROPOSER_TIMEOUT_MS)
  if (proposerTimeoutMs instanceof ConfigInvalid) return proposerTimeoutMs
  const testTimeoutMs = timeout("testTimeoutMs", input.testTimeoutMs, DEFAULT_TEST_TIMEOUT_MS)
  if (testTimeoutMs instanceof ConfigInvalid) return testTimeoutMs
  const fenceTimeoutMs = timeout("fenceTimeoutMs", input.fenceTimeoutMs, DEFAULT_FENCE_TIMEOUT_MS)
  if (fenceTimeoutMs instanceof ConfigInvalid) return fenceTimeoutMs

  let weights = { ...DEFAULT_WEIGHTS }
  if (input.weights !== undefined) {
    if (input.weights === null || typeof input.weights !== "object" || Array.isArray(input.weights)) {
      return new ConfigInvalid({ key: "weights", message: "weights must be a JSON object" })
    }
    const overrides = input.weights as Record<string, unknown>
    for (const [k, v] of Object.entries(overrides)) {
      if (!(k in DEFAULT_WEIGHTS)) {
        return new ConfigInvalid({ key: `weights.${k}`, message: `unknown weight key ${k}` })
      }
      if (!isFiniteNumber(v)) {
        return new ConfigInvalid({ key: `weights.${k}`, message: `weight ${k} must be a finite number` })
      }
      ;(weights as Record<string, number>)[k] = v
    }
  }

  return { fenceLB, proposerTimeoutMs, testTimeoutMs, fenceTimeoutMs, weights }
}

const parsePositiveIntegerValue = (
  key: string,
  value: string | undefined,
  fallback: number,
): number | ConfigInvalid => {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    return new ConfigInvalid({ key, message: `${key} must be a positive integer` })
  }
  return parsed
}

const parseReasoningEffort = (
  env: Env,
): ProposerReasoningEffort | ConfigInvalid | undefined =>
  parseEnumEnv({
    key: "CN_REASONING_EFFORT",
    value: envValue(env, "CN_REASONING_EFFORT"),
    values: REASONING_EFFORTS,
    message: "CN_REASONING_EFFORT must be one of minimal, low, medium, high, xhigh",
  })

const parseSandboxMode = (env: Env): CodexSandboxMode | ConfigInvalid =>
  parseEnumEnv({
    key: "CN_CODEX_SANDBOX",
    value: envValue(env, "CN_CODEX_SANDBOX"),
    fallback: DEFAULT_CODEX_SANDBOX_MODE,
    values: CODEX_SANDBOX_MODES,
    aliases: CODEX_SANDBOX_ALIASES,
    message: "CN_CODEX_SANDBOX must be read-only, workspace-write, danger-full-access, bypass, or none",
  })

const parseApprovalPolicy = (env: Env): CodexApprovalPolicy | ConfigInvalid =>
  parseEnumEnv({
    key: "CN_CODEX_APPROVAL_POLICY",
    value: envValue(env, "CN_CODEX_APPROVAL_POLICY"),
    fallback: DEFAULT_CODEX_APPROVAL_POLICY,
    values: CODEX_APPROVAL_POLICIES,
    message: "CN_CODEX_APPROVAL_POLICY must be one of on-request, on-failure, untrusted, never",
  })

/**
 * Interim pure env resolver for Codex proposer knobs. Delete this once ConfigLive
 * owns env/file/autodetect resolution end-to-end.
 */
export const resolveProposerConfig = (
  env: Env,
): ResolvedProposerConfig | ConfigInvalid => {
  const limits = resolveProposerLimits(env)
  if (limits instanceof ConfigInvalid) return limits
  const proposerReasoningEffort = parseReasoningEffort(env)
  if (proposerReasoningEffort instanceof ConfigInvalid) return proposerReasoningEffort
  const codexSandboxMode = parseSandboxMode(env)
  if (codexSandboxMode instanceof ConfigInvalid) return codexSandboxMode
  const codexApprovalPolicy = parseApprovalPolicy(env)
  if (codexApprovalPolicy instanceof ConfigInvalid) return codexApprovalPolicy

  const proposerModel = envValue(env, "CN_MODEL")
  return {
    ...limits,
    ...(proposerModel ? { proposerModel } : {}),
    ...(proposerReasoningEffort ? { proposerReasoningEffort } : {}),
    codexSandboxMode,
    codexApprovalPolicy,
  }
}

export const resolveProposerLimits = (
  env: Env,
): ResolvedProposerLimits | ConfigInvalid => {
  const timeoutEntry = envEntryAny(env, ["CN_PROPOSER_TIMEOUT_MS", "CN_TIMEOUT"])
  const proposerTimeoutMs = parsePositiveIntegerValue(
    timeoutEntry?.[0] ?? "CN_PROPOSER_TIMEOUT_MS",
    timeoutEntry?.[1],
    DEFAULT_PROPOSER_TIMEOUT_MS,
  )
  if (proposerTimeoutMs instanceof ConfigInvalid) return proposerTimeoutMs
  const proposerBudgetUsd =
    envValueAny(env, ["CN_PROPOSER_BUDGET_USD", "CN_BUDGET"]) ?? DEFAULT_PROPOSER_BUDGET_USD
  return { proposerTimeoutMs, proposerBudgetUsd }
}

// ---------------------------------------------------------------------------
// Resolved Config shape (mirrors @codenuke/core `Config`; runtime carries the
// three timeout knobs added in architecture §7).
// ---------------------------------------------------------------------------
export interface ResolvedConfig {
  readonly repo: string
  readonly srcDir: string
  readonly target: string
  readonly baseline: string
  readonly tag: string
  readonly regions: readonly string[]
  readonly worktree: string
  readonly state: string
  readonly fenceArtifact: string
  readonly results: string
  readonly program: string
  readonly benchmarkDir: string
  readonly fenceLB: number
  readonly proposerTimeoutMs: number
  readonly proposerBudgetUsd: string
  readonly proposerModel?: string
  readonly proposerReasoningEffort?: ProposerReasoningEffort
  readonly codexSandboxMode: CodexSandboxMode
  readonly codexApprovalPolicy: CodexApprovalPolicy
  readonly testTimeoutMs: number
  readonly fenceTimeoutMs: number
  readonly weights: typeof DEFAULT_WEIGHTS
  readonly testCommand: CommandSpec | null
  readonly typeCheckCommand: CommandSpec | null
  readonly implementerCommand: CommandSpec | null
}

// ---------------------------------------------------------------------------
// Config service (Context.Tag + Layer). Live body resolves env→file→autodetect.
// ---------------------------------------------------------------------------
export class Config extends Context.Tag("@codenuke/runtime/Config")<
  Config,
  {
    /** Resolve the fully-validated config for this run (env→loop.json→autodetect). */
    readonly resolve: Effect.Effect<ResolvedConfig, ConfigInvalid | ShellStringRejected>
  }
>() {}

/**
 * ConfigLive — effectful resolver. STUB.
 * Real implementation: read process.env, reject shell strings (rejectShellStringEnv),
 * read ${cwd}/codenuke.loop.json (+ ${repo}/codenuke.loop.json), merge per §D
 * precedence, run validateNumerics + validateCommandSpec, then autodetect
 * srcDir/testCommand/typeCheckCommand/regions/testLayout (RULE-033/034).
 */
export const ConfigLive = Layer.succeed(
  Config,
  Config.of({
    resolve: Effect.die("unimplemented: RULE-033/034 config autodetect (ConfigLive)"),
  }),
)
