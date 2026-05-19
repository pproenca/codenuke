import { FeatureRecord, FindingRecord, PatchAttempt } from "../platform/types.js";

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
  guidance: FindingRecord["guidance"];
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
    appendEvidence(lines, finding.evidence, "omit");
    lines.push("");
    lines.push(finding.reasoning);
    appendOptionalFindingSections(lines, finding, {
      recommendation: "when-present",
      includeReproduction: true,
    });
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
  appendEvidence(lines, finding.evidence, "none");
  lines.push("");
  lines.push("reasoning:");
  lines.push(finding.reasoning);
  appendOptionalFindingSections(lines, finding, {
    recommendation: "always",
    includeReproduction: false,
  });
  appendGuidanceTrace(lines, finding);
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

function appendEvidence(
  lines: string[],
  evidenceRefs: FindingRecord["evidence"],
  emptyMode: "omit" | "none",
): void {
  if (evidenceRefs.length === 0 && emptyMode === "omit") {
    return;
  }
  lines.push("");
  lines.push("evidence:");
  for (const evidence of evidenceRefs) {
    lines.push(`- ${evidenceLabel(evidence)}`);
  }
  if (evidenceRefs.length === 0) {
    lines.push("- none");
  }
}

function appendOptionalFindingSections(
  lines: string[],
  finding: FindingRecord,
  options: { recommendation: "always" | "when-present"; includeReproduction: boolean },
): void {
  if (options.recommendation === "always" || finding.recommendation.length > 0) {
    appendSection(lines, "recommendation:", finding.recommendation);
  }
  if (finding.whyTestsDoNotAlreadyCoverThis.length > 0) {
    appendSection(lines, "test analysis:", finding.whyTestsDoNotAlreadyCoverThis);
  }
  if (finding.suggestedRegressionTest !== null && finding.suggestedRegressionTest.length > 0) {
    appendSection(lines, "suggested regression test:", finding.suggestedRegressionTest);
  }
  if (finding.minimumFixScope.length > 0) {
    appendSection(lines, "minimum fix scope:", finding.minimumFixScope);
  }
  if (
    options.includeReproduction &&
    finding.reproduction !== null &&
    finding.reproduction.length > 0
  ) {
    appendSection(lines, "repro:", finding.reproduction);
  }
}

function appendSection(lines: string[], label: string, value: string): void {
  lines.push("");
  lines.push(label);
  lines.push(value);
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
    guidance: finding.guidance,
    next: `codenuke show --finding ${finding.findingId}`,
  };
}

function appendGuidanceTrace(lines: string[], finding: FindingRecord): void {
  lines.push("");
  lines.push("guidance:");
  if (finding.guidance.selected.length === 0 && finding.guidance.applied.length === 0) {
    lines.push("- none");
    return;
  }
  if (finding.guidance.selected.length > 0) {
    lines.push("selected:");
    for (const entry of finding.guidance.selected) {
      lines.push(`- ${entry.title} (${entry.kind})`);
      lines.push(`  why: ${entry.reason}`);
      lines.push(`  use: ${entry.use}`);
    }
  }
  if (finding.guidance.applied.length > 0) {
    lines.push("applied:");
    for (const entry of finding.guidance.applied) {
      lines.push(`- ${entry.title} (${entry.kind})`);
      lines.push(`  why: ${entry.reason}`);
      lines.push(`  use: ${entry.use}`);
    }
  }
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
