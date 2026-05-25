import {
  decide,
  guardrailReport,
  hashUnknown,
  metricContext,
  scoreEnvelope,
  type CalibrationScales,
  type GuardrailFailure,
  type Measurement,
  type MetricConfidence,
  type MetricProvenance,
  type ScoreEnvelope,
  type ScoreInputs,
  type Verdict,
  type Weights,
} from "@codenuke/core"

export const SCORE_DEFAULT_WEIGHTS: Weights = {
  dL: 1.0,
  dCx: 1.8,
  dDup: 0.35,
  scaleL: 150,
  scaleCx: 15,
  scaleDup: 5,
  r3: 1.0,
}

export interface GateInputs {
  readonly testsPass: boolean
  readonly fenceUsable: boolean
  readonly blockedRegions: readonly string[]
  readonly touchedFidelities: readonly number[]
  readonly diffsize: number
  readonly typeErrors: number
  readonly baselineTypeErrors: number
  readonly weights?: Weights
  readonly scales?: CalibrationScales | null
}

export const assembleScoreInputs = (args: {
  readonly before: Measurement
  readonly after: Measurement
} & GateInputs): ScoreInputs => ({
  before: args.before,
  after: args.after,
  testsPass: args.testsPass,
  fenceUsable: args.fenceUsable,
  blockedRegions: [...args.blockedRegions],
  touchedFidelities: [...args.touchedFidelities],
  diffsize: args.diffsize,
  typeErrors: args.typeErrors,
  baselineTypeErrors: args.baselineTypeErrors,
  weights: args.weights ?? SCORE_DEFAULT_WEIGHTS,
  scales: args.scales ?? null,
})

export const buildMetricProvenance = (args: {
  readonly baselineSha: string
  readonly config: unknown
  readonly artifactHashes: Record<string, string>
}): MetricProvenance => ({
  baselineSha: args.baselineSha,
  configHash: hashUnknown(args.config),
  artifactHashes: args.artifactHashes,
  toolchain: {
    node: process.version,
    codenuke: "0.5.0",
    typescript: "5.7",
  },
})

export const decideEnvelope = (args: {
  readonly before: Measurement
  readonly after: Measurement
  readonly gates: GateInputs
  readonly baselineSha: string
  readonly confidence: MetricConfidence
  readonly artifactHashes: Record<string, string>
  readonly config: unknown
  readonly guardrailFailures?: readonly GuardrailFailure[]
}): ScoreEnvelope => {
  const inputs = assembleScoreInputs({ before: args.before, after: args.after, ...args.gates })
  const guardrails = guardrailReport(args.guardrailFailures ?? [])
  const verdict = guardrails.failures.some((f) => f.severity === "block") ? null : decide(inputs)
  const metric = metricContext({
    confidence: args.confidence,
    weights: inputs.weights,
    provenance: buildMetricProvenance({
      baselineSha: args.baselineSha,
      config: args.config,
      artifactHashes: args.artifactHashes,
    }),
  })
  return scoreEnvelope({ verdict, metric, guardrails })
}

export const renderScoreHuman = (envelope: ScoreEnvelope): string => {
  const verdict: Verdict | null = envelope.verdict
  const guardrail = envelope.guardrails.failures[0]
  if (verdict === null) {
    return [
      `verdict: BLOCKED`,
      `  metric=${envelope.metric.identity.semver} confidence=${envelope.metric.confidence}`,
      guardrail ? `  guardrail=${guardrail.code}: ${guardrail.message}` : "  guardrail=unknown",
    ].join("\n")
  }
  const word = envelope.status === "accepted" ? "KEEP" : verdict.admissible ? "REVERT (no gain)" : "REVERT (gate fail)"
  const loss = verdict.loss === null ? "null" : verdict.loss.toFixed(4)
  const failed = verdict.failedGates.length ? `  failedGates=[${verdict.failedGates.join(",")}]` : ""
  const text = guardrail ? `\n  guardrail=${guardrail.code}: ${guardrail.message}` : ""
  return [
    `verdict: ${word}`,
    `  metric=${envelope.metric.identity.semver} confidence=${envelope.metric.confidence}`,
    `  gain=${verdict.gain.toFixed(4)}  risk=${verdict.risk.toFixed(4)}  loss=${loss}`,
    `  ΔL=${verdict.dL}  ΔCx=${verdict.dCx}  ΔDup=${verdict.dDup}  mfence=${verdict.mfence}`,
    `  gates: G1=${verdict.gates.G1} G1'=${verdict.gates.G1prime} G3=${verdict.gates.G3} G4=${verdict.gates.G4}${failed}${text}`,
  ].join("\n")
}
