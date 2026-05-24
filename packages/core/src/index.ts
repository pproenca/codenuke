/**
 * @codenuke/core — the public cross-package contract.
 *
 * This barrel is the fence other packages (@codenuke/fence, @codenuke/runtime)
 * and the CLI runtime import from. The exported names are stable; submodule
 * layout is internal.
 *
 *  - domain/    effect/Schema value objects + persisted-artifact shapes
 *  - errors/    the Data.TaggedError ADT
 *  - kernel/    PURE value math + the shared fence-gap helper (min vs mean)
 *  - measure/   Measure service + MeasureLive (stub)
 *  - artifacts/ Artifacts fail-closed gate + ArtifactsLive (stub)
 */

// --- domain (Schema values + inferred types share each name) ----------------
export {
  // shared refinements
  FiniteNumber,
  Sha40,
  Unit,
  // measurement & scoring
  Measurement,
  Weights,
  CalibrationScales,
  MetricConfidence,
  MetricIdentity,
  MetricProvenance,
  MetricContext,
  GuardrailFailure,
  GuardrailReport,
  ScoreInputs,
  Gates,
  GateName,
  Verdict,
  ScoreEnvelope,
  ScoreResult,
  Opportunity,
  // fence
  MutationSite,
  PlannedMutation,
  WilsonInterval,
  RegionRecord,
  FenceArtifact,
  // calibration
  CommitDelta,
  DerivedCalibration,
  CalibrationArtifact,
  // value proxy
  Candidate,
  ValidationFailure,
  PMethod,
  ValidationReport,
  ValueProxyValidationArtifact,
  // change cost
  EditCostResult,
  BenchmarkDelta,
  ChangeCostStatus,
  ChangeCostResult,
  ChangeCostArtifact,
  // orchestration & runtime state
  EngineState,
  ProposerRequest,
  ProposerResult,
  ProposerThreadEntry,
  ProposerThreadState,
  // cross-cutting primitives
  CommandSpec,
  Config,
  ArtifactStatus,
  ValueProxyStatus,
} from "./domain/index.ts";

// --- errors ADT -------------------------------------------------------------
export {
  GateFailed,
  ArtifactMissing,
  ArtifactStale,
  ArtifactTampered,
  ArtifactInvalid,
  ConfigInvalid,
  ShellStringRejected,
  PathEscape,
  GitFailed,
  ProposerTimeout,
  CommandTimeout,
  ProposerBudgetExceeded,
  WorktreeDirty,
  ReplayPreconditionFailed,
  CorpusTooSmall,
  RankCorrelationUndefined,
  StateStale,
} from "./errors/index.ts";

// --- kernel (PURE) ----------------------------------------------------------
export {
  Z_95,
  DIFFSIZE_COEFF,
  gain,
  risk,
  computeLoss,
  gates,
  decide,
  wilson,
  tieRanks,
  spearmanRho,
  fenceGapMin,
  fenceGapMean,
  countTypeErrors,
  parseDiffSize,
} from "./kernel/index.ts";

// --- measure ----------------------------------------------------------------
export {
  Measure,
  MeasureLive,
  measureFiles,
  measureText,
  isSourceFile,
  isTestFile,
} from "./measure/index.ts";
export type { Files } from "./measure/index.ts";

// --- deterministic discovery -------------------------------------------------
export { discoverOpportunities } from "./discovery/index.ts";

// --- metric envelope / guardrails -------------------------------------------
export {
  METRIC_NAME,
  METRIC_SEMVER,
  METRIC_REPRESENTATION,
  formulaConstantsOf,
  guardrailReport,
  hashString,
  hashUnknown,
  metricContext,
  scoreEnvelope,
  scoreEnvelopeStatus,
  stableStringify,
} from "./metric/index.ts";

// --- value-proxy pure validation --------------------------------------------
export {
  ALPHA,
  DEFAULT_VALIDATION_OPTIONS,
  EXACT_CAP,
  MIN_CANDIDATES,
  MIN_RHO,
  PERMUTATION_EPS,
  PERMUTATION_SAMPLES,
  PERMUTATION_SEED,
  makePrng,
  permutationPValue,
  pMethodForSize,
  validateValueProxy,
} from "./value-proxy/index.ts";
export type { PermutationResult, ValidationOptions, ValidationReportCore } from "./value-proxy/index.ts";

// --- changecost pure validation ---------------------------------------------
export {
  DEFAULT_BETA,
  costOf,
  editSize,
  editTokensOf,
  fidelityOf,
  lcsLength,
  tokenize,
  verifyFrac,
  vhatOf,
} from "./changecost/index.ts";
export type { FenceRegions, PerFileEdit } from "./changecost/index.ts";

// --- artifacts --------------------------------------------------------------
export {
  Artifacts,
  ArtifactsLive,
  DEFAULT_CALIBRATION_SCALES,
  MIN_CALIBRATION_COMMITS,
  NUMBER_TOLERANCE,
  validateCalibrationArtifact,
  validateChangeCostArtifact,
  validateFenceArtifact,
  validateValueProxyArtifact,
} from "./artifacts/index.ts";
export type { ValidationResult } from "./artifacts/index.ts";

// --- subprocess env allowlist (C8) ------------------------------------------
export {
  allowlistEnv,
  GIT_ENV_ALLOWLIST,
  SUBPROCESS_ENV_ALLOWLIST,
} from "./env/index.ts";
