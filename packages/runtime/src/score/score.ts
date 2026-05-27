import { FileSystem, Path } from "@effect/platform"
import { isSourceFile, measureFiles, type CommandSpec, type Weights } from "@codenuke/core"
import { Effect } from "effect"
import { readArtifactBundle } from "../artifacts/artifact-readiness.ts"
import { Git } from "../git/git.ts"
import { runTestCommand, runTypecheckCount } from "./commands.ts"
import { decideEnvelope, SCORE_DEFAULT_WEIGHTS } from "./envelope.ts"
import { probationGuardrails } from "./probation.ts"

const isUnderRegion = (file: string, region: string): boolean =>
  region === "." || file === region || file.startsWith(region.endsWith("/") ? region : `${region}/`)

export const scoreCurrentChange = (opts: {
  readonly repo: string
  readonly artifactRepo?: string
  readonly region?: string
  readonly testCommand: CommandSpec
  readonly typeCheckCommand?: CommandSpec | null
  readonly baselineTypeErrors?: number
  readonly baselineSha?: string
  readonly threshold?: number
  readonly weights?: Weights
  readonly probation?: boolean
}) =>
  Effect.gen(function* () {
    const git = yield* Git
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const region = opts.region ?? "."
    const artifactRepo = opts.artifactRepo ?? opts.repo
    const threshold = opts.threshold ?? 0.9
    const baselineSha = opts.baselineSha ?? (yield* git.resolveSha(opts.repo, "HEAD"))
    const artifacts = yield* readArtifactBundle({ repo: artifactRepo, baselineSha, threshold })

    const changed = yield* git.diffNames(opts.repo, region)
    const allChanged = yield* git.diffNames(opts.repo, ".").pipe(Effect.orElseSucceed(() => changed))
    const sources = changed.filter(isSourceFile)
    const allSources = [...new Set(allChanged.filter(isSourceFile))].sort()

    const before: Record<string, string> = {}
    const after: Record<string, string> = {}
    for (const rel of sources) {
      before[rel] = yield* git.showAtRef(opts.repo, "HEAD", rel)
      after[rel] = yield* git.safeRead(opts.repo, rel).pipe(Effect.orElseSucceed(() => ""))
    }
    const beforeChanged: Record<string, string> = { ...before }
    const afterChanged: Record<string, string> = { ...after }
    for (const rel of allSources) {
      if (beforeChanged[rel] === undefined) beforeChanged[rel] = yield* git.showAtRef(opts.repo, "HEAD", rel)
      if (afterChanged[rel] === undefined) {
        afterChanged[rel] = yield* git.safeRead(opts.repo, rel).pipe(Effect.orElseSucceed(() => ""))
      }
    }

    const shortStat = yield* git.diffShortStat(opts.repo, region)
    const diffsize = shortStat.insertions + shortStat.deletions
    const fenceRec = artifacts.fence?.regions[region]
    const fenceUsable = artifacts.readiness.fenceUsable && fenceRec !== undefined
    const touchedFidelities = changed.length > 0 && fenceRec ? [fenceRec.lo] : []
    const outOfSurface = allChanged.filter((file) => !isUnderRegion(file, region))
    const blockedRegions = [
      ...outOfSurface,
      ...(changed.length > 0 && fenceRec?.admissible !== true ? [region] : []),
    ]
    const probation = opts.probation ?? artifacts.confidence !== "validated"
    const guardrailFailures = probationGuardrails({
      probation,
      changed,
      allChanged,
      diffsize,
      before: beforeChanged,
      after: afterChanged,
      beforeGraph: beforeChanged,
      afterGraph: afterChanged,
    })
    const beforeMeasure = measureFiles(before)
    const afterMeasure = measureFiles(after)
    const shouldProve =
      guardrailFailures.length === 0 &&
      outOfSurface.length === 0 &&
      !(changed.length > 0 && (!fenceUsable || fenceRec?.admissible !== true)) &&
      beforeMeasure.L > afterMeasure.L
    const baselineTypeErrors =
      opts.baselineTypeErrors ??
      (shouldProve && opts.typeCheckCommand != null
        ? yield* Effect.scoped(
            Effect.gen(function* () {
              const parent = yield* fs.makeTempDirectoryScoped({ prefix: "codenuke-score-baseline-" })
              const worktree = path.join(parent, "tree")
              yield* Effect.acquireRelease(git.worktreeAdd(opts.repo, worktree, baselineSha), () =>
                git.worktreeRemove(opts.repo, worktree).pipe(Effect.ignore),
              )
              const repoNodeModules = path.join(opts.repo, "node_modules")
              const worktreeNodeModules = path.join(worktree, "node_modules")
              const hasNodeModules = yield* fs.exists(repoNodeModules).pipe(Effect.orElseSucceed(() => false))
              if (hasNodeModules) {
                yield* fs.symlink(repoNodeModules, worktreeNodeModules).pipe(Effect.ignore)
              }
              return yield* runTypecheckCount(worktree, opts.typeCheckCommand)
            }).pipe(Effect.orElseSucceed(() => 0)),
          )
        : 0)
    const testsPass = shouldProve ? yield* runTestCommand(opts.repo, opts.testCommand) : true
    const typeErrors = shouldProve ? yield* runTypecheckCount(opts.repo, opts.typeCheckCommand) : baselineTypeErrors

    return decideEnvelope({
      before: beforeMeasure,
      after: afterMeasure,
      gates: {
        testsPass,
        fenceUsable,
        blockedRegions,
        touchedFidelities,
        diffsize,
        typeErrors,
        baselineTypeErrors,
        weights: opts.weights ?? SCORE_DEFAULT_WEIGHTS,
        scales: artifacts.calibrationScales,
      },
      baselineSha,
      confidence: artifacts.confidence,
      artifactHashes: artifacts.artifactHashes,
      config: {
        region,
        threshold,
        weights: opts.weights ?? SCORE_DEFAULT_WEIGHTS,
        probation,
        testCommand: opts.testCommand,
        typeCheckCommand: opts.typeCheckCommand ?? null,
      },
      guardrailFailures,
    })
  })

export * from "./commands.ts"
export * from "./envelope.ts"
export * from "./probation.ts"
