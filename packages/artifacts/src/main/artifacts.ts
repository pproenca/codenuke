/**
 * Safety-artifact validity + freshness checks for codenuke. Migrated from
 * `legacy/codenuke/loop/artifacts.mjs`. These are the **fail-closed** gates: a
 * missing / stale / invalid fence, calibration, value-proxy, or changecost
 * artifact is never trusted. The fence check RE-DERIVES the Wilson statistics,
 * so a hand-edited "admissible: true" cannot pass (anti-tamper, RULE-022).
 *
 * @see analysis/codenuke/BUSINESS_RULES.md — RULE-022, RULE-023, RULE-024
 */
import { tryRun } from "@codenuke/exec";
import { finiteNumber } from "@codenuke/guards";
import { readJson } from "@codenuke/json";
import { wilson } from "@codenuke/stats";
import { validateValueProxy } from "@codenuke/value-proxy";

export const DEFAULT_CALIBRATION_SCALES = { sL: 150, sCx: 15, sDup: 5 } as const;
export const MIN_CALIBRATION_COMMITS = 3;
const FENCE_NUMBER_TOLERANCE = 1e-9;

/** The subset of resolved config these validators read. */
export interface ArtifactConfig {
  readonly repo: string;
  readonly baseline: string;
  readonly fenceArtifact: string;
  readonly thresholds: { readonly fenceLB: number };
}

/** Result of the fence/calibration validators (has a freshness dimension). */
export interface ArtifactStatus {
  readonly artifact: Record<string, unknown> | null;
  readonly usable: boolean;
  readonly stale: boolean;
  readonly reason: string | null;
}

/** Result of the value-proxy/changecost validators (no freshness dimension). */
export interface ValueProxyStatus {
  readonly artifact: Record<string, unknown> | null;
  readonly usable: boolean;
  readonly reason: string | null;
}

export type ChangeCostArtifactStatus = ValueProxyStatus;

/** Resolve a git ref to its SHA, or null if it can't be verified. */
function resolveRef(repo: string, ref: string): string | null {
  const result = tryRun("git", ["rev-parse", "--verify", ref], { cwd: repo });
  return result.ok ? result.out.trim() : null;
}

const nonNegativeInteger = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0;
const positiveInteger = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) > 0;
const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
const finiteNonNegativeNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const positiveFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;
const nearlyEqual = (left: number, right: number): boolean =>
  Math.abs(left - right) <= FENCE_NUMBER_TOLERANCE;
const validIsoDate = (value: unknown): value is string =>
  nonEmptyString(value) && !Number.isNaN(Date.parse(value));
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function validFenceMetadata(artifact: Record<string, unknown>, threshold: number): boolean {
  return (
    nonEmptyString(artifact.baseline) &&
    nonEmptyString(artifact.generatedAt) &&
    artifact.method === "ast-aware" &&
    finiteNumber(artifact.threshold) &&
    artifact.threshold === threshold &&
    positiveInteger(artifact.capPerRegion) &&
    nonNegativeInteger(artifact.seed)
  );
}

function validSurvivorSpec(spec: Record<string, unknown> | undefined): boolean {
  return (
    nonEmptyString(spec?.rel) &&
    nonNegativeInteger(spec?.start) &&
    nonNegativeInteger(spec?.end) &&
    (spec!.end as number) > (spec!.start as number) &&
    typeof spec?.repl === "string" &&
    nonEmptyString(spec?.op)
  );
}

function validFenceRegions(regions: Record<string, Record<string, unknown>>, threshold: number): boolean {
  if (!finiteNumber(threshold)) return false;
  if (Object.keys(regions).length === 0) return false;
  return Object.values(regions).every((region) => {
    if (!isRecord(region)) return false;
    if (
      !nonNegativeInteger(region?.caught) ||
      !nonNegativeInteger(region?.total) ||
      (region.caught as number) > (region.total as number) ||
      !finiteNumber(region.p) ||
      !finiteNumber(region.lo) ||
      !finiteNumber(region.hi) ||
      typeof region.admissible !== "boolean" ||
      !Array.isArray(region.survivorSpecs)
    ) {
      return false;
    }
    const p = region.p as number;
    const lo = region.lo as number;
    const hi = region.hi as number;
    if (lo < 0 || p < lo || hi < p || hi > 1) return false;
    const expected = wilson(region.caught as number, region.total as number);
    if (!nearlyEqual(p, expected.p) || !nearlyEqual(lo, expected.lo) || !nearlyEqual(hi, expected.hi)) {
      return false;
    }
    if (region.survivorSpecs.length !== (region.total as number) - (region.caught as number)) return false;
    if (!region.survivorSpecs.every(validSurvivorSpec)) return false;
    return region.admissible === lo >= threshold;
  });
}

/** Fence artifact status: missing / stale / invalid / usable (RULE-022). */
export function fenceArtifactStatus(config: ArtifactConfig): ArtifactStatus {
  const artifact = readJson<Record<string, unknown>>(config.fenceArtifact);
  if (!artifact?.regions || !isRecord(artifact.regions)) {
    return { artifact: null, usable: false, stale: false, reason: "missing" };
  }

  const baselineSha = resolveRef(config.repo, config.baseline);
  if (artifact.baselineSha && (!baselineSha || artifact.baselineSha !== baselineSha)) {
    return { artifact, usable: false, stale: true, reason: "stale-baseline-sha" };
  }
  if (!artifact.baselineSha && artifact.baseline && artifact.baseline !== config.baseline) {
    return { artifact, usable: false, stale: true, reason: "stale-baseline-ref" };
  }
  if (!validFenceMetadata(artifact, config.thresholds.fenceLB)) {
    return { artifact, usable: false, stale: false, reason: "invalid-metadata" };
  }
  if (!validFenceRegions(artifact.regions as Record<string, Record<string, unknown>>, config.thresholds.fenceLB)) {
    return { artifact, usable: false, stale: false, reason: "invalid-regions" };
  }

  return { artifact, usable: true, stale: false, reason: null };
}

function matchesDefaultCalibrationScales(scales: Record<string, unknown> | undefined): boolean {
  return (
    scales?.sL === DEFAULT_CALIBRATION_SCALES.sL &&
    scales?.sCx === DEFAULT_CALIBRATION_SCALES.sCx &&
    scales?.sDup === DEFAULT_CALIBRATION_SCALES.sDup
  );
}

/** Calibration artifact status: missing / stale / invalid-provenance / invalid-scales / usable (RULE-023). */
export function calibrationArtifactStatus(config: ArtifactConfig): ArtifactStatus {
  const path = `${config.repo}/.codenuke/calibration.json`;
  const artifact = readJson<Record<string, unknown>>(path);
  if (!artifact) return { artifact: null, usable: false, stale: false, reason: "missing" };

  const baselineSha = resolveRef(config.repo, config.baseline);
  if (artifact.baselineSha && (!baselineSha || artifact.baselineSha !== baselineSha)) {
    return { artifact, usable: false, stale: true, reason: "stale-baseline-sha" };
  }
  if (!artifact.baselineSha && artifact.baseline && artifact.baseline !== config.baseline) {
    return { artifact, usable: false, stale: true, reason: "stale-baseline-ref" };
  }
  const scales = artifact.scales as Record<string, unknown> | undefined;
  if (
    artifact.schemaVersion !== 1 ||
    !nonEmptyString(artifact.baseline) ||
    !nonEmptyString(artifact.baselineSha) ||
    !validIsoDate(artifact.generatedAt)
  ) {
    return { artifact, usable: false, stale: false, reason: "invalid-metadata" };
  }
  if (
    !Number.isInteger(artifact.commitsSampled) ||
    (artifact.commitsSampled as number) < 0 ||
    ((artifact.commitsSampled as number) < MIN_CALIBRATION_COMMITS && !matchesDefaultCalibrationScales(scales))
  ) {
    return { artifact, usable: false, stale: false, reason: "invalid-provenance" };
  }
  if (
    !positiveFiniteNumber(scales?.sL) ||
    !positiveFiniteNumber(scales?.sCx) ||
    !positiveFiniteNumber(scales?.sDup)
  ) {
    return { artifact, usable: false, stale: false, reason: "invalid-scales" };
  }

  return { artifact, usable: true, stale: false, reason: null };
}

/** Value-proxy validation artifact status: re-derives the PASS claim (RULE-024). */
export function valueProxyValidationStatus(config: ArtifactConfig): ValueProxyStatus {
  const path = `${config.repo}/.codenuke/value-proxy-validation.json`;
  const artifact = readJson<Record<string, unknown>>(path);
  if (!artifact) return { artifact: null, usable: false, reason: "missing" };
  const rows = artifact.rows;
  if (
    artifact.schemaVersion !== 1 ||
    artifact.passed !== true ||
    artifact.reason !== null ||
    !nonNegativeInteger(artifact.candidates) ||
    !Number.isInteger(artifact.minimumCandidates) ||
    (artifact.minimumCandidates as number) < 2 ||
    (artifact.candidates as number) < (artifact.minimumCandidates as number) ||
    !finiteNumber(artifact.minimumRho) ||
    (artifact.minimumRho as number) < -1 ||
    (artifact.minimumRho as number) > 1 ||
    !finiteNumber(artifact.rho) ||
    (artifact.rho as number) < -1 ||
    (artifact.rho as number) > 1 ||
    (artifact.rho as number) < (artifact.minimumRho as number) ||
    !finiteNumber(artifact.alpha) ||
    (artifact.alpha as number) <= 0 ||
    (artifact.alpha as number) > 1 ||
    !finiteNumber(artifact.pValue) ||
    (artifact.pValue as number) < 0 ||
    (artifact.pValue as number) > 1 ||
    (artifact.pValue as number) > (artifact.alpha as number) ||
    !Array.isArray(rows) ||
    rows.length !== (artifact.candidates as number) ||
    !rows.every(
      (row: Record<string, unknown>) =>
        nonEmptyString(row?.id) && finiteNumber(row?.proxy) && finiteNumber(row?.Vhat),
    )
  ) {
    return { artifact, usable: false, reason: "invalid" };
  }
  const derived = validateValueProxy(rows as { id: string; proxy: number; Vhat: number }[], {
    minimumCandidates: artifact.minimumCandidates as number,
    minimumRho: artifact.minimumRho as number,
    alpha: artifact.alpha as number,
  });
  if (
    derived.passed !== true ||
    derived.reason !== null ||
    !nearlyEqual(derived.rho as number, artifact.rho as number) ||
    !nearlyEqual(derived.pValue as number, artifact.pValue as number) ||
    derived.pMethod !== artifact.pMethod
  ) {
    return { artifact, usable: false, reason: "invalid" };
  }

  return { artifact, usable: true, reason: null };
}

function changeCostVerifyFrac(
  regions: readonly string[],
  fenceArtifact: Record<string, unknown> | null,
): number {
  if (!fenceArtifact) return 1;
  if (regions.length === 0) return 0;
  const fenceRegions = fenceArtifact.regions as Record<string, Record<string, unknown>> | undefined;
  const fidelity = (region: string): number => {
    const p = fenceRegions?.[region]?.p;
    return typeof p === "number" && Number.isFinite(p) ? p : 0;
  };
  return regions.reduce((sum, region) => sum + (1 - fidelity(region)), 0) / regions.length;
}

function validChangeCostDoneResult(
  result: Record<string, unknown>,
  beta: number,
  fenceArtifact: Record<string, unknown> | null,
): boolean {
  if (
    !nonNegativeInteger(result.editTokens) ||
    !nonNegativeInteger(result.filesTouched) ||
    !Array.isArray(result.regions) ||
    !result.regions.every(nonEmptyString) ||
    !finiteNonNegativeNumber(result.verifyFrac) ||
    (result.verifyFrac as number) > 1 ||
    !finiteNonNegativeNumber(result.cost)
  ) {
    return false;
  }
  const expectedVerifyFrac = changeCostVerifyFrac(result.regions, fenceArtifact);
  if (!nearlyEqual(result.verifyFrac as number, expectedVerifyFrac)) return false;
  const expectedCost = (result.editTokens as number) + beta * (result.verifyFrac as number);
  return nearlyEqual(result.cost as number, expectedCost);
}

function validChangeCostResult(
  result: unknown,
  beta: number,
  fenceArtifact: Record<string, unknown> | null,
): result is Record<string, unknown> {
  if (!isRecord(result) || !nonEmptyString(result.id) || !nonEmptyString(result.status)) return false;
  if (!["impl-fail", "impl-bad-surface", "not-done", "done"].includes(result.status)) return false;
  return result.status === "done" ? validChangeCostDoneResult(result, beta, fenceArtifact) : true;
}

/** Changecost artifact status: re-derives summary metrics from result rows. */
export function changeCostArtifactStatus(config: ArtifactConfig): ChangeCostArtifactStatus {
  const path = `${config.repo}/.codenuke/changecost.json`;
  const artifact = readJson<Record<string, unknown>>(path);
  if (!artifact) return { artifact: null, usable: false, reason: "missing" };
  const results = artifact.results;
  const fenceStatus = fenceArtifactStatus(config);
  const fence = fenceStatus.usable ? fenceStatus.artifact : null;
  if (
    artifact.schemaVersion !== 1 ||
    !nonEmptyString(artifact.ref) ||
    !finiteNonNegativeNumber(artifact.beta) ||
    !nonNegativeInteger(artifact.done) ||
    !nonNegativeInteger(artifact.total) ||
    !Array.isArray(results) ||
    results.length !== (artifact.total as number) ||
    !results.every((result) => validChangeCostResult(result, artifact.beta as number, fence))
  ) {
    return { artifact, usable: false, reason: "invalid" };
  }

  const doneResults = results.filter(
    (result): result is Record<string, unknown> => isRecord(result) && result.status === "done",
  );
  if (doneResults.length !== (artifact.done as number)) {
    return { artifact, usable: false, reason: "invalid" };
  }
  const expectedVhat =
    doneResults.length === 0
      ? null
      : doneResults.reduce((sum, result) => sum + (result.cost as number), 0) / doneResults.length;
  if (expectedVhat === null) {
    if (artifact.Vhat !== null) return { artifact, usable: false, reason: "invalid" };
  } else if (!finiteNonNegativeNumber(artifact.Vhat) || !nearlyEqual(artifact.Vhat, expectedVhat)) {
    return { artifact, usable: false, reason: "invalid" };
  }

  return { artifact, usable: true, reason: null };
}
