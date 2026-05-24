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
  ScoreInputs,
  Gates,
  GateName,
  Verdict,
  ScoreResult,
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

// --- artifacts --------------------------------------------------------------
export { Artifacts, ArtifactsLive, NUMBER_TOLERANCE } from "./artifacts/index.ts";

// --- subprocess env allowlist (C8) ------------------------------------------
export {
  allowlistEnv,
  GIT_ENV_ALLOWLIST,
  SUBPROCESS_ENV_ALLOWLIST,
} from "./env/index.ts";
