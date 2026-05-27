/**
 * Domain model — effect/Schema shapes for every value object and persisted
 * artifact in @codenuke/core. Shapes only (no behavior). Invariants are encoded
 * as Schema refinements where they are cheap and unambiguous; heavier
 * cross-field/anti-tamper invariants (Wilson re-derivation, changecost
 * re-derivation) live in the artifacts service as recompute-and-compare steps.
 *
 * Source of truth: spec/DOMAIN_MODEL.md, DATA_OBJECTS.md, BEHAVIOR_CONTRACT.md.
 *
 * Each entity is exported as BOTH a runtime Schema value and an inferred TS type
 * of the same name, so callers can `import { Verdict }` and use it as a type or
 * decode with it.
 */
import { Schema } from "effect";

// --- shared brands / refinements -------------------------------------------

/** A finite number (rejects NaN / ±Infinity). */
export const FiniteNumber = Schema.Number.pipe(Schema.finite());

/** A 40-char lowercase hex git SHA. */
export const Sha40 = Schema.String.pipe(Schema.pattern(/^[0-9a-f]{40}$/));

/** A probability/fidelity in [0,1]. */
export const Unit = Schema.Number.pipe(Schema.between(0, 1));

// ---------------------------------------------------------------------------
// Measurement & scoring
// ---------------------------------------------------------------------------

/** RULE-003/004/005 — size/complexity/duplication snapshot of a region. */
export const Measurement = Schema.Struct({
  L: FiniteNumber,
  complexity: FiniteNumber,
  dupMass: FiniteNumber,
});
export type Measurement = Schema.Schema.Type<typeof Measurement>;

/** RULE-001/002 — scoring trade-off vector (axis weights + scales + r3). */
export const Weights = Schema.Struct({
  dL: FiniteNumber,
  dCx: FiniteNumber,
  dDup: FiniteNumber,
  scaleL: FiniteNumber,
  scaleCx: FiniteNumber,
  scaleDup: FiniteNumber,
  r3: FiniteNumber,
});
export type Weights = Schema.Schema.Type<typeof Weights>;

/** RULE-010 — per-repo axis normalizers overriding the weight-default scales. */
export const CalibrationScales = Schema.Struct({
  sL: FiniteNumber,
  sCx: FiniteNumber,
  sDup: FiniteNumber,
});
export type CalibrationScales = Schema.Schema.Type<typeof CalibrationScales>;

/** Metric confidence reported with every v2 scored-result envelope. */
export const MetricConfidence = Schema.Literal("bootstrap", "calibrated", "validated");
export type MetricConfidence = Schema.Schema.Type<typeof MetricConfidence>;

/** Stable identity of the metric contract used to score a candidate. */
export const MetricIdentity = Schema.Struct({
  name: Schema.String,
  semver: Schema.String,
});
export type MetricIdentity = Schema.Schema.Type<typeof MetricIdentity>;

/** Runtime provenance needed to reproduce a metric verdict. */
export const MetricProvenance = Schema.Struct({
  baselineSha: Schema.String,
  configHash: Schema.String,
  artifactHashes: Schema.Record({ key: Schema.String, value: Schema.String }),
  toolchain: Schema.Record({ key: Schema.String, value: Schema.String }),
});
export type MetricProvenance = Schema.Schema.Type<typeof MetricProvenance>;

/** Full metric context embedded in the public v2 scored-result envelope. */
export const MetricContext = Schema.Struct({
  identity: MetricIdentity,
  confidence: MetricConfidence,
  formulaConstants: Schema.Record({ key: Schema.String, value: FiniteNumber }),
  representation: Schema.String,
  provenance: MetricProvenance,
});
export type MetricContext = Schema.Schema.Type<typeof MetricContext>;

/** Stable guardrail failure emitted when a hard veto rejects or blocks a candidate. */
export const GuardrailFailure = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  severity: Schema.Literal("reject", "block"),
  path: Schema.optional(Schema.String),
});
export type GuardrailFailure = Schema.Schema.Type<typeof GuardrailFailure>;

/** Aggregated guardrail report; all failures are hard vetoes, never soft penalties. */
export const GuardrailReport = Schema.Struct({
  passed: Schema.Boolean,
  failures: Schema.Array(GuardrailFailure),
});
export type GuardrailReport = Schema.Schema.Type<typeof GuardrailReport>;

/** Everything pure `decide` needs (assembled by the side-effectful caller). */
export const ScoreInputs = Schema.Struct({
  before: Measurement,
  after: Measurement,
  testsPass: Schema.Boolean,
  fenceUsable: Schema.Boolean,
  blockedRegions: Schema.Array(Schema.String),
  touchedFidelities: Schema.Array(Schema.Number),
  diffsize: FiniteNumber,
  typeErrors: FiniteNumber,
  baselineTypeErrors: FiniteNumber,
  weights: Weights,
  // `null` (no calibration) or a usable CalibrationScales override.
  scales: Schema.optional(Schema.NullOr(CalibrationScales)),
});
export type ScoreInputs = Schema.Schema.Type<typeof ScoreInputs>;

/** RULE-018..021 — the four boolean safety gates. */
export const Gates = Schema.Struct({
  G1: Schema.Boolean,
  G1prime: Schema.Boolean,
  G3: Schema.Boolean,
  G4: Schema.Boolean,
});
export type Gates = Schema.Schema.Type<typeof Gates>;

/** Identifier for a single gate (used by Verdict.failedGates, RULE-063 fix). */
export const GateName = Schema.Literal("G1", "G1prime", "G3", "G4");
export type GateName = Schema.Schema.Type<typeof GateName>;

/**
 * RULE-035 — the immutable keep/revert decision.
 * `loss` is `null` when non-finite/inadmissible (RULE-035).
 * `failedGates` lists ALL failing gates — RULE-063 FIX (legacy reported only the
 * highest-priority one).
 */
export const Verdict = Schema.Struct({
  gain: Schema.Number,
  risk: Schema.Number,
  loss: Schema.NullOr(Schema.Number),
  keep: Schema.Boolean,
  admissible: Schema.Boolean,
  gates: Gates,
  failedGates: Schema.Array(GateName),
  dL: Schema.Number,
  dCx: Schema.Number,
  dDup: Schema.Number,
  mfence: Schema.Number,
});
export type Verdict = Schema.Schema.Type<typeof Verdict>;

/** Public v2 scored-result envelope emitted by `score --json` and progress events. */
export const ScoreEnvelope = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  _tag: Schema.Literal("Scored"),
  status: Schema.Literal("accepted", "rejected", "blocked"),
  metric: MetricContext,
  guardrails: GuardrailReport,
  verdict: Schema.NullOr(Verdict),
});
export type ScoreEnvelope = Schema.Schema.Type<typeof ScoreEnvelope>;

/** Verdict + run context for reporting (runtime.ts:83). */
export const ScoreResult = Schema.Struct({
  ...Verdict.fields,
  files: Schema.Array(Schema.String),
  touched: Schema.Array(Schema.String),
  blocked: Schema.Array(Schema.String),
});
export type ScoreResult = Schema.Schema.Type<typeof ScoreResult>;

/** Deterministic JS/TS graph-discovery opportunity. */
export const Opportunity = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literal(
    "duplicate-subtree",
    "wrapper-chain",
    "unused-symbol",
    "similar-function",
    "local-simplification",
  ),
  region: Schema.String,
  files: Schema.Array(Schema.String),
  inputHash: Schema.String,
  estimatedGain: FiniteNumber,
  evidence: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});
export type Opportunity = Schema.Schema.Type<typeof Opportunity>;

// ---------------------------------------------------------------------------
// Fence (behavior fidelity)
// ---------------------------------------------------------------------------

/** RULE-007 — a single injectable behavior change (operator flip). */
export const MutationSite = Schema.Struct({
  start: FiniteNumber,
  end: FiniteNumber,
  repl: Schema.String,
  op: Schema.String,
});
export type MutationSite = Schema.Schema.Type<typeof MutationSite>;

/** A MutationSite pinned to a repo-relative source file. */
export const PlannedMutation = Schema.Struct({
  ...MutationSite.fields,
  rel: Schema.String,
});
export type PlannedMutation = Schema.Schema.Type<typeof PlannedMutation>;

/** RULE-006 — Wilson score interval; bounds clamped to [0,1]. */
export const WilsonInterval = Schema.Struct({
  p: Unit,
  lo: Unit,
  hi: Unit,
});
export type WilsonInterval = Schema.Schema.Type<typeof WilsonInterval>;

/** RULE-009 — per-region mutation-audit result. */
export const RegionRecord = Schema.Struct({
  caught: FiniteNumber,
  total: FiniteNumber,
  p: Unit,
  lo: Unit,
  hi: Unit,
  admissible: Schema.Boolean,
  survivorSpecs: Schema.Array(PlannedMutation),
});
export type RegionRecord = Schema.Schema.Type<typeof RegionRecord>;

/** RULE-022 — persisted `.codenuke/fence-fidelity.json`. */
export const FenceArtifact = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  baseline: Schema.String,
  baselineSha: Sha40,
  generatedAt: Schema.String,
  method: Schema.Literal("ast-aware"),
  threshold: FiniteNumber,
  capPerRegion: FiniteNumber,
  seed: FiniteNumber,
  regions: Schema.Record({ key: Schema.String, value: RegionRecord }),
});
export type FenceArtifact = Schema.Schema.Type<typeof FenceArtifact>;

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

/** RULE-010 — absolute per-axis change over one commit. */
export const CommitDelta = Schema.Struct({
  dL: FiniteNumber,
  dCx: FiniteNumber,
  dDup: FiniteNumber,
});
export type CommitDelta = Schema.Schema.Type<typeof CommitDelta>;

/** RULE-010/023 — derived-or-default scales + provenance. */
export const DerivedCalibration = Schema.Struct({
  scales: CalibrationScales,
  enoughHistory: Schema.Boolean,
  commitsSampled: FiniteNumber,
});
export type DerivedCalibration = Schema.Schema.Type<typeof DerivedCalibration>;

/** RULE-023 — persisted `.codenuke/calibration.json`. */
export const CalibrationArtifact = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  baseline: Schema.String,
  baselineSha: Sha40,
  generatedAt: Schema.String,
  commitsSampled: FiniteNumber,
  scales: CalibrationScales,
});
export type CalibrationArtifact = Schema.Schema.Type<typeof CalibrationArtifact>;

// ---------------------------------------------------------------------------
// Value proxy
// ---------------------------------------------------------------------------

/** RULE-011 — one row correlating cheap proxy vs ground-truth cost. */
export const Candidate = Schema.Struct({
  id: Schema.String,
  proxy: FiniteNumber,
  Vhat: FiniteNumber,
});
export type Candidate = Schema.Schema.Type<typeof Candidate>;

/** Reason a value-proxy validation failed (`null` when it passed). */
export const ValidationFailure = Schema.Literal(
  "too-small-corpus",
  "undefined-rank-correlation",
  "low-rho",
  "not-significant",
  "invalid-config",
  "malformed-input",
);
export type ValidationFailure = Schema.Schema.Type<typeof ValidationFailure>;

/** Permutation-test path taken (RULE-015). */
export const PMethod = Schema.Literal("exact", "sampled", "degenerate");
export type PMethod = Schema.Schema.Type<typeof PMethod>;

/** RULE-024 — Spearman proxy↔truth validation verdict + stats. */
export const ValidationReport = Schema.Struct({
  passed: Schema.Boolean,
  reason: Schema.NullOr(ValidationFailure),
  candidates: FiniteNumber,
  minimumCandidates: FiniteNumber,
  minimumRho: FiniteNumber,
  alpha: FiniteNumber,
  rho: Schema.NullOr(Schema.Number),
  pValue: Schema.NullOr(Schema.Number),
  pMethod: Schema.NullOr(PMethod),
  rows: Schema.Array(Candidate),
  error: Schema.optional(Schema.String),
});
export type ValidationReport = Schema.Schema.Type<typeof ValidationReport>;

/** RULE-024 — persisted `.codenuke/value-proxy-validation.json`. */
export const ValueProxyValidationArtifact = Schema.Struct({
  ...ValidationReport.fields,
  schemaVersion: Schema.Literal(1),
  input: Schema.String,
});
export type ValueProxyValidationArtifact = Schema.Schema.Type<
  typeof ValueProxyValidationArtifact
>;

// ---------------------------------------------------------------------------
// Change cost (ground truth)
// ---------------------------------------------------------------------------

/** RULE-012 — token/file edit-size measurement of one implemented task. */
export const EditCostResult = Schema.Struct({
  tokens: FiniteNumber,
  filesTouched: FiniteNumber,
  perFile: Schema.Record({ key: Schema.String, value: FiniteNumber }),
});
export type EditCostResult = Schema.Schema.Type<typeof EditCostResult>;

/** One benchmark task the implementer attempts. */
export const BenchmarkDelta = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  prompt: Schema.String,
  region: Schema.optional(Schema.String),
  acceptPath: Schema.String,
  acceptTest: Schema.String,
  dir: Schema.String,
});
export type BenchmarkDelta = Schema.Schema.Type<typeof BenchmarkDelta>;

/** RULE-055 — outcome of a single change-cost task. */
export const ChangeCostStatus = Schema.Literal(
  "impl-fail",
  "impl-bad-surface",
  "not-done",
  "done",
);
export type ChangeCostStatus = Schema.Schema.Type<typeof ChangeCostStatus>;

/** RULE-011/055 — per-task outcome + ground-truth cost. */
export const ChangeCostResult = Schema.Struct({
  id: Schema.String,
  status: ChangeCostStatus,
  editTokens: Schema.optional(FiniteNumber),
  filesTouched: Schema.optional(FiniteNumber),
  regions: Schema.optional(Schema.Array(Schema.String)),
  verifyFrac: Schema.optional(FiniteNumber),
  cost: Schema.optional(FiniteNumber),
  disallowed: Schema.optional(Schema.Array(Schema.String)),
});
export type ChangeCostResult = Schema.Schema.Type<typeof ChangeCostResult>;

/** RULE-054 — persisted `.codenuke/changecost.json` (Vhat ground truth). */
export const ChangeCostArtifact = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  ref: Schema.String,
  beta: FiniteNumber,
  Vhat: Schema.NullOr(Schema.Number),
  done: FiniteNumber,
  total: FiniteNumber,
  results: Schema.Array(ChangeCostResult),
});
export type ChangeCostArtifact = Schema.Schema.Type<typeof ChangeCostArtifact>;

// ---------------------------------------------------------------------------
// Orchestration & runtime state
// ---------------------------------------------------------------------------

/** RULE-053 — cumulative loop checkpoint (EngineState/ScorerState, one shape). */
export const EngineState = Schema.Struct({
  baselineSha: Sha40,
  baselineTsc: FiniteNumber,
  startL: FiniteNumber,
  accepted: Schema.Array(Schema.String),
  iter: FiniteNumber,
});
export type EngineState = Schema.Schema.Type<typeof EngineState>;

/** RULE-039/042/047 — one proposer invocation contract. */
export const ProposerRequest = Schema.Struct({
  mode: Schema.Literal("reduce", "raise-fence"),
  prompt: Schema.String,
  promptFile: Schema.String,
  repo: Schema.String,
  worktree: Schema.String,
  regionKey: Schema.String,
  regionTarget: Schema.String,
  timeoutMs: FiniteNumber,
  budgetUsd: Schema.String,
  threadID: Schema.optional(Schema.String),
});
export type ProposerRequest = Schema.Schema.Type<typeof ProposerRequest>;

/** RULE-047/058 — outcome of one proposer turn. */
export const ProposerResult = Schema.Struct({
  ok: Schema.Boolean,
  out: Schema.String,
  timedOut: Schema.Boolean,
  provider: Schema.Literal("codex-cli", "codex-sdk"),
  threadID: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
});
export type ProposerResult = Schema.Schema.Type<typeof ProposerResult>;

/** RULE-057 — one persisted SDK conversation, keyed `mode:regionTarget`. */
export const ProposerThreadEntry = Schema.Struct({
  threadID: Schema.String,
  createdAt: Schema.String,
  lastUsedAt: Schema.String,
  baselineSha: Schema.optional(Sha40),
});
export type ProposerThreadEntry = Schema.Schema.Type<typeof ProposerThreadEntry>;

/** RULE-057 — persisted `.codenuke/proposer-threads.json`. */
export const ProposerThreadState = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  provider: Schema.Literal("codex-sdk"),
  threads: Schema.Record({ key: Schema.String, value: ProposerThreadEntry }),
});
export type ProposerThreadState = Schema.Schema.Type<typeof ProposerThreadState>;

// ---------------------------------------------------------------------------
// Cross-cutting primitives
// ---------------------------------------------------------------------------

/** RULE-048 — no-shell command contract (`shell` is intentionally absent). */
export const CommandSpec = Schema.Struct({
  file: Schema.String.pipe(Schema.minLength(1)),
  args: Schema.optional(Schema.Array(Schema.String)),
  timeoutMs: Schema.optional(FiniteNumber.pipe(Schema.positive())),
  env: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
});
export type CommandSpec = Schema.Schema.Type<typeof CommandSpec>;

/** RULE-033/034/048/049 — fully-resolved per-repo configuration (selected fields). */
export const Config = Schema.Struct({
  repo: Schema.String,
  srcDir: Schema.String,
  target: Schema.String,
  region: Schema.String,
  regions: Schema.Array(Schema.String),
  testLayout: Schema.Struct({
    roots: Schema.Array(Schema.String),
    description: Schema.String,
  }),
  baseline: Schema.String,
  tag: Schema.String,
  branch: Schema.String,
  worktree: Schema.String,
  testCommand: CommandSpec,
  typeCheckCommand: Schema.NullOr(CommandSpec),
  implementerCommand: Schema.NullOr(CommandSpec),
  state: Schema.String,
  promptFile: Schema.String,
  fenceArtifact: Schema.String,
  results: Schema.String,
  program: Schema.String,
  benchmarkDir: Schema.String,
  thresholds: Schema.Struct({ fenceLB: Unit }),
  weights: Weights,
  proposerBudgetUsd: Schema.String,
  proposerTimeoutMs: FiniteNumber.pipe(Schema.positive()),
});
export type Config = Schema.Schema.Type<typeof Config>;

/**
 * RULE-022/023 — readiness verdict WITH freshness (fence/calibration).
 * Invariant: `usable ⇒ ¬stale`.
 */
export const ArtifactStatus = Schema.Struct({
  present: Schema.Boolean,
  stale: Schema.Boolean,
  usable: Schema.Boolean,
  reason: Schema.NullOr(Schema.String),
});
export type ArtifactStatus = Schema.Schema.Type<typeof ArtifactStatus>;

/**
 * RULE-024/054 — readiness verdict WITHOUT freshness (value-proxy/changecost).
 * `ChangeCostArtifactStatus` is an alias of this shape.
 */
export const ValueProxyStatus = Schema.Struct({
  present: Schema.Boolean,
  usable: Schema.Boolean,
  reason: Schema.NullOr(Schema.String),
});
export type ValueProxyStatus = Schema.Schema.Type<typeof ValueProxyStatus>;
