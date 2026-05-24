import { DIFFSIZE_COEFF } from "../kernel/index.ts";
import type {
  GuardrailFailure,
  GuardrailReport,
  MetricConfidence,
  MetricContext,
  MetricProvenance,
  ScoreEnvelope,
  Verdict,
  Weights,
} from "../domain/index.ts";

export const METRIC_NAME = "observed-behavior-preserving-reduction-value";
export const METRIC_SEMVER = "2.0.0";
export const METRIC_REPRESENTATION =
  "typescript-sourcefile-ast-nodes+cyclomatic+duplicate-token-windows";

export const stableStringify = (value: unknown): string => {
  const seen = new WeakSet<object>();
  const encode = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v)) throw new TypeError("stableStringify: circular value");
    seen.add(v);
    if (Array.isArray(v)) return v.map(encode);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(v as Record<string, unknown>).sort()) {
      out[key] = encode((v as Record<string, unknown>)[key]);
    }
    return out;
  };
  return JSON.stringify(encode(value));
};

/** Deterministic non-cryptographic hash for stable ids/config hashes in pure code. */
export const hashString = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

export const hashUnknown = (value: unknown): string => hashString(stableStringify(value));

export const formulaConstantsOf = (weights: Weights): Record<string, number> => ({
  dL: weights.dL,
  dCx: weights.dCx,
  dDup: weights.dDup,
  r3: weights.r3,
  scaleL: weights.scaleL,
  scaleCx: weights.scaleCx,
  scaleDup: weights.scaleDup,
  diffsizeCoeff: DIFFSIZE_COEFF,
});

export const guardrailReport = (
  failures: readonly GuardrailFailure[] = [],
): GuardrailReport => ({
  passed: failures.length === 0,
  failures: [...failures],
});

export const metricContext = (args: {
  readonly confidence: MetricConfidence;
  readonly weights: Weights;
  readonly provenance: MetricProvenance;
  readonly representation?: string;
}): MetricContext => ({
  identity: { name: METRIC_NAME, semver: METRIC_SEMVER },
  confidence: args.confidence,
  formulaConstants: formulaConstantsOf(args.weights),
  representation: args.representation ?? METRIC_REPRESENTATION,
  provenance: args.provenance,
});

export const scoreEnvelopeStatus = (
  verdict: Verdict | null,
  guardrails: GuardrailReport,
): ScoreEnvelope["status"] => {
  if (!guardrails.passed) {
    return guardrails.failures.some((f) => f.severity === "block") ? "blocked" : "rejected";
  }
  if (verdict === null) return "blocked";
  return verdict.keep ? "accepted" : "rejected";
};

export const scoreEnvelope = (args: {
  readonly verdict: Verdict | null;
  readonly metric: MetricContext;
  readonly guardrails?: GuardrailReport;
}): ScoreEnvelope => {
  const guardrails = args.guardrails ?? guardrailReport();
  return {
    schemaVersion: 2,
    _tag: "Scored",
    status: scoreEnvelopeStatus(args.verdict, guardrails),
    metric: args.metric,
    guardrails,
    verdict: args.verdict,
  };
};

