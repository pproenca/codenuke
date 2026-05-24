import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import {
  type AuditInput,
  FakeMutationRunnerLive,
  Fence,
  FenceLive,
  type RegionInput,
} from "../src/audit.ts"

/**
 * RULE-006/007/008/009 — the fence audit ENGINE, exercised with the deterministic
 * FakeMutationRunner (no git/worktree IO). The headline is the DETERMINISM
 * property (RULE-008): the audit at concurrency 1 vs N must yield a byte-identical
 * FenceArtifact. The real git-backed runner is proven by the CLI smoke (Slice 1c).
 */

const FenceTest = FenceLive.pipe(Layer.provide(FakeMutationRunnerLive))

const region = (key: string, files: RegionInput["files"]): RegionInput => ({
  key,
  worktree: `/tmp/wt/${key}`,
  files,
})

// Deliberately UNSORTED region keys + multi-file regions so concurrency has
// something to reorder; the engine must still produce a stable, sorted result.
const auditInput = (concurrency: number): AuditInput => ({
  regions: [
    region("z-region", [
      { rel: "z/a.ts", content: "function f(x){ if (x === 1) { return true } if (x !== 2) { return false } }" },
    ]),
    region("a-region", [
      { rel: "a/c.ts", content: "const ok = s.startsWith('x'); if (a == b) { return true }" },
      { rel: "a/b.ts", content: "function g(p,q){ if (p === q) { return false } return true }" },
    ]),
    region("m-region", [
      { rel: "m/d.ts", content: "while (true) { if (n !== 0) { return false } }" },
    ]),
  ],
  baseline: "HEAD",
  baselineSha: "a".repeat(40),
  cap: 60,
  seed: 1337,
  threshold: 0.9,
  fenceConcurrency: concurrency,
  generatedAt: "2026-01-01T00:00:00.000Z",
})

describe("RULE-008 determinism — concurrency-invariant FenceArtifact", () => {
  it.effect("RULE-008 audit at concurrency 1 vs N yields byte-identical FenceArtifact", () =>
    Effect.gen(function* () {
      const fence = yield* Fence
      const a1 = yield* fence.runAudit(auditInput(1))
      const aN = yield* fence.runAudit(auditInput(8))
      expect(JSON.stringify(aN)).toBe(JSON.stringify(a1))
    }).pipe(Effect.provide(FenceTest)),
  )

  it.effect("RULE-008 regions are emitted in sorted-key order (stable JSON)", () =>
    Effect.gen(function* () {
      const fence = yield* Fence
      const art = yield* fence.runAudit(auditInput(4))
      expect(Object.keys(art.regions)).toEqual(["a-region", "m-region", "z-region"])
    }).pipe(Effect.provide(FenceTest)),
  )
})

describe("RULE-006/007/009 audit — region records", () => {
  it.effect("RULE-007/006 a region's record tallies all sampled sites and computes Wilson", () =>
    Effect.gen(function* () {
      const fence = yield* Fence
      // "===" (1) + "return true" (1) = 2 collected sites; cap=60 ⇒ both sampled.
      const rec = yield* fence.auditRegion({
        region: region("solo", [{ rel: "s.ts", content: "if (x === 1) { return true }" }]),
        cap: 60,
        seed: 1337,
        threshold: 0.9,
      })
      expect(rec.total).toBe(2)
      expect(rec.caught + rec.survivorSpecs.length).toBe(rec.total) // RULE-009 tally closure
      expect(rec.lo).toBeGreaterThanOrEqual(0)
      expect(rec.hi).toBeLessThanOrEqual(1)
      expect(rec.admissible).toBe(rec.lo >= 0.9) // RULE-006 admissibility bar
    }).pipe(Effect.provide(FenceTest)),
  )

  it.effect("RULE-006 artifact carries the audit metadata verbatim", () =>
    Effect.gen(function* () {
      const fence = yield* Fence
      const art = yield* fence.runAudit(auditInput(1))
      expect(art.schemaVersion).toBe(1)
      expect(art.method).toBe("ast-aware")
      expect(art.threshold).toBe(0.9)
      expect(art.capPerRegion).toBe(60)
      expect(art.seed).toBe(1337)
      expect(art.baselineSha).toBe("a".repeat(40))
      expect(art.generatedAt).toBe("2026-01-01T00:00:00.000Z")
    }).pipe(Effect.provide(FenceTest)),
  )
})
