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
 * smokes/tests, `CodexProposerLive` for real. Scoring goes through the shared
 * v2 metric path used by `score` and `accept`.
 */
import { FileSystem, Path } from "@effect/platform"
import { allowlistEnv, type CommandSpec, isSourceFile, measureFiles, type ScoreEnvelope } from "@codenuke/core"
import { Effect, Fiber, Stream } from "effect"
import {
  readArtifactBundle,
  readArtifactReadiness as readValidatedArtifactReadiness,
} from "../artifacts/artifact-readiness.ts"
import { Git } from "../git/git.ts"
import {
  type ArtifactReadiness,
  firstGap,
  type ReadinessGap,
  shouldRequireValueProxyValidation,
} from "../orchestrator/orchestrator.ts"
import { Proposer, type ProposerRequest } from "../proposer/proposer.ts"
import { ProgressBus, type LoopPhase } from "../progress/progress.ts"
import { PROBATION_MAX_ITERATIONS, runTypecheckCount, scoreCurrentChange } from "../score/score.ts"

// ---------------------------------------------------------------------------
// Startup gate (RULE-030/031/054)
// ---------------------------------------------------------------------------

/** Read validated artifact readiness from `<repo>/.codenuke/*.json`. */
export const readArtifactReadiness = (
  repo: string,
  threshold = 0.9,
) =>
  Effect.gen(function* () {
    const git = yield* Git
    const baselineSha = yield* git.resolveSha(repo, "HEAD")
    return yield* readValidatedArtifactReadiness({ repo, baselineSha, threshold })
  })

/** RULE-030 — fail-closed startup gate: the first readiness gap, or null when ready. */
export const startupGate = (
  repo: string,
  iterations: number,
  threshold = 0.9,
) =>
  readArtifactReadiness(repo, threshold).pipe(
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
  readonly typeCheckCommand?: CommandSpec | null
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

export const rejectedScoreReason = (envelope: ScoreEnvelope): string => {
  const guardrail = envelope.guardrails.failures[0]
  if (guardrail !== undefined) return guardrail.code
  const verdict = envelope.verdict
  if (verdict === null) return "blocked"
  return verdict.failedGates.length > 0
    ? `gates ${verdict.failedGates.join(",")}`
    : `loss=${verdict.loss ?? "null"}`
}

export const runReduceLoop = (opts: ReduceLoopOptions) =>
  Effect.gen(function* () {
    const git = yield* Git
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const proposer = yield* Proposer
    const progress = yield* ProgressBus

    const startSha = yield* git.resolveSha(opts.repo, "HEAD")
    const emit = (ev: Parameters<typeof progress.emit>[0]): Effect.Effect<void> =>
      progress.emit(ev).pipe(Effect.ignore)
    const timedPhase = <A, E, R>(
      iter: number,
      phase: LoopPhase,
      effect: Effect.Effect<A, E, R>,
      ok: (value: A) => boolean = () => true,
    ): Effect.Effect<A, E, R> =>
      Effect.gen(function* () {
        const started = Date.now()
        yield* emit({ _tag: "PhaseStarted", iter, phase })
        const heartbeat = yield* Effect.fork(
          Effect.gen(function* () {
            yield* Effect.sleep(10_000)
            while (true) {
              yield* emit({ _tag: "Heartbeat", iter, phase, ms: Date.now() - started })
              yield* Effect.sleep(30_000)
            }
          }),
        )
        return yield* effect.pipe(
          Effect.matchEffect({
            onFailure: (error) =>
              emit({ _tag: "PhaseFinished", iter, phase, ok: false, ms: Date.now() - started }).pipe(
                Effect.zipRight(Effect.fail(error)),
              ),
            onSuccess: (value) =>
              emit({ _tag: "PhaseFinished", iter, phase, ok: ok(value), ms: Date.now() - started }).pipe(
                Effect.as(value),
              ),
          }),
          Effect.ensuring(Fiber.interrupt(heartbeat).pipe(Effect.ignore)),
        )
      })
    const artifacts = yield* readArtifactBundle({ repo: opts.repo, baselineSha: startSha, threshold: opts.threshold })
    const startupGap = firstGap(artifacts.readiness, shouldRequireValueProxyValidation(opts.iterations))
    if (startupGap !== null) {
      return yield* Effect.fail({ _tag: "NotReady" as const, gap: startupGap })
    }
    const probation = artifacts.confidence !== "validated"
    const totalIterations = probation ? Math.min(opts.iterations, PROBATION_MAX_ITERATIONS) : opts.iterations

    yield* emit({ _tag: "RunStarted", iterations: totalIterations, baselineSha: startSha })
    yield* emit({ _tag: "RegionSelected", region: opts.region, mode: "reduce" })

    const report = yield* Effect.scoped(
      Effect.gen(function* () {
        const parent = yield* fs.makeTempDirectoryScoped({ prefix: "codenuke-run-" })
        const worktree = path.join(parent, "tree")
        yield* Effect.acquireRelease(git.worktreeAdd(opts.repo, worktree, startSha), () =>
          git.worktreeRemove(opts.repo, worktree).pipe(Effect.ignore),
        )
        const baselineTypeErrors = yield* runTypecheckCount(worktree, opts.typeCheckCommand)

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

        for (let i = 0; i < totalIterations; i += 1) {
          const iter = i + 1
          yield* emit({ _tag: "IterationStarted", iter, total: totalIterations })

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
          yield* timedPhase(
            iter,
            "proposer",
            Stream.runForEach(proposer.propose(req), (ev) =>
              ev._tag === "AgentMessage" ? Effect.void : emit({ _tag: "ProposerEvent", ev }),
            ),
          ).pipe(Effect.catchAll(() => Effect.void))

          const envelope = yield* timedPhase(
            iter,
            "tests",
            scoreCurrentChange({
              repo: worktree,
              artifactRepo: opts.repo,
              region: opts.region,
              testCommand: opts.testCommand,
              typeCheckCommand: opts.typeCheckCommand,
              baselineTypeErrors,
              baselineSha: startSha,
              threshold: opts.threshold,
              probation,
            }),
            (scored) => scored.status === "accepted",
          )
          yield* emit({ _tag: "Scored", envelope })
          const verdict = envelope.verdict

          if (envelope.status === "accepted" && verdict?.keep === true) {
            const sha = yield* git.commitAll(worktree, `codenuke: reduce #${i + 1} (loss=${verdict.loss})`)
            kept += 1
            outcomes.push({ iter, kept: true, reason: `loss=${verdict.loss}`, dL: verdict.dL, loss: verdict.loss })
            tsvRows.push(
              [iter, sha.slice(0, 7), verdict.dL, verdict.dCx, verdict.mfence.toFixed(3), String(verdict.loss), "KEEP", sanitize(`reduce #${i + 1}`)].join(
                "\t",
              ),
            )
            yield* emit({ _tag: "KeptOrReverted", kept: true, reason: `loss=${verdict.loss}` })
          } else {
            yield* git.discardAll(worktree).pipe(Effect.ignore)
            reverted += 1
            const reason = rejectedScoreReason(envelope)
            outcomes.push({ iter, kept: false, reason, dL: verdict?.dL ?? 0, loss: verdict?.loss ?? null })
            tsvRows.push(
              [iter, "-", verdict?.dL ?? 0, verdict?.dCx ?? 0, (verdict?.mfence ?? 0).toFixed(3), verdict?.loss === null || verdict?.loss === undefined ? "null" : String(verdict.loss), "REVERT", sanitize(reason)].join(
                "\t",
              ),
            )
            yield* emit({ _tag: "KeptOrReverted", kept: false, reason })
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
    yield* emit({
      _tag: "RunFinished",
      kept: report.kept,
      reverted: report.reverted,
      iterations: totalIterations,
      reductionPct,
      resultRef,
    })

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
