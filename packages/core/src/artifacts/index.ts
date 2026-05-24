/**
 * Artifacts service — the central fail-closed gate (RULE-022/023/024/030/054).
 *
 * Validation is two-phase: `Schema` decodes the shape, then a
 * recompute-and-compare step re-derives Wilson / ρ / changecost within 1e-9
 * (anti-tamper — RULE-022/024/054). Never trust a stored derived value.
 *
 * RULE-054 FIX lives here: `validateAll` MUST include a changecost readiness
 * check, so value-proxy `Vhat` provenance chains to a validated changecost
 * artifact (legacy had `changeCostArtifactStatus` complete but ZERO production
 * callers). The startup gate (orchestrator, RULE-030) calls `validateAll`.
 *
 * SCAFFOLD: `ArtifactsLive` is a stub. The acceptance tests are `it.skip` keyed
 * by RULE-022/023/024/030/054 — written now so the fixes stay tracked.
 */
import { Context, Effect, Layer } from "effect";
import type {
  ArtifactStatus,
  CalibrationArtifact,
  ChangeCostArtifact,
  FenceArtifact,
  ValueProxyStatus,
  ValueProxyValidationArtifact,
} from "../domain/index.ts";

/** Anti-tamper / re-derivation tolerance (RULE-022/024/054). */
export const NUMBER_TOLERANCE = 1e-9;

export class Artifacts extends Context.Tag("Artifacts")<
  Artifacts,
  {
    /**
     * RULE-030/054 — validate EVERY safety artifact (fence, calibration,
     * value-proxy, AND changecost — the RULE-054 fix) and return their statuses.
     * The startup gate stops at the first unusable; `doctor` (RULE-032) renders
     * all of them.
     */
    readonly validateAll: () => Effect.Effect<readonly ArtifactStatus[], never>;

    /** RULE-022 — fence artifact status (anti-tamper Wilson re-derivation). */
    readonly readFence: () => Effect.Effect<ArtifactStatus, never>;

    /** RULE-023 — calibration artifact status (provenance + positive-scale check). */
    readonly readCalibration: () => Effect.Effect<ArtifactStatus, never>;

    /** RULE-024 — value-proxy validation artifact status (ρ/p re-derivation). */
    readonly readValueProxy: () => Effect.Effect<ValueProxyStatus, never>;

    /** RULE-054 FIX — changecost artifact status (cost/Vhat re-derivation). */
    readonly readChangeCost: () => Effect.Effect<ValueProxyStatus, never>;
  }
>() {}

/** Convenience aliases referencing the artifact-shaped inputs the readers decode. */
export type FenceInput = FenceArtifact;
export type CalibrationInput = CalibrationArtifact;
export type ValueProxyInput = ValueProxyValidationArtifact;
export type ChangeCostInput = ChangeCostArtifact;

/**
 * Stub Layer. Real readers decode via `Schema` + recompute-and-compare in a later
 * wave. `Effect.die` keeps accidental production use loud.
 */
export const ArtifactsLive: Layer.Layer<Artifacts> = Layer.succeed(
  Artifacts,
  Artifacts.of({
    validateAll: () =>
      Effect.die("unimplemented: RULE-030/054 (Artifacts.validateAll)"),
    readFence: () => Effect.die("unimplemented: RULE-022 (Artifacts.readFence)"),
    readCalibration: () =>
      Effect.die("unimplemented: RULE-023 (Artifacts.readCalibration)"),
    readValueProxy: () =>
      Effect.die("unimplemented: RULE-024 (Artifacts.readValueProxy)"),
    readChangeCost: () =>
      Effect.die("unimplemented: RULE-054 (Artifacts.readChangeCost)"),
  }),
);
