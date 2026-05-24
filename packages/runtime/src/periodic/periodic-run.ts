/**
 * Periodic-artifact generation (C9/C10) + doctor (RULE-032) — the effectful side
 * over the pure cores in calibrate.ts / value-proxy.ts.
 *
 *  - `runCalibrate`     RULE-010 — sample recent commits, measure each commit's
 *                       |per-axis delta|, derive scales, write calibration.json.
 *  - `runValidateProxy` RULE-024 — read a candidate corpus, run the Spearman /
 *                       permutation validation, write value-proxy-validation.json.
 *  - `runDoctor`        RULE-032 — collect EVERY readiness gap (no short-circuit).
 *
 * changecost (C11) real generation needs an Implementer port (heavy, like the
 * proposer) and is the remaining Slice-3 follow-up.
 */
import { FileSystem, Path } from "@effect/platform"
import { type Files, isSourceFile, measureFiles, spearmanRho } from "@codenuke/core"
import { Effect } from "effect"
import { Git } from "../git/git.ts"
import { type ReadinessGap } from "../orchestrator/orchestrator.ts"
import { collectGaps } from "../orchestrator/orchestrator.ts"
import { readArtifactReadiness } from "../loop/loop.ts"
import { type CommitDelta, deriveCalibration, HISTORY_WINDOW } from "./calibrate.ts"
import { type Candidate, DEFAULT_VALIDATION_OPTIONS, validateValueProxy } from "./value-proxy.ts"

const writeJson = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  repo: string,
  name: string,
  value: unknown,
) =>
  Effect.gen(function* () {
    const dir = path.join(repo, ".codenuke")
    yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.ignore)
    const out = path.join(dir, name)
    yield* fs.writeFileString(out, `${JSON.stringify(value, null, 2)}\n`)
    return out
  })

// ---------------------------------------------------------------------------
// Calibrate (C9, RULE-010)
// ---------------------------------------------------------------------------

export interface RunCalibrateResult {
  readonly outPath: string
  readonly scales: { readonly sL: number; readonly sCx: number; readonly sDup: number }
  readonly commitsSampled: number
  readonly enoughHistory: boolean
}

export const runCalibrate = (opts: { readonly repo: string; readonly region: string }) =>
  Effect.gen(function* () {
    const git = yield* Git
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    const commits = yield* git.revList(opts.repo, HISTORY_WINDOW)
    const baselineSha = yield* git.resolveSha(opts.repo, "HEAD")

    const readAtRef = (ref: string, rels: readonly string[]): Effect.Effect<Files> =>
      Effect.forEach(rels, (rel) =>
        git
          .showAtRef(opts.repo, ref, rel)
          .pipe(
            Effect.map((content) => [rel, content] as const),
            Effect.orElseSucceed(() => [rel, ""] as const),
          ),
      ).pipe(Effect.map((pairs) => Object.fromEntries(pairs)))

    const deltas: CommitDelta[] = []
    for (const c of commits) {
      const changed = yield* git
        .diffNamesRange(opts.repo, `${c}^`, c, opts.region)
        .pipe(Effect.orElseSucceed(() => [] as readonly string[]))
      const sources = changed.filter(isSourceFile)
      if (sources.length === 0) continue // oldest commit (no parent) or no source change
      const before = measureFiles(yield* readAtRef(`${c}^`, sources))
      const after = measureFiles(yield* readAtRef(c, sources))
      deltas.push({
        dL: Math.abs(after.L - before.L),
        dCx: Math.abs(after.complexity - before.complexity),
        dDup: Math.abs(after.dupMass - before.dupMass),
      })
    }

    const derived = deriveCalibration(deltas)
    const artifact = {
      schemaVersion: 1 as const,
      baseline: "HEAD",
      baselineSha,
      generatedAt: new Date().toISOString(),
      commitsSampled: derived.commitsSampled,
      scales: derived.scales,
    }
    const outPath = yield* writeJson(fs, path, opts.repo, "calibration.json", artifact)
    return {
      outPath,
      scales: derived.scales,
      commitsSampled: derived.commitsSampled,
      enoughHistory: derived.enoughHistory,
    } satisfies RunCalibrateResult
  })

// ---------------------------------------------------------------------------
// Validate-proxy (C10, RULE-024)
// ---------------------------------------------------------------------------

const spearmanForProxy = (a: readonly number[], b: readonly number[]): number => {
  const r = spearmanRho(a, b)
  return r === null ? Number.NaN : r
}

export const runValidateProxy = (opts: { readonly repo: string; readonly inputPath: string }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    const raw = yield* fs.readFileString(opts.inputPath).pipe(Effect.orElseSucceed(() => ""))
    const parsed: unknown = yield* Effect.try(() => JSON.parse(raw) as unknown).pipe(
      Effect.orElseSucceed(() => [] as unknown),
    )
    const rowsRaw: unknown = Array.isArray(parsed)
      ? parsed
      : ((parsed as { candidates?: unknown; rows?: unknown })?.candidates ??
        (parsed as { rows?: unknown })?.rows ??
        [])
    const candidates: Candidate[] = (Array.isArray(rowsRaw) ? rowsRaw : []).map((c, i) => {
      const o = c as Record<string, unknown>
      return { id: String(o["id"] ?? `candidate-${i}`), proxy: Number(o["proxy"]), Vhat: Number(o["Vhat"]) }
    })

    const report = validateValueProxy(candidates, DEFAULT_VALIDATION_OPTIONS, spearmanForProxy)
    const artifact = { schemaVersion: 1 as const, input: opts.inputPath, ...report, rows: candidates }
    const outPath = yield* writeJson(fs, path, opts.repo, "value-proxy-validation.json", artifact)
    return { outPath, report }
  })

// ---------------------------------------------------------------------------
// Doctor (RULE-032) — collect EVERY gap (no short-circuit)
// ---------------------------------------------------------------------------

export const runDoctor = (
  repo: string,
): Effect.Effect<readonly ReadinessGap[], never, FileSystem.FileSystem | Path.Path> =>
  readArtifactReadiness(repo).pipe(Effect.map((r) => collectGaps(r, true)))
