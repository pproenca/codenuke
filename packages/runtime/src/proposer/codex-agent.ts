/**
 * Shared @openai/codex-sdk adapter — used by BOTH the proposer (reduce/raise) and
 * the changecost implementer. Mirrors the legacy `CodexSdkProposerAdapter` against
 * the real SDK surface (Codex → startThread/resumeThread → runStreamed/run).
 *
 * The SDK value is loaded via dynamic `import()` (and kept EXTERNAL in the CLI
 * bundle) so the heavy CLI-wrapping package isn't inlined. Types are erased
 * `import type`s. When `CodexOptions.env` is provided the SDK does NOT inherit
 * process.env, so we forward a Codex-specific environment that includes OS basics
 * plus auth/config variables. This is broader than the test/git subprocess
 * allowlist, but remains explicit and owned by the Codex adapter boundary.
 */
import type { CodexOptions, ThreadEvent, ThreadItem, ThreadOptions, Usage } from "@openai/codex-sdk"
import { Effect } from "effect"
import type { ResolvedProposerConfig } from "../config/config.ts"
import { ProposerFailed } from "./proposer.ts"

/** Minimal structural views of the SDK (avoid importing the `Codex` value in types). */
export interface CodexThreadLike {
  readonly id: string | null
  runStreamed(input: string, options?: { signal?: AbortSignal }): Promise<{ events: AsyncGenerator<ThreadEvent> }>
  run(
    input: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ items: ThreadItem[]; finalResponse: string; usage: Usage | null }>
}
export interface CodexClientLike {
  startThread(options?: ThreadOptions): CodexThreadLike
  resumeThread(id: string, options?: ThreadOptions): CodexThreadLike
}

const CODEX_SDK_ENV_KEYS = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "SHELL",
  "USER",
  "LOGNAME",
  "TERM",
  "OPENAI_API_KEY",
  "OPENAI_ORG_ID",
  "OPENAI_PROJECT_ID",
  "OPENAI_BASE_URL",
] as const

const CODEX_SDK_ENV_PREFIXES = ["CODEX_", "OPENAI_CODEX_"] as const

/** Keep only string-valued entries needed by CodexOptions.env. */
export const codexSdkEnv = (
  parent: Record<string, string | undefined>,
  extra: Record<string, string> = {},
): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const key of CODEX_SDK_ENV_KEYS) {
    const value = parent[key]
    if (typeof value === "string") out[key] = value
  }
  for (const [key, value] of Object.entries(parent)) {
    if (typeof value === "string" && CODEX_SDK_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      out[key] = value
    }
  }
  return { ...out, ...extra }
}

/** Back-compat alias for the changecost implementer path. */
export const codexEnv = codexSdkEnv

/** Build ThreadOptions from resolved config + the worktree. */
export const codexThreadOptions = (
  config: ResolvedProposerConfig,
  worktree: string,
): ThreadOptions => {
  return {
    workingDirectory: worktree,
    skipGitRepoCheck: true, // detached worktrees are valid; don't reject them
    sandboxMode: config.codexSandboxMode,
    approvalPolicy: config.codexApprovalPolicy,
    ...(config.proposerModel ? { model: config.proposerModel } : {}),
    ...(config.proposerReasoningEffort ? { modelReasoningEffort: config.proposerReasoningEffort } : {}),
  }
}

/** Construct a Codex client (dynamic import; kept external in the bundle). */
export const makeCodex = (options: CodexOptions): Effect.Effect<CodexClientLike, ProposerFailed> =>
  Effect.tryPromise({
    try: async () => {
      const mod = (await import("@openai/codex-sdk")) as { Codex: new (o?: CodexOptions) => CodexClientLike }
      return new mod.Codex(options)
    },
    catch: (e) => new ProposerFailed({ message: `codex init: ${String(e)}`, failureClass: "crash" }),
  })

/** Start or resume a thread for `worktree` with the resolved options. */
export const openThread = (
  client: CodexClientLike,
  config: ResolvedProposerConfig,
  worktree: string,
  threadId?: string,
): CodexThreadLike =>
  threadId
    ? client.resumeThread(threadId, codexThreadOptions(config, worktree))
    : client.startThread(codexThreadOptions(config, worktree))
