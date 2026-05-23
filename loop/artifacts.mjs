import { execFileSync } from "node:child_process";
import { finiteNumber } from "./guards.mjs";
import { readJson } from "./json.mjs";
import { wilson } from "./stats.mjs";

export const DEFAULT_CALIBRATION_SCALES = { sL: 150, sCx: 15, sDup: 5 };
export const MIN_CALIBRATION_COMMITS = 3;
const FENCE_NUMBER_TOLERANCE = 1e-9;

function resolveRef(repo, ref) {
  try {
    return execFileSync("git", ["rev-parse", "--verify", ref], {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

export function fenceArtifactStatus(config) {
  const artifact = readJson(config.fenceArtifact);
  if (!artifact?.regions || typeof artifact.regions !== "object") {
    return { artifact: null, usable: false, stale: false, reason: "missing" };
  }

  const baselineSha = resolveRef(config.repo, config.baseline);
  if (artifact.baselineSha && baselineSha && artifact.baselineSha !== baselineSha) {
    return { artifact, usable: false, stale: true, reason: "stale-baseline-sha" };
  }
  if (!artifact.baselineSha && artifact.baseline && artifact.baseline !== config.baseline) {
    return { artifact, usable: false, stale: true, reason: "stale-baseline-ref" };
  }
  if (!validFenceMetadata(artifact, config.thresholds.fenceLB)) {
    return { artifact, usable: false, stale: false, reason: "invalid-metadata" };
  }
  if (!validFenceRegions(artifact.regions, config.thresholds.fenceLB)) {
    return { artifact, usable: false, stale: false, reason: "invalid-regions" };
  }

  return { artifact, usable: true, stale: false, reason: null };
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function validFenceMetadata(artifact, threshold) {
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

function validSurvivorSpec(spec) {
  return (
    nonEmptyString(spec?.rel) &&
    nonNegativeInteger(spec.start) &&
    nonNegativeInteger(spec.end) &&
    spec.end > spec.start &&
    typeof spec.repl === "string" &&
    nonEmptyString(spec.op)
  );
}

function nearlyEqual(left, right) {
  return Math.abs(left - right) <= FENCE_NUMBER_TOLERANCE;
}

function validFenceRegions(regions, threshold) {
  if (!finiteNumber(threshold)) return false;
  if (Object.keys(regions).length === 0) return false;
  return Object.values(regions).every((region) => {
    if (
      !nonNegativeInteger(region?.caught) ||
      !nonNegativeInteger(region?.total) ||
      region.caught > region.total ||
      !finiteNumber(region.p) ||
      !finiteNumber(region.lo) ||
      !finiteNumber(region.hi) ||
      typeof region.admissible !== "boolean" ||
      !Array.isArray(region.survivorSpecs)
    ) {
      return false;
    }
    if (region.lo < 0 || region.p < region.lo || region.hi < region.p || region.hi > 1) {
      return false;
    }
    const expected = wilson(region.caught, region.total);
    if (
      !nearlyEqual(region.p, expected.p) ||
      !nearlyEqual(region.lo, expected.lo) ||
      !nearlyEqual(region.hi, expected.hi)
    ) {
      return false;
    }
    if (region.survivorSpecs.length !== region.total - region.caught) return false;
    if (!region.survivorSpecs.every(validSurvivorSpec)) return false;
    return region.admissible === region.lo >= threshold;
  });
}

function positiveFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function matchesDefaultCalibrationScales(scales) {
  return (
    scales?.sL === DEFAULT_CALIBRATION_SCALES.sL &&
    scales?.sCx === DEFAULT_CALIBRATION_SCALES.sCx &&
    scales?.sDup === DEFAULT_CALIBRATION_SCALES.sDup
  );
}

export function calibrationArtifactStatus(config) {
  const path = `${config.repo}/.codenuke/calibration.json`;
  const artifact = readJson(path);
  if (!artifact) return { artifact: null, usable: false, stale: false, reason: "missing" };
  const baselineSha = resolveRef(config.repo, config.baseline);
  if (artifact.baselineSha && baselineSha && artifact.baselineSha !== baselineSha) {
    return { artifact, usable: false, stale: true, reason: "stale-baseline-sha" };
  }
  if (!artifact.baselineSha && artifact.baseline && artifact.baseline !== config.baseline) {
    return { artifact, usable: false, stale: true, reason: "stale-baseline-ref" };
  }
  if (
    !Number.isInteger(artifact.commitsSampled) ||
    artifact.commitsSampled < 0 ||
    (artifact.commitsSampled < MIN_CALIBRATION_COMMITS &&
      !matchesDefaultCalibrationScales(artifact.scales))
  ) {
    return { artifact, usable: false, stale: false, reason: "invalid-provenance" };
  }
  if (
    !positiveFiniteNumber(artifact.scales?.sL) ||
    !positiveFiniteNumber(artifact.scales?.sCx) ||
    !positiveFiniteNumber(artifact.scales?.sDup)
  ) {
    return { artifact, usable: false, stale: false, reason: "invalid-scales" };
  }

  return { artifact, usable: true, stale: false, reason: null };
}

export function valueProxyValidationStatus(config) {
  const path = `${config.repo}/.codenuke/value-proxy-validation.json`;
  const artifact = readJson(path);
  if (!artifact) return { artifact: null, usable: false, reason: "missing" };
  if (
    artifact.passed !== true ||
    artifact.reason !== null ||
    !nonNegativeInteger(artifact.candidates) ||
    !Number.isInteger(artifact.minimumCandidates) ||
    artifact.minimumCandidates < 2 ||
    artifact.candidates < artifact.minimumCandidates ||
    !finiteNumber(artifact.minimumRho) ||
    artifact.minimumRho < -1 ||
    artifact.minimumRho > 1 ||
    !finiteNumber(artifact.rho) ||
    artifact.rho < -1 ||
    artifact.rho > 1 ||
    artifact.rho < artifact.minimumRho ||
    !Array.isArray(artifact.rows) ||
    artifact.rows.length !== artifact.candidates ||
    !artifact.rows.every(
      (row) => nonEmptyString(row?.id) && finiteNumber(row.proxy) && finiteNumber(row.Vhat),
    )
  ) {
    return { artifact, usable: false, reason: "invalid" };
  }

  return { artifact, usable: true, reason: null };
}
