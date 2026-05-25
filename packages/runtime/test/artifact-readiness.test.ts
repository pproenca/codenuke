import { FileSystem, Path } from "@effect/platform"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { validateValueProxy, wilson } from "@codenuke/core"
import { Effect } from "effect"
import { readArtifactBundle } from "../src/artifacts/artifact-readiness.ts"

const SHA = "a".repeat(40)
const STALE_SHA = "b".repeat(40)

const valueProxyArtifact = () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    id: `candidate-${i + 1}`,
    proxy: i + 1,
    Vhat: 12 - i,
  }))
  return {
    schemaVersion: 1 as const,
    input: ".codenuke/value-proxy-input.json",
    ...validateValueProxy(rows),
    rows,
  }
}

describe("artifact readiness", () => {
  it.effect("does not promote confidence from a stale decoded calibration artifact", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const repo = yield* fs.makeTempDirectoryScoped({ prefix: "codenuke-artifacts-" })
        const dir = path.join(repo, ".codenuke")
        yield* fs.makeDirectory(dir, { recursive: true })
        const w = wilson(60, 60)
        yield* fs.writeFileString(
          path.join(dir, "fence-fidelity.json"),
          `${JSON.stringify({
            schemaVersion: 1,
            baseline: "HEAD",
            baselineSha: SHA,
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
                admissible: true,
                survivorSpecs: [],
              },
            },
          })}\n`,
        )
        yield* fs.writeFileString(
          path.join(dir, "calibration.json"),
          `${JSON.stringify({
            schemaVersion: 1,
            baseline: "HEAD",
            baselineSha: STALE_SHA,
            generatedAt: "2026-05-25T00:00:00.000Z",
            commitsSampled: 3,
            scales: { sL: 150, sCx: 15, sDup: 5 },
          })}\n`,
        )
        yield* fs.writeFileString(
          path.join(dir, "changecost.json"),
          `${JSON.stringify({ schemaVersion: 1, ref: "HEAD", beta: 60, Vhat: null, done: 0, total: 0, results: [] })}\n`,
        )
        yield* fs.writeFileString(
          path.join(dir, "value-proxy-validation.json"),
          `${JSON.stringify(valueProxyArtifact())}\n`,
        )

        const bundle = yield* readArtifactBundle({ repo, baselineSha: SHA, threshold: 0.9 })
        expect(bundle.readiness.calibrationUsable).toBe(false)
        expect(bundle.confidence).toBe("bootstrap")
      }).pipe(Effect.provide(NodeContext.layer)),
    ),
  )
})
