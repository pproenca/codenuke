import { FileSystem, Path } from "@effect/platform"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { wilson } from "@codenuke/core"
import { Effect, Layer, Stream } from "effect"
import { Git } from "../src/git/git.ts"
import { runReduceLoop } from "../src/loop/loop.ts"
import { makeApplyingFakeProposerLive } from "../src/proposer/proposer.ts"
import { ProgressBus, type ProgressEvent } from "../src/progress/progress.ts"

const START = "a".repeat(40)
const COMMIT = "b".repeat(40)
const SOURCE = "export const value = 1\n// codenuke:remove\n"

const makeGitFakeLive = () =>
  Layer.effect(
    Git,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      let head = START

      const sourcePath = (worktree: string) => path.join(worktree, "src", "index.ts")
      const reduced = (worktree: string) =>
        fs
          .readFileString(sourcePath(worktree))
          .pipe(Effect.map((s) => !s.includes("codenuke:remove")), Effect.orElseSucceed(() => false))

      return Git.of({
        worktreeAdd: (_repo, worktree) =>
          fs
            .makeDirectory(path.join(worktree, "src"), { recursive: true })
            .pipe(Effect.zipRight(fs.writeFileString(sourcePath(worktree), SOURCE)), Effect.orDie),
        worktreeRemove: (_repo, worktree) => fs.remove(worktree, { recursive: true }).pipe(Effect.ignore, Effect.orDie),
        resetHard: () => Effect.void,
        lsTree: () => Effect.succeed(["src/index.ts"]),
        commitAll: () =>
          Effect.sync(() => {
            head = COMMIT
            return COMMIT
          }),
        discardAll: (worktree) => fs.writeFileString(sourcePath(worktree), SOURCE).pipe(Effect.orDie),
        updateRef: () => Effect.void,
        revList: () => Effect.succeed([]),
        diffNamesRange: () => Effect.succeed([]),
        diffShortStat: (worktree) =>
          reduced(worktree).pipe(
            Effect.map((r) => ({ filesChanged: r ? 1 : 0, insertions: 0, deletions: r ? 1 : 0 })),
          ),
        diffNames: (worktree) => reduced(worktree).pipe(Effect.map((r) => (r ? ["src/index.ts"] : []))),
        resolveSha: () => Effect.succeed(head),
        safeRead: (root, rel) => fs.readFileString(path.join(root, rel)).pipe(Effect.orDie),
        showAtRef: () => Effect.succeed(SOURCE),
      })
    }),
  )

const makeProgressCaptureLive = (events: ProgressEvent[]) =>
  Layer.succeed(
    ProgressBus,
    ProgressBus.of({
      emit: (ev) =>
        Effect.sync(() => {
          events.push(ev)
        }),
      stream: Stream.empty,
      shutdown: Effect.void,
    }),
  )

describe("loop progress", () => {
  it.effect("emits compact run, phase, scoring, and decision events", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const repo = yield* fs.makeTempDirectoryScoped({ prefix: "codenuke-loop-progress-" })
        yield* fs.makeDirectory(path.join(repo, ".codenuke"), { recursive: true })
        const w = wilson(60, 60)
        yield* fs.writeFileString(
          path.join(repo, ".codenuke", "fence-fidelity.json"),
          `${JSON.stringify({
            schemaVersion: 1,
            baseline: "HEAD",
            baselineSha: START,
            generatedAt: "2026-05-25T00:00:00.000Z",
            method: "ast-aware",
            threshold: 0.9,
            capPerRegion: 60,
            seed: 1337,
            regions: {
              src: {
                caught: 60,
                total: 60,
                p: w.p,
                lo: w.lo,
                hi: w.hi,
                admissible: w.lo >= 0.9,
                survivorSpecs: [],
              },
            },
          })}\n`,
        )
        yield* fs.writeFileString(
          path.join(repo, ".codenuke", "calibration.json"),
          `${JSON.stringify({
            schemaVersion: 1,
            baseline: "HEAD",
            baselineSha: START,
            generatedAt: "2026-05-25T00:00:00.000Z",
            commitsSampled: 3,
            scales: { sL: 150, sCx: 15, sDup: 5 },
          })}\n`,
        )
        yield* fs.writeFileString(
          path.join(repo, ".codenuke", "changecost.json"),
          `${JSON.stringify({
            schemaVersion: 1,
            ref: "HEAD",
            beta: 60,
            Vhat: null,
            done: 0,
            total: 0,
            results: [],
          })}\n`,
        )

        const events: ProgressEvent[] = []
        const layer = Layer.mergeAll(
          makeGitFakeLive(),
          makeProgressCaptureLive(events),
          makeApplyingFakeProposerLive({ rel: "src/index.ts", marker: "codenuke:remove" }),
        )

        yield* runReduceLoop({
          repo,
          region: "src",
          iterations: 1,
          testCommand: { file: "node", args: ["-e", "process.exit(0)"] },
          threshold: 0.9,
          resultRef: "refs/codenuke/result",
        }).pipe(Effect.provide(layer))

        const tags = events.map((ev) => ev._tag)
        expect(tags).toEqual(
          expect.arrayContaining([
            "RunStarted",
            "RegionSelected",
            "IterationStarted",
            "PhaseStarted",
            "ProposerEvent",
            "PhaseFinished",
            "Scored",
            "KeptOrReverted",
            "RunFinished",
          ]),
        )
        expect(events.some((ev) => ev._tag === "PhaseStarted" && ev.phase === "proposer")).toBe(true)
        expect(events.some((ev) => ev._tag === "PhaseStarted" && ev.phase === "tests")).toBe(true)
        expect(events.some((ev) => ev._tag === "ProposerEvent" && ev.ev._tag === "AgentMessage")).toBe(false)
        expect(
          events.some((ev) => ev._tag === "Scored" && ev.envelope.schemaVersion === 2 && ev.envelope._tag === "Scored"),
        ).toBe(true)
      }).pipe(Effect.provide(NodeContext.layer)),
    ),
  )
})
