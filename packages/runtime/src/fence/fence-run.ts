/**
 * Fence run orchestration (RULE-007 audit, RULE-022 artifact) — the runtime side
 * that the fence ENGINE (git-agnostic, in @codenuke/fence) can't do itself:
 * provision one isolated worktree PER REGION, read the baseline sources, drive
 * `Fence.runAudit`, and persist `.codenuke/fence-fidelity.json`.
 *
 * Worktrees are scoped (acquire `git worktree add` → release `git worktree
 * remove`) so an interrupt/failure never leaks them. The MutationRunner (which
 * mutates files inside these worktrees) is provided by the caller (the CLI builds
 * it from the resolved test command via `makeMutationRunnerLive`).
 *
 * Slice-1 scope: one worktree per region created up front (regions are few);
 * a bounded worktree POOL and RULE-045 node_modules linking are follow-ups.
 */
import { FileSystem, Path } from "@effect/platform"
import { isSourceFile } from "@codenuke/core"
import { Fence, type RegionInput } from "@codenuke/fence"
import { Effect } from "effect"
import { Git } from "../git/git.ts"

export interface RunFenceOptions {
  readonly repo: string
  readonly regions: readonly string[]
  readonly cap: number
  readonly seed: number
  readonly threshold: number
  readonly fenceConcurrency: number
}

export const runFenceAudit = (opts: RunFenceOptions) =>
  Effect.gen(function* () {
    const git = yield* Git
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const fence = yield* Fence

    const baselineSha = yield* git.resolveSha(opts.repo, "HEAD")
    const generatedAt = new Date().toISOString()

    const artifact = yield* Effect.scoped(
      Effect.gen(function* () {
        const regionInputs = yield* Effect.forEach(opts.regions, (regionDir) =>
          Effect.gen(function* () {
            // scoped temp parent (auto-removed) + a non-existent child for the worktree
            const parent = yield* fs.makeTempDirectoryScoped({ prefix: "codenuke-fence-" })
            const worktree = path.join(parent, "tree")
            yield* Effect.acquireRelease(git.worktreeAdd(opts.repo, worktree, baselineSha), () =>
              git.worktreeRemove(opts.repo, worktree).pipe(Effect.ignore),
            )
            const names = yield* git.lsTree(opts.repo, baselineSha, regionDir)
            const sources = names.filter(isSourceFile)
            const files = yield* Effect.forEach(sources, (rel) =>
              fs
                .readFileString(path.join(worktree, rel))
                .pipe(
                  Effect.map((content) => ({ rel, content })),
                  Effect.orElseSucceed(() => ({ rel, content: "" })),
                ),
            )
            return { key: regionDir, worktree, files } satisfies RegionInput
          }),
        )

        return yield* fence.runAudit({
          regions: regionInputs,
          baseline: "HEAD",
          baselineSha,
          cap: opts.cap,
          seed: opts.seed,
          threshold: opts.threshold,
          fenceConcurrency: opts.fenceConcurrency,
          generatedAt,
        })
      }),
    )

    const outDir = path.join(opts.repo, ".codenuke")
    yield* fs.makeDirectory(outDir, { recursive: true }).pipe(Effect.ignore)
    const outPath = path.join(outDir, "fence-fidelity.json")
    yield* fs.writeFileString(outPath, `${JSON.stringify(artifact, null, 2)}\n`)

    return { artifact, outPath }
  })
