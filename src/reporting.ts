import { FeatureRecord, FindingRecord, PatchAttempt } from "./types.js";

export type FindingSummary = {
  id: string;
  title: string;
  severity: FindingRecord["severity"];
  category: FindingRecord["category"];
  confidence: FindingRecord["confidence"];
  triage: FindingRecord["triage"];
  status: FindingRecord["status"];
  feature: { id: string; title: string | null };
  evidence: Array<{
    path: string;
    startLine: number | null;
    endLine: number | null;
    symbol: string | null;
  }>;
  recommendation: string;
  reproduction: string | null;
  whyTestsDoNotAlreadyCoverThis: string;
  suggestedRegressionTest: string | null;
  minimumFixScope: string;
  next: string;
};

export function renderReport(
  findings: FindingRecord[],
  features: FeatureRecord[] = [],
  options: { includeNext?: boolean } = {},
): string {
  const lines = ["# codenuke report", "", `findings: ${findings.length}`, ""];
  const featureById = new Map(features.map((feature) => [feature.featureId, feature]));
  for (const finding of findings) {
    lines.push(`## ${finding.severity}: ${finding.title}`);
    lines.push("");
    lines.push(`id: ${finding.findingId}`);
    lines.push(`category: ${finding.category}`);
    lines.push(`confidence: ${finding.confidence}`);
    lines.push(`triage: ${finding.triage}`);
    lines.push(`status: ${finding.status}`);
    lines.push(`feature: ${featureLabel(finding.featureId, featureById.get(finding.featureId))}`);
    if (options.includeNext === true) {
      lines.push(`next: codenuke show --finding ${finding.findingId}`);
    }
    if (finding.evidence.length > 0) {
      lines.push("");
      lines.push("evidence:");
      for (const evidence of finding.evidence) {
        lines.push(`- ${evidenceLabel(evidence)}`);
      }
    }
    lines.push("");
    lines.push(finding.reasoning);
    if (finding.recommendation.length > 0) {
      lines.push("");
      lines.push("recommendation:");
      lines.push(finding.recommendation);
    }
    if (finding.whyTestsDoNotAlreadyCoverThis.length > 0) {
      lines.push("");
      lines.push("test analysis:");
      lines.push(finding.whyTestsDoNotAlreadyCoverThis);
    }
    if (finding.suggestedRegressionTest !== null && finding.suggestedRegressionTest.length > 0) {
      lines.push("");
      lines.push("suggested regression test:");
      lines.push(finding.suggestedRegressionTest);
    }
    if (finding.minimumFixScope.length > 0) {
      lines.push("");
      lines.push("minimum fix scope:");
      lines.push(finding.minimumFixScope);
    }
    if (finding.reproduction !== null && finding.reproduction.length > 0) {
      lines.push("");
      lines.push("repro:");
      lines.push(finding.reproduction);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function renderFindingDetail(
  finding: FindingRecord,
  feature: FeatureRecord | null,
  patches: PatchAttempt[],
  validation: string[],
): string {
  const lines = [`# ${finding.title}`, ""];
  lines.push(`id: ${finding.findingId}`);
  lines.push(`status: ${finding.status}`);
  lines.push(`severity: ${finding.severity}`);
  lines.push(`category: ${finding.category}`);
  lines.push(`confidence: ${finding.confidence}`);
  lines.push(`triage: ${finding.triage}`);
  lines.push(`feature: ${featureLabel(finding.featureId, feature ?? undefined)}`);
  lines.push("");
  lines.push("evidence:");
  for (const evidence of finding.evidence) {
    lines.push(`- ${evidenceLabel(evidence)}`);
  }
  if (finding.evidence.length === 0) {
    lines.push("- none");
  }
  lines.push("");
  lines.push("reasoning:");
  lines.push(finding.reasoning);
  lines.push("");
  lines.push("recommendation:");
  lines.push(finding.recommendation);
  if (finding.whyTestsDoNotAlreadyCoverThis.length > 0) {
    lines.push("");
    lines.push("test analysis:");
    lines.push(finding.whyTestsDoNotAlreadyCoverThis);
  }
  if (finding.suggestedRegressionTest !== null && finding.suggestedRegressionTest.length > 0) {
    lines.push("");
    lines.push("suggested regression test:");
    lines.push(finding.suggestedRegressionTest);
  }
  if (finding.minimumFixScope.length > 0) {
    lines.push("");
    lines.push("minimum fix scope:");
    lines.push(finding.minimumFixScope);
  }
  if (feature !== null) {
    lines.push("");
    lines.push("owned files:");
    for (const file of feature.ownedFiles) {
      lines.push(`- ${file.path}: ${file.reason}`);
    }
    lines.push("");
    lines.push("context files:");
    for (const file of feature.contextFiles) {
      lines.push(`- ${file.path}: ${file.reason}`);
    }
  }
  lines.push("");
  lines.push("validation:");
  for (const command of validation) {
    lines.push(`- ${command}`);
  }
  if (validation.length === 0) {
    lines.push("- none");
  }
  lines.push("");
  lines.push("patch attempts:");
  for (const patch of patches) {
    lines.push(`- ${patch.patchAttemptId}: ${patch.status}`);
  }
  if (patches.length === 0) {
    lines.push("- none");
  }
  lines.push("");
  lines.push("history:");
  for (const entry of finding.history) {
    lines.push(
      `- ${entry.createdAt}: ${entry.kind} ${entry.status ?? ""} ${entry.note ?? ""}`.trim(),
    );
  }
  if (finding.history.length === 0) {
    lines.push("- none");
  }
  lines.push("");
  lines.push(`next: codenuke triage --finding ${finding.findingId} --status <status>`);
  return `${lines.join("\n")}\n`;
}

export function findingSummaries(
  findings: FindingRecord[],
  features: FeatureRecord[],
): FindingSummary[] {
  const featureById = new Map(features.map((feature) => [feature.featureId, feature]));
  return findings.map((finding) =>
    findingSummary(finding, featureById.get(finding.featureId) ?? null),
  );
}

export function findingSummary(
  finding: FindingRecord,
  feature: FeatureRecord | null,
): FindingSummary {
  return {
    id: finding.findingId,
    title: finding.title,
    severity: finding.severity,
    category: finding.category,
    confidence: finding.confidence,
    triage: finding.triage,
    status: finding.status,
    feature: {
      id: finding.featureId,
      title: feature?.title ?? null,
    },
    evidence: finding.evidence.map((evidence) => ({
      path: evidence.path,
      startLine: evidence.startLine,
      endLine: evidence.endLine,
      symbol: evidence.symbol,
    })),
    recommendation: finding.recommendation,
    reproduction: finding.reproduction,
    whyTestsDoNotAlreadyCoverThis: finding.whyTestsDoNotAlreadyCoverThis,
    suggestedRegressionTest: finding.suggestedRegressionTest,
    minimumFixScope: finding.minimumFixScope,
    next: `codenuke show --finding ${finding.findingId}`,
  };
}

export function evidenceLabel(evidence: FindingRecord["evidence"][number]): string {
  const line =
    evidence.startLine === null
      ? ""
      : evidence.endLine !== null && evidence.endLine !== evidence.startLine
        ? `:${evidence.startLine}-${evidence.endLine}`
        : `:${evidence.startLine}`;
  const symbol = evidence.symbol === null ? "" : ` (${evidence.symbol})`;
  return `${evidence.path}${line}${symbol}`;
}

export function featureLabel(featureId: string, feature: FeatureRecord | undefined): string {
  return feature === undefined ? featureId : `${feature.title} (${featureId})`;
}
