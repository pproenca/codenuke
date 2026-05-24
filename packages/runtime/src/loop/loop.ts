/**
 * The reduce autoloop (RULE-038) + the fail-closed startup gate (RULE-030/031/054).
 *
 * Per iteration, inside ONE isolated worktree at the run baseline:
 *   1. measure the region BEFORE (worktree HEAD state),
 *   2. run the proposer (reduce mode) — it edits the worktree,
 *   3. measure AFTER, get diffsize + changed files (RULE-025 surface guard),
 *   4. run the test command (G1), read the fence artifact for the region (G1′),
 *   5. `decide()` → keep (commit in the worktree) or revert (discard).
 * On finish, if anything was kept, publish the result on a ref (non-destructive —
 * the user's working tree and branch are untouched; merge `resultRef` to adopt).
 *
 * The proposer is injected (port): `makeApplyingFakeProposerLive` for hermetic
 * smokes/tests, `CodexProposerLive` for real. Tests/typecheck (G3) and calibration
 * scales are Slice-2 stubs (typeErrors=0, scales=null); fence fidelity is REAL.
 */
import { Command, CommandExecutor, FileSystem, Path } from "@effect/platform"
import { allowlistEnv, type CommandSpec, decide, isSourceFile, measureFiles, wilson } from "@codenuke/core"
import { Effect, Stream } from "effect"
import { Git } from "../git/git.ts"
import {
  type ArtifactReadiness,
  firstGap,
  type ReadinessGap,
  shouldRequireValueProxyValidation,
} from "../orchestrator/orchestrator.ts"
import { Proposer, type ProposerRequest } from "../proposer/proposer.ts"
import { SCORE_DEFAULT_WEIGHTS } from "../score/score.ts"

// ---------------------------------------------------------------------------
// Startup gate (RULE-030/031/054)
// ---------------------------------------------------------------------------

const readJson = (
  fs: FileSystem.FileSystem,
  file: string,
): Effect.Effect<Record<string, unknown> | null> =>
  fs.readFileString(file).pipe(
    Effect.map((s) => {
      try {
        return JSON.parse(s) as Record<string, unknown>
      } catch {
        return null
      }
    }),
    Effect.orElseSucceed(() => null),
  )

/** Read artifact readiness from `<repo>/.codenuke/*.json` (present + schemaVersion). */
export const readArtifactReadiness = (
  repo: string,
): Effect.Effect<ArtifactReadiness, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dir = path.join(repo, ".codenuke")
    const fence = yield* readJson(fs, path.join(dir, "fence-fidelity.json"))
    const calibration = yield* readJson(fs, path.join(dir, "calibration.json"))
    const changecost = yield* readJson(fs, path.join(dir, "changecost.json"))
    const valueProxy = yield* readJson(fs, path.join(dir, "value-proxy-validation.json"))
    const usable = (a: Record<string, unknown> | null): boolean => a?.["schemaVersion"] === 1
    const regions = (fence?.["regions"] ?? {}) as Record<
      string,
      { readonly caught?: number; readonly total?: number; readonly lo?: number }
    >
    // RULE-022 anti-tamper: recompute each region's Wilson lower bound from the
    // stored counts and reject the artifact if any stored `lo` was edited.
    const fenceUsable =
      usable(fence) &&
      Object.values(regions).every((rec) => {
        if (typeof rec.caught !== "number" || typeof rec.total !== "number" || typeof rec.lo !== "number") {
          return false
        }
        return Math.abs(wilson(rec.caught, rec.total).lo - rec.lo) <= 1e-9
      })
    return {
      fencePresent: fence !== null,
      fenceUsable,
      hasMeasuredRegion: Object.keys(regions).length > 0,
      calibrationPresent: calibration !== null,
      calibrationUsable: usable(calibration),
      changecostPresent: changecost !== null,
      changecostUsable: usable(changecost),
      valueProxyPresent: valueProxy !== null,
      valueProxyUsable: usable(valueProxy),
    }
  })

/** RULE-030 — fail-closed startup gate: the first readiness gap, or null when ready. */
export const startupGate = (
  repo: string,
  iterations: number,
): Effect.Effect<ReadinessGap | null, never, FileSystem.FileSystem | Path.Path> =>
  readArtifactReadiness(repo).pipe(
    Effect.map((r) => firstGap(r, shouldRequireValueProxyValidation(iterations))),
  )

// ---------------------------------------------------------------------------
// Reduce loop (RULE-038)
// ---------------------------------------------------------------------------

export interface ReduceLoopOptions {
  readonly repo: string
  readonly region: string
  readonly iterations: number
  readonly testCommand: CommandSpec
  readonly threshold: number
  readonly resultRef: string
}

export interface IterationOutcome {
  readonly iter: number
  readonly kept: boolean
  readonly reason: string
  readonly dL: number
  readonly loss: number | null
}

export interface ReduceLoopReport {
  readonly kept: number
  readonly reverted: number
  readonly startSha: string
  readonly finalSha: string
  readonly resultRef: string | null
  readonly reductionPct: number
  readonly iterations: readonly IterationOutcome[]
}

const isUnderRegion = (file: string, region: string): boolean =>
  region === "." || file === region || file.startsWith(region.endsWith("/") ? region : `${region}/`)

export const runReduceLoop = (opts: ReduceLoopOptions) =>
  Effect.gen(function* () {
    const git = yield* Git
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const proposer = yield* Proposer

    const startSha = yield* git.resolveSha(opts.repo, "HEAD")

    // fence record for the region (G1′ fidelity); null ⇒ fence unusable for it
    const fenceJson = yield* readJson(fs, path.join(opts.repo, ".codenuke", "fence-fidelity.json"))
    const fenceRegions = (fenceJson?.["regions"] ?? {}) as Record<
      string,
      { readonly lo?: number; readonly admissible?: boolean }
    >
    const fenceRec = fenceRegions[opts.region]

    const runTest = (
      worktree: string,
    ): Effect.Effect<boolean, never, CommandExecutor.CommandExecutor> => {
      const cmd = Command.make(opts.testCommand.file, ...(opts.testCommand.args ?? [])).pipe(
        Command.workingDirectory(worktree),
        Command.env(allowlistEnv(process.env, opts.testCommand.env ?? {})),
      )
      return Command.exitCode(cmd).pipe(
        Effect.map((code: number) => code === 0),
        Effect.orElseSucceed(() => false), // can't run tests ⇒ fail-closed (G1 fails)
      )
    }

    const report = yield* Effect.scoped(
      Effect.gen(function* () {
        const parent = yield* fs.makeTempDirectoryScoped({ prefix: "codenuke-run-" })
        const worktree = path.join(parent, "tree")
        yield* Effect.acquireRelease(git.worktreeAdd(opts.repo, worktree, startSha), () =>
          git.worktreeRemove(opts.repo, worktree).pipe(Effect.ignore),
        )

        const outcomes: IterationOutcome[] = []
        const tsvRows: string[] = []
        let kept = 0
        let reverted = 0

        const sanitize = (s: string): string => s.replace(/[\t\r\n]/gu, " ")
        const measureRegionNow = (): Effect.Effect<number> =>
          Effect.gen(function* () {
            const rels = (
              yield* git.lsTree(worktree, "HEAD", opts.region).pipe(Effect.orElseSucceed(() => [] as readonly string[]))
            ).filter(isSourceFile)
            const files = yield* Effect.forEach(rels, (rel) =>
              fs
                .readFileString(path.join(worktree, rel))
                .pipe(Effect.map((c) => [rel, c] as const), Effect.orElseSucceed(() => [rel, ""] as const)),
            )
            return measureFiles(Object.fromEntries(files)).L
          })
        const startL = yield* measureRegionNow()

        for (let i = 0; i < opts.iterations; i += 1) {
          // region source files at the worktree's current HEAD
          const rels = (yield* git.lsTree(worktree, "HEAD", opts.region)).filter(isSourceFile)
          const readAll = (): Effect.Effect<readonly { rel: string; content: string }[]> =>
            Effect.forEach(rels, (rel) =>
              fs
                .readFileString(path.join(worktree, rel))
                .pipe(
                  Effect.map((content) => ({ rel, content })),
                  Effect.orElseSucceed(() => ({ rel, content: "" })),
                ),
            )

          const beforeM = measureFiles(Object.fromEntries((yield* readAll()).map((f) => [f.rel, f.content])))

          // propose (reduce) — edits the worktree; proposer failure ⇒ no change
          const req: ProposerRequest = {
            mode: "reduce",
            prompt: `reduce region ${opts.region}`,
            promptFile: "",
            repo: opts.repo,
            worktree,
            regionKey: opts.region,
            regionTarget: opts.region,
            timeoutMs: 900_000,
            budgetUsd: "8",
            env: allowlistEnv(process.env),
          }
          yield* Stream.runDrain(proposer.propose(req)).pipe(Effect.catchAll(() => Effect.void))

          const afterM = measureFiles(Object.fromEntries((yield* readAll()).map((f) => [f.rel, f.content])))

          const shortStat = yield* git.diffShortStat(worktree, opts.region)
          const diffsize = shortStat.insertions + shortStat.deletions
          const changed = yield* git.diffNames(worktree, opts.region)
          const outOfSurface = changed.filter((f) => !isUnderRegion(f, opts.region))

          const testsPass = yield* runTest(worktree)

          const fenceUsable = fenceRec !== undefined
          const touchedFidelities = changed.length > 0 && fenceRec ? [fenceRec.lo ?? 0] : []
          const blockedRegions = [
            ...outOfSurface,
            ...(changed.length > 0 && fenceRec && fenceRec.admissible !== true ? [opts.region] : []),
          ]

          const verdict = decide({
            before: beforeM,
            after: afterM,
            testsPass,
            fenceUsable,
            blockedRegions,
            touchedFidelities,
            diffsize,
            typeErrors: 0, // Slice 2 stub (typecheck G3 → Slice 2 follow-up)
            baselineTypeErrors: 0,
            weights: SCORE_DEFAULT_WEIGHTS,
            scales: null,
          })

          if (verdict.keep) {
            const sha = yield* git.commitAll(worktree, `codenuke: reduce #${i + 1} (loss=${verdict.loss})`)
            kept += 1
            outcomes.push({ iter: i + 1, kept: true, reason: `loss=${verdict.loss}`, dL: verdict.dL, loss: verdict.loss })
            tsvRows.push(
              [i + 1, sha.slice(0, 7), verdict.dL, verdict.dCx, verdict.mfence.toFixed(3), String(verdict.loss), "KEEP", sanitize(`reduce #${i + 1}`)].join(
                "\t",
              ),
            )
          } else {
            yield* git.discardAll(worktree).pipe(Effect.ignore)
            reverted += 1
            const reason =
              verdict.failedGates.length > 0
                ? `gates ${verdict.failedGates.join(",")}`
                : `loss=${verdict.loss ?? "null"}`
            outcomes.push({ iter: i + 1, kept: false, reason, dL: verdict.dL, loss: verdict.loss })
            tsvRows.push(
              [i + 1, "-", verdict.dL, verdict.dCx, verdict.mfence.toFixed(3), verdict.loss === null ? "null" : String(verdict.loss), "REVERT", sanitize(reason)].join(
                "\t",
              ),
            )
          }
        }

        const finalSha = yield* git.resolveSha(worktree, "HEAD")
        const finalL = yield* measureRegionNow()
        return { kept, reverted, finalSha, outcomes, tsvRows, startL, finalL }
      }),
    )

    let resultRef: string | null = null
    if (report.finalSha !== startSha) {
      yield* git.updateRef(opts.repo, opts.resultRef, report.finalSha).pipe(Effect.ignore)
      resultRef = opts.resultRef
    }

    // C12 (RULE-041) — results.tsv journal of the run (tabs/newlines sanitized).
    const header = "iter\tcommit\tdAST\tdCx\tbehavior\tloss\tstatus\tdescription"
    yield* fs
      .makeDirectory(path.join(opts.repo, ".codenuke"), { recursive: true })
      .pipe(
        Effect.ignore,
        Effect.zipRight(
          fs.writeFileString(
            path.join(opts.repo, ".codenuke", "results.tsv"),
            `${[header, ...report.tsvRows].join("\n")}\n`,
          ),
        ),
        Effect.ignore,
      )

    // RULE-062 — cumulative reduction %.
    const reductionPct = report.startL > 0 ? ((report.startL - report.finalL) / report.startL) * 100 : 0

    return {
      kept: report.kept,
      reverted: report.reverted,
      startSha,
      finalSha: report.finalSha,
      resultRef,
      reductionPct,
      iterations: report.outcomes,
    }
  })
