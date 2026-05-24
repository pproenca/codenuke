import { FileSystem, Path } from "@effect/platform"
import {
  type CalibrationArtifact,
  type CalibrationScales,
  type FenceArtifact,
  type MetricConfidence,
  type ArtifactStatus,
  type ValueProxyStatus,
  hashString,
  validateCalibrationArtifact,
  validateChangeCostArtifact,
  validateFenceArtifact,
  validateValueProxyArtifact,
} from "@codenuke/core"
import { Effect } from "effect"
import type { ArtifactReadiness } from "../orchestrator/orchestrator.ts"

export interface ArtifactBundle {
  readonly readiness: ArtifactReadiness
  readonly artifactHashes: Record<string, string>
  readonly confidence: MetricConfidence
  readonly fence: FenceArtifact | null
  readonly calibration: CalibrationArtifact | null
  readonly calibrationScales: CalibrationScales | null
  readonly artifactStatuses: {
    readonly fence: ArtifactStatus
    readonly calibration: ArtifactStatus
    readonly changecost: ValueProxyStatus
    readonly valueProxy: ValueProxyStatus
  }
}

const readRaw = (
  fs: FileSystem.FileSystem,
  file: string,
): Effect.Effect<{ readonly raw: string | null; readonly parsed: unknown | null }, never> =>
  fs.readFileString(file).pipe(
    Effect.map((raw) => {
      try {
        return { raw, parsed: JSON.parse(raw) as unknown }
      } catch {
        return { raw, parsed: null }
      }
    }),
    Effect.orElseSucceed(() => ({ raw: null, parsed: null })),
  )

const hashRaw = (raw: string | null): string => (raw === null ? "missing" : hashString(raw))

export const readArtifactBundle = (opts: {
  readonly repo: string
  readonly baselineSha: string
  readonly threshold: number
}): Effect.Effect<ArtifactBundle, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dir = path.join(opts.repo, ".codenuke")

    const fenceRaw = yield* readRaw(fs, path.join(dir, "fence-fidelity.json"))
    const calibrationRaw = yield* readRaw(fs, path.join(dir, "calibration.json"))
    const changecostRaw = yield* readRaw(fs, path.join(dir, "changecost.json"))
    const valueProxyRaw = yield* readRaw(fs, path.join(dir, "value-proxy-validation.json"))

    const fence = validateFenceArtifact(fenceRaw.parsed, {
      baselineSha: opts.baselineSha,
      threshold: opts.threshold,
    })
    const calibration = validateCalibrationArtifact(calibrationRaw.parsed, { baselineSha: opts.baselineSha })

    const fenceRegions =
      fence.artifact === null
        ? null
        : Object.fromEntries(Object.entries(fence.artifact.regions).map(([key, rec]) => [key, { p: rec.p }]))

    const changecost = validateChangeCostArtifact(changecostRaw.parsed, fenceRegions)
    const valueProxy = validateValueProxyArtifact(valueProxyRaw.parsed)

    const readiness: ArtifactReadiness = {
      fencePresent: fence.status.present,
      fenceUsable: fence.status.usable,
      hasMeasuredRegion: fence.artifact !== null && Object.keys(fence.artifact.regions).length > 0,
      calibrationPresent: calibration.status.present,
      calibrationUsable: calibration.status.usable,
      changecostPresent: changecost.status.present,
      changecostUsable: changecost.status.usable,
      valueProxyPresent: valueProxy.status.present,
      valueProxyUsable: valueProxy.status.usable,
    }

    const enoughCalibration =
      calibration.artifact !== null && calibration.artifact.commitsSampled >= 3
    const confidence: MetricConfidence =
      valueProxy.status.usable && enoughCalibration
        ? "validated"
        : enoughCalibration
          ? "calibrated"
          : "bootstrap"

    return {
      readiness,
      artifactHashes: {
        fence: hashRaw(fenceRaw.raw),
        calibration: hashRaw(calibrationRaw.raw),
        changecost: hashRaw(changecostRaw.raw),
        valueProxy: hashRaw(valueProxyRaw.raw),
      },
      confidence,
      fence: fence.artifact,
      calibration: calibration.artifact,
      calibrationScales: calibration.status.usable ? calibration.artifact?.scales ?? null : null,
      artifactStatuses: {
        fence: fence.status,
        calibration: calibration.status,
        changecost: changecost.status,
        valueProxy: valueProxy.status,
      },
    }
  })

export const readArtifactReadiness = (opts: {
  readonly repo: string
  readonly baselineSha: string
  readonly threshold: number
}): Effect.Effect<ArtifactReadiness, never, FileSystem.FileSystem | Path.Path> =>
  readArtifactBundle(opts).pipe(Effect.map((bundle) => bundle.readiness))
