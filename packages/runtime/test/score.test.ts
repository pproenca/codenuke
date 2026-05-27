import { Command, CommandExecutor, FileSystem, Path } from "@effect/platform"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import type { Measurement } from "@codenuke/core"
import { decide, wilson } from "@codenuke/core"
import { Effect, Layer } from "effect"
import { GitLive } from "../src/git/git.ts"
import {
  assembleScoreInputs,
  decideEnvelope,
  type GateInputs,
  renderScoreHuman,
  SCORE_DEFAULT_WEIGHTS,
  scoreCurrentChange,
} from "../src/score/score.ts"

/**
 * RULE-035 score walking skeleton (Slice 0) — the pure assembly + decide path.
 * The git-backed end-to-end (`scoreCurrentChange`) is proven by the CLI smoke
 * test; here we pin the pure assembly so it stays deterministic and hermetic.
 */

const m = (L: number, complexity: number, dupMass: number): Measurement => ({ L, complexity, dupMass })
const gates = (diffsize: number): GateInputs => ({
  testsPass: true,
  fenceUsable: true,
  blockedRegions: [],
  touchedFidelities: [],
  diffsize,
  typeErrors: 0,
  baselineTypeErrors: 0,
})
const git = (repo: string, args: readonly string[]): Effect.Effect<string, never, CommandExecutor.CommandExecutor> =>
  Command.string(Command.make("git", ...args).pipe(Command.workingDirectory(repo))).pipe(
    Effect.map((s) => s.trim()),
    Effect.orDie,
  )

const writeArtifacts = (repo: string, baselineSha: string): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const w = wilson(60, 60)
    yield* fs.makeDirectory(path.join(repo, ".codenuke"), { recursive: true }).pipe(Effect.orDie)
    yield* fs.writeFileString(
      path.join(repo, ".codenuke", "fence-fidelity.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        baseline: "HEAD",
        baselineSha,
        generatedAt: "2026-05-27T00:00:00.000Z",
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
    ).pipe(Effect.orDie)
    yield* fs.writeFileString(
      path.join(repo, ".codenuke", "calibration.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        baseline: "HEAD",
        baselineSha,
        generatedAt: "2026-05-27T00:00:00.000Z",
        commitsSampled: 3,
        scales: { sL: 150, sCx: 15, sDup: 5 },
      })}\n`,
    ).pipe(Effect.orDie)
  })

describe("RULE-035 score assembly — assembleScoreInputs", () => {
  it("RULE-035 requires explicit gate inputs and passes through diffsize/weights", () => {
    const inputs = assembleScoreInputs({ before: m(100, 10, 5), after: m(90, 8, 5), ...gates(12) })
    expect(inputs.testsPass).toBe(true)
    expect(inputs.fenceUsable).toBe(true)
    expect(inputs.blockedRegions).toEqual([])
    expect(inputs.touchedFidelities).toEqual([]) // ⇒ mfence = 1
    expect(inputs.typeErrors).toBe(0)
    expect(inputs.baselineTypeErrors).toBe(0)
    expect(inputs.diffsize).toBe(12)
    expect(inputs.scales).toBeNull()
    expect(inputs.weights).toEqual(SCORE_DEFAULT_WEIGHTS)
  })

  it("RULE-035 a real reduction (smaller AST, gates pass) is KEPT with loss<0", () => {
    const v = decide(assembleScoreInputs({ before: m(100, 10, 5), after: m(90, 8, 5), ...gates(10) }))
    expect(v.admissible).toBe(true)
    expect(v.dL).toBe(10)
    expect(v.gain).toBeGreaterThan(0)
    expect(v.mfence).toBe(1) // no touched fidelities ⇒ no fence penalty (Slice 0)
    expect(v.loss).not.toBeNull()
    expect(v.loss! < 0).toBe(true)
    expect(v.keep).toBe(true)
    expect(v.failedGates).toEqual([])
  })

  it("RULE-035/RULE-021 code that GREW (ΔL≤0) fails G4 and is reverted", () => {
    const v = decide(assembleScoreInputs({ before: m(90, 8, 5), after: m(100, 10, 5), ...gates(10) }))
    expect(v.gates.G4).toBe(false)
    expect(v.admissible).toBe(false)
    expect(v.keep).toBe(false)
    expect(v.failedGates).toContain("G4")
    expect(v.loss).toBeNull() // inadmissible ⇒ loss null (RULE-035)
  })

  it("RULE-035 renderScoreHuman summarizes keep + gates", () => {
    const before = m(100, 10, 5)
    const after = m(90, 8, 5)
    const envelope = decideEnvelope({
      before,
      after,
      gates: gates(10),
      baselineSha: "a".repeat(40),
      confidence: "bootstrap",
      artifactHashes: {},
      config: {},
    })
    const text = renderScoreHuman(envelope)
    expect(text).toContain("KEEP")
    expect(text).toContain("gates:")
  })
})

describe("scoreCurrentChange — early cheap vetoes", () => {
  it.effect("rejects probation guardrails before running test or typecheck commands", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const repo = yield* fs.makeTempDirectoryScoped({ prefix: "codenuke-score-veto-" })
        const test = path.join(repo, "test-ran")
        const type = path.join(repo, "type-ran")
        yield* fs.makeDirectory(path.join(repo, "src"), { recursive: true }).pipe(Effect.orDie)
        yield* fs.writeFileString(path.join(repo, "src", "index.ts"), "export const value = 1\n").pipe(Effect.orDie)
        yield* git(repo, ["init"])
        yield* git(repo, ["config", "user.email", "test@codenuke.local"])
        yield* git(repo, ["config", "user.name", "codenuke test"])
        yield* git(repo, ["add", "."])
        yield* git(repo, ["commit", "-m", "initial"])
        const baselineSha = yield* git(repo, ["rev-parse", "HEAD"])
        yield* writeArtifacts(repo, baselineSha)
        yield* fs.writeFileString(path.join(repo, "src", "index.ts"), "export const renamed = 1\n").pipe(Effect.orDie)

        const envelope = yield* scoreCurrentChange({
          repo,
          region: "src",
          baselineSha,
          threshold: 0.9,
          testCommand: {
            file: "node",
            args: ["-e", "require('fs').writeFileSync(process.env.SENTINEL, 'test')"],
            env: { SENTINEL: test },
          },
          typeCheckCommand: {
            file: "node",
            args: ["-e", "require('fs').writeFileSync(process.env.SENTINEL, 'type')"],
            env: { SENTINEL: type },
          },
        })

        expect(envelope.status).toBe("rejected")
        expect(envelope.guardrails.failures.map((f) => f.code)).toContain("public-api-change")
        expect(yield* fs.exists(test).pipe(Effect.orDie)).toBe(false)
        expect(yield* fs.exists(type).pipe(Effect.orDie)).toBe(false)
      }),
    ).pipe(Effect.provide(Layer.mergeAll(NodeContext.layer, GitLive.pipe(Layer.provide(NodeContext.layer))))),
  )
})
