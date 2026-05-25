/**
 * Change-cost (C11) real generation (RULE-011/012/013/052/055). For each held-out
 * benchmark task it: creates a scoped worktree at baseline, runs the REAL Codex
 * implementer (`thread.run`) in it, enforces the edit surface (RULE-055), measures
 * editTokens (LCS over tokenized before/after, RULE-012) + verifyFrac (mean fence
 * gap, RULE-013), computes cost = editTokens + β·verifyFrac (RULE-011), and decides
 * done/not-done by the accept test. 𝒱̂ = mean cost over done; writes changecost.json.
 *
 * Tasks load from `<benchmarkDir>/tasks.json` (array of {id, prompt, region?, dir?}).
 * The accept test is the configured test command run in the worktree (per-task
 * acceptTest wiring is a follow-up). Running the implementer needs codex creds.
 */
import { Command, FileSystem, Path } from "@effect/platform"
import { allowlistEnv, type CommandSpec, isSourceFile } from "@codenuke/core"
import { Effect } from "effect"
import { resolveProposerConfig } from "../config/config.ts"
import { Git } from "../git/git.ts"
import { codexEnv, makeCodex, openThread } from "../proposer/codex-agent.ts"
import {
  type ChangeCostResult,
  type ChangeCostStatus,
  costOf,
  editTokensOf,
  type FenceRegions,
  type PerFileEdit,
  tokenize,
  verifyFrac,
  vhatOf,
} from "./changecost.ts"

export interface RunChangeCostOptions {
  readonly repo: string
  readonly benchmarkDir: string
  readonly region: string
  readonly beta: number
  readonly testCommand: CommandSpec
}

interface BenchTask {
  readonly id: string
  readonly prompt: string
  readonly region?: string
  readonly dir?: string
}

const isUnder = (file: string, region: string): boolean =>
  region === "." || file === region || file.startsWith(region.endsWith("/") ? region : `${region}/`)

export const runChangeCost = (opts: RunChangeCostOptions) =>
  Effect.gen(function* () {
    const git = yield* Git
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const proposerConfig = resolveProposerConfig(process.env)
    if (proposerConfig instanceof Error) {
      return yield* Effect.fail(proposerConfig)
    }

    const tasksRaw = yield* fs
      .readFileString(path.join(opts.benchmarkDir, "tasks.json"))
      .pipe(Effect.orElseSucceed(() => "[]"))
    const tasks: BenchTask[] = yield* Effect.try(() => {
      const v: unknown = JSON.parse(tasksRaw)
      const arr: unknown = Array.isArray(v) ? v : ((v as { tasks?: unknown })?.tasks ?? [])
      return (Array.isArray(arr) ? arr : []).map((t, i) => {
        const o = t as Record<string, unknown>
        return {
          id: String(o["id"] ?? `task-${i}`),
          prompt: String(o["prompt"] ?? ""),
          region: typeof o["region"] === "string" ? o["region"] : undefined,
          dir: typeof o["dir"] === "string" ? o["dir"] : undefined,
        }
      })
    }).pipe(Effect.orElseSucceed(() => [] as BenchTask[]))

    const baselineSha = yield* git.resolveSha(opts.repo, "HEAD")

    // fence fidelities for verifyFrac (RULE-013)
    const fenceJson = yield* fs
      .readFileString(path.join(opts.repo, ".codenuke", "fence-fidelity.json"))
      .pipe(
        Effect.map((s) => {
          try {
            return JSON.parse(s) as { regions?: Record<string, { p?: number }> }
          } catch {
            return null
          }
        }),
        Effect.orElseSucceed(() => null),
      )
    const fenceRegions: Record<string, { p: number }> = {}
    if (fenceJson?.regions) {
      for (const [k, v] of Object.entries(fenceJson.regions)) {
        fenceRegions[k] = { p: typeof v.p === "number" ? v.p : 0 }
      }
    }
    const haveFence = fenceJson !== null

    const runTest = (worktree: string) => {
      const cmd = Command.make(opts.testCommand.file, ...(opts.testCommand.args ?? [])).pipe(
        Command.workingDirectory(worktree),
        Command.env(allowlistEnv(process.env, opts.testCommand.env ?? {})),
      )
      return Command.exitCode(cmd).pipe(
        Effect.map((code: number) => code === 0),
        Effect.orElseSucceed(() => false),
      )
    }

    const runImplementer = (worktree: string, prompt: string): Effect.Effect<boolean> =>
      makeCodex({ env: codexEnv(process.env) }).pipe(
        Effect.flatMap((client) => {
          const thread = openThread(client, proposerConfig, worktree)
          return Effect.tryPromise({ try: () => thread.run(prompt), catch: (e) => new Error(String(e)) })
        }),
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      )

    const results: ChangeCostResult[] = []
    for (const task of tasks) {
      const allowed = task.region ?? task.dir ?? opts.region
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const parent = yield* fs.makeTempDirectoryScoped({ prefix: "codenuke-cc-" })
          const worktree = path.join(parent, "tree")
          yield* Effect.acquireRelease(git.worktreeAdd(opts.repo, worktree, baselineSha), () =>
            git.worktreeRemove(opts.repo, worktree).pipe(Effect.ignore),
          )

          const implOk = yield* runImplementer(worktree, task.prompt)
          if (!implOk) return { id: task.id, status: "impl-fail" as ChangeCostStatus }

          const changed = yield* git
            .diffNames(worktree, ".")
            .pipe(Effect.orElseSucceed(() => [] as readonly string[]))
          const disallowed = changed.filter((f) => !isUnder(f, allowed))
          if (disallowed.length > 0) {
            return { id: task.id, status: "impl-bad-surface" as ChangeCostStatus, disallowed }
          }

          const sources = changed.filter(isSourceFile)
          const perFile: PerFileEdit[] = yield* Effect.forEach(sources, (rel) =>
            Effect.gen(function* () {
              const before = yield* git
                .showAtRef(opts.repo, baselineSha, rel)
                .pipe(Effect.orElseSucceed(() => ""))
              const after = yield* fs
                .readFileString(path.join(worktree, rel))
                .pipe(Effect.orElseSucceed(() => ""))
              return { rel, before: tokenize(before), after: tokenize(after) }
            }),
          )
          const editTokens = editTokensOf(perFile)
          const regions = sources.length > 0 ? [allowed] : []
          const vFrac = haveFence ? verifyFrac(regions, fenceRegions as FenceRegions) : 1
          const passed = yield* runTest(worktree)
          const cost = costOf(editTokens, vFrac, opts.beta)
          return {
            id: task.id,
            status: (passed ? "done" : "not-done") as ChangeCostStatus,
            editTokens,
            filesTouched: sources.length,
            regions,
            verifyFrac: vFrac,
            cost,
          }
        }),
      )
      results.push(result)
    }

    const doneCosts = results
      .filter((r) => r.status === "done" && typeof r.cost === "number")
      .map((r) => r.cost as number)
    const Vhat = vhatOf(doneCosts)
    const artifact = {
      schemaVersion: 1 as const,
      ref: "HEAD",
      beta: opts.beta,
      Vhat,
      done: results.filter((r) => r.status === "done").length,
      total: results.length,
      results,
    }
    const dir = path.join(opts.repo, ".codenuke")
    yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.ignore)
    const outPath = path.join(dir, "changecost.json")
    yield* fs.writeFileString(outPath, `${JSON.stringify(artifact, null, 2)}\n`)
    return { outPath, Vhat, done: artifact.done, total: artifact.total }
  })
