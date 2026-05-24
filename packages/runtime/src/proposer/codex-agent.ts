/**
 * Shared @openai/codex-sdk adapter — used by BOTH the proposer (reduce/raise) and
 * the changecost implementer. Mirrors the legacy `CodexSdkProposerAdapter` against
 * the real SDK surface (Codex → startThread/resumeThread → runStreamed/run).
 *
 * The SDK value is loaded via dynamic `import()` (and kept EXTERNAL in the CLI
 * bundle) so the heavy CLI-wrapping package isn't inlined. Types are erased
 * `import type`s. When `CodexOptions.env` is provided the SDK does NOT inherit
 * process.env, so we forward the full (string-valued) env — codex needs its own
 * auth/config vars (OPENAI_API_KEY, CODEX_*, PATH, HOME, …), which a narrow
 * subprocess allowlist would strip. This is the codex trust boundary (the agent
 * runs against a trusted repo), intentionally broader than the test/git allowlist.
 */
import type { CodexOptions, ThreadEvent, ThreadItem, ThreadOptions, Usage } from "@openai/codex-sdk"
import { Effect } from "effect"
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

/** Keep only string-valued env entries (CodexOptions.env shape). */
export const codexEnv = (env: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter((e): e is [string, string] => typeof e[1] === "string"),
  )

/** Build ThreadOptions from CN_* env (sandbox/approval/model/effort) + the worktree. */
export const codexThreadOptions = (
  env: Record<string, string | undefined>,
  worktree: string,
): ThreadOptions => {
  const sandbox = env["CN_CODEX_SANDBOX"]?.trim()
  const approval = env["CN_CODEX_APPROVAL_POLICY"]?.trim()
  return {
    workingDirectory: worktree,
    skipGitRepoCheck: true, // detached worktrees are valid; don't reject them
    sandboxMode:
      sandbox === "read-only" || sandbox === "workspace-write" || sandbox === "danger-full-access"
        ? sandbox
        : sandbox === "bypass" || sandbox === "none"
          ? "danger-full-access"
          : "workspace-write",
    approvalPolicy:
      approval === "on-request" ||
      approval === "on-failure" ||
      approval === "untrusted" ||
      approval === "never"
        ? approval
        : "never",
    ...(env["CN_MODEL"] ? { model: env["CN_MODEL"] } : {}),
    ...(env["CN_REASONING_EFFORT"]
      ? { modelReasoningEffort: env["CN_REASONING_EFFORT"] as ThreadOptions["modelReasoningEffort"] }
      : {}),
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
  env: Record<string, string | undefined>,
  worktree: string,
  threadId?: string,
): CodexThreadLike =>
  threadId
    ? client.resumeThread(threadId, codexThreadOptions(env, worktree))
    : client.startThread(codexThreadOptions(env, worktree))
