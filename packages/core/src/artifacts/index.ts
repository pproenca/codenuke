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
import { Context, Effect, Either, Layer, ParseResult, Schema } from "effect";
import {
  CalibrationArtifact,
  ChangeCostArtifact,
  FenceArtifact,
  ValueProxyValidationArtifact,
} from "../domain/index.ts";
import type {
  ArtifactStatus,
  ValueProxyStatus,
} from "../domain/index.ts";
import { costOf, type FenceRegions, verifyFrac, vhatOf } from "../changecost/index.ts";
import { wilson } from "../kernel/index.ts";
import { validateValueProxy } from "../value-proxy/index.ts";

/** Anti-tamper / re-derivation tolerance (RULE-022/024/054). */
export const NUMBER_TOLERANCE = 1e-9;

export const DEFAULT_CALIBRATION_SCALES = { sL: 150, sCx: 15, sDup: 5 } as const;
export const MIN_CALIBRATION_COMMITS = 3;

export interface ValidationResult<T, S = ArtifactStatus> {
  readonly status: S;
  readonly artifact: T | null;
}

const missingArtifact = (): ArtifactStatus => ({
  present: false,
  stale: false,
  usable: false,
  reason: "missing",
});

const invalidArtifact = (reason: string): ArtifactStatus => ({
  present: true,
  stale: false,
  usable: false,
  reason,
});

const staleArtifact = (reason: string): ArtifactStatus => ({
  present: true,
  stale: true,
  usable: false,
  reason,
});

const usableArtifact = (): ArtifactStatus => ({
  present: true,
  stale: false,
  usable: true,
  reason: null,
});

const missingValueArtifact = (): ValueProxyStatus => ({
  present: false,
  usable: false,
  reason: "missing",
});

const invalidValueArtifact = (reason: string): ValueProxyStatus => ({
  present: true,
  usable: false,
  reason,
});

const usableValueArtifact = (): ValueProxyStatus => ({
  present: true,
  usable: true,
  reason: null,
});

const parseError = (error: ParseResult.ParseError): string =>
  ParseResult.TreeFormatter.formatErrorSync(error);

const nearlyEqual = (a: number, b: number): boolean =>
  Math.abs(a - b) <= NUMBER_TOLERANCE;

const isPositiveFinite = (n: number): boolean => Number.isFinite(n) && n > 0;

const decodeEither = <A, I>(
  schema: Schema.Schema<A, I, never>,
  raw: unknown,
): Either.Either<A, ParseResult.ParseError> => Schema.decodeUnknownEither(schema)(raw);

export const validateFenceArtifact = (
  raw: unknown,
  opts: { readonly baselineSha: string; readonly threshold: number },
): ValidationResult<FenceArtifact> => {
  if (raw === null || raw === undefined) return { status: missingArtifact(), artifact: null };
  const decoded = decodeEither(FenceArtifact, raw);
  if (Either.isLeft(decoded)) {
    return { status: invalidArtifact(`invalid-metadata: ${parseError(decoded.left)}`), artifact: null };
  }
  const artifact = decoded.right;
  if (artifact.baselineSha !== opts.baselineSha) {
    return { status: staleArtifact(`stale-baseline-${artifact.baselineSha}-${opts.baselineSha}`), artifact };
  }
  if (artifact.threshold !== opts.threshold) {
    return { status: invalidArtifact("invalid-metadata: threshold mismatch"), artifact };
  }
  for (const [region, rec] of Object.entries(artifact.regions)) {
    if (!Number.isInteger(rec.caught) || !Number.isInteger(rec.total) || rec.caught < 0 || rec.total < 0 || rec.caught > rec.total) {
      return { status: invalidArtifact(`invalid-regions: ${region} caught/total`), artifact };
    }
    const w = wilson(rec.caught, rec.total);
    if (!nearlyEqual(w.p, rec.p) || !nearlyEqual(w.lo, rec.lo) || !nearlyEqual(w.hi, rec.hi)) {
      return { status: invalidArtifact(`invalid-regions: ${region} wilson`), artifact };
    }
    if (rec.admissible !== (rec.lo >= artifact.threshold)) {
      return { status: invalidArtifact(`invalid-regions: ${region} admissible`), artifact };
    }
    if (rec.survivorSpecs.length !== rec.total - rec.caught) {
      return { status: invalidArtifact(`invalid-regions: ${region} survivors`), artifact };
    }
  }
  return { status: usableArtifact(), artifact };
};

const isDefaultScales = (artifact: CalibrationArtifact): boolean =>
  artifact.scales.sL === DEFAULT_CALIBRATION_SCALES.sL &&
  artifact.scales.sCx === DEFAULT_CALIBRATION_SCALES.sCx &&
  artifact.scales.sDup === DEFAULT_CALIBRATION_SCALES.sDup;

export const validateCalibrationArtifact = (
  raw: unknown,
  opts: { readonly baselineSha: string },
): ValidationResult<CalibrationArtifact> => {
  if (raw === null || raw === undefined) return { status: missingArtifact(), artifact: null };
  const decoded = decodeEither(CalibrationArtifact, raw);
  if (Either.isLeft(decoded)) {
    return { status: invalidArtifact(`invalid-metadata: ${parseError(decoded.left)}`), artifact: null };
  }
  const artifact = decoded.right;
  if (artifact.baselineSha !== opts.baselineSha) {
    return { status: staleArtifact(`stale-baseline-${artifact.baselineSha}-${opts.baselineSha}`), artifact };
  }
  if (!isPositiveFinite(artifact.scales.sL) || !isPositiveFinite(artifact.scales.sCx) || !isPositiveFinite(artifact.scales.sDup)) {
    return { status: invalidArtifact("invalid-scales"), artifact };
  }
  if (artifact.commitsSampled < MIN_CALIBRATION_COMMITS && !isDefaultScales(artifact)) {
    return { status: invalidArtifact("invalid-provenance"), artifact };
  }
  return { status: usableArtifact(), artifact };
};

export const validateValueProxyArtifact = (
  raw: unknown,
): ValidationResult<ValueProxyValidationArtifact, ValueProxyStatus> => {
  if (raw === null || raw === undefined) return { status: missingValueArtifact(), artifact: null };
  const decoded = decodeEither(ValueProxyValidationArtifact, raw);
  if (Either.isLeft(decoded)) {
    return { status: invalidValueArtifact(`malformed-input: ${parseError(decoded.left)}`), artifact: null };
  }
  const artifact = decoded.right;
  if (!artifact.passed || artifact.reason !== null) {
    return { status: invalidValueArtifact(artifact.reason ?? "not-passed"), artifact };
  }
  if (artifact.candidates < artifact.minimumCandidates || artifact.minimumCandidates < 2) {
    return { status: invalidValueArtifact("too-small-corpus"), artifact };
  }
  if (artifact.rows.length !== artifact.candidates) {
    return { status: invalidValueArtifact("malformed-input: row-count"), artifact };
  }
  if (artifact.rho === null || artifact.rho < artifact.minimumRho || artifact.rho < -1 || artifact.rho > 1) {
    return { status: invalidValueArtifact("low-rho"), artifact };
  }
  if (artifact.pValue === null || artifact.pValue < 0 || artifact.pValue > artifact.alpha) {
    return { status: invalidValueArtifact("not-significant"), artifact };
  }
  const rerun = validateValueProxy(artifact.rows, {
    minimumCandidates: artifact.minimumCandidates,
    minimumRho: artifact.minimumRho,
    alpha: artifact.alpha,
  });
  if (
    rerun.passed !== artifact.passed ||
    rerun.reason !== artifact.reason ||
    rerun.rho === null ||
    rerun.pValue === null ||
    artifact.pMethod === null ||
    !nearlyEqual(rerun.rho, artifact.rho) ||
    !nearlyEqual(rerun.pValue, artifact.pValue) ||
    rerun.pMethod !== artifact.pMethod
  ) {
    return { status: invalidValueArtifact("tampered: value-proxy re-derivation mismatch"), artifact };
  }
  return { status: usableValueArtifact(), artifact };
};

export const validateChangeCostArtifact = (
  raw: unknown,
  fence: FenceRegions | null,
): ValidationResult<ChangeCostArtifact, ValueProxyStatus> => {
  if (raw === null || raw === undefined) return { status: missingValueArtifact(), artifact: null };
  const decoded = decodeEither(ChangeCostArtifact, raw);
  if (Either.isLeft(decoded)) {
    return { status: invalidValueArtifact(`malformed-input: ${parseError(decoded.left)}`), artifact: null };
  }
  const artifact = decoded.right;
  if (!isPositiveFinite(artifact.beta) || artifact.results.length !== artifact.total) {
    return { status: invalidValueArtifact("invalid-metadata"), artifact };
  }
  const doneCosts: number[] = [];
  let done = 0;
  for (const result of artifact.results) {
    if (result.status !== "done") continue;
    done += 1;
    if (
      typeof result.editTokens !== "number" ||
      typeof result.verifyFrac !== "number" ||
      typeof result.cost !== "number"
    ) {
      return { status: invalidValueArtifact(`invalid-result: ${result.id}`), artifact };
    }
    const expectedVerify = fence === null ? 1 : verifyFrac(result.regions ?? [], fence);
    const expectedCost = costOf(result.editTokens, expectedVerify, artifact.beta);
    if (!nearlyEqual(result.verifyFrac, expectedVerify) || !nearlyEqual(result.cost, expectedCost)) {
      return { status: invalidValueArtifact(`tampered: ${result.id}`), artifact };
    }
    doneCosts.push(result.cost);
  }
  if (done !== artifact.done) {
    return { status: invalidValueArtifact("tampered: done-count"), artifact };
  }
  const expectedVhat = vhatOf(doneCosts);
  if (expectedVhat === null ? artifact.Vhat !== null : artifact.Vhat === null || !nearlyEqual(artifact.Vhat, expectedVhat)) {
    return { status: invalidValueArtifact("tampered: Vhat"), artifact };
  }
  return { status: usableValueArtifact(), artifact };
};

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
