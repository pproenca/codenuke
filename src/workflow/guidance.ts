import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FeatureRecord,
  GuidanceSelectionAudit,
  GuidanceTraceEntry,
  guidanceResourceKinds,
} from "../platform/types.js";
import { pathExists } from "../platform/fs.js";

export type GuidanceStage = "review" | "fix" | "revalidate";

type ManifestResource = {
  id: string;
  kind: (typeof guidanceResourceKinds)[number];
  title: string;
  path: string;
  stages: GuidanceStage[];
  selectWhen: string[];
  links: string[];
};

type Manifest = {
  resources: ManifestResource[];
};

const detectedSelectableShapes = new Set([
  "commented-complex-block",
  "delegation-wrapper",
  "duplicate-block",
  "large-function-like-block",
  "long-parameter-list",
  "many-branches",
  "many-small-delegating-functions",
  "message-chain",
  "missing-linked-tests",
  "nested-conditionals",
  "repeated-lines",
  "repeated-switch-like-branches",
]);

const detectedAuditOnlyShapes = new Set(["large-file", "primitive-type-code"]);

const knownDetectedShapes = new Set([...detectedSelectableShapes, ...detectedAuditOnlyShapes]);

export type SelectedGuidanceResource = {
  resource: ManifestResource;
  role: GuidanceTraceEntry["role"];
  reason: string;
  use: string;
  score: number;
  shapes: string[];
  fullText: boolean;
  text: string;
  contentHash: string;
};

export type GuidanceSelection = {
  detectedShapes: string[];
  selected: GuidanceTraceEntry[];
  resources: SelectedGuidanceResource[];
  audit: GuidanceSelectionAudit;
  prompt: string;
};

type DetectedShape = GuidanceSelectionAudit["detectedShapes"][number];

let cachedManifest: Manifest | null = null;
let cachedResourceRoot: string | null = null;

export async function selectReviewGuidance(
  root: string,
  feature: FeatureRecord,
): Promise<GuidanceSelection> {
  const detectedShapes = await detectOwnedCodeShapes(root, feature);
  const shapes = uniqueShapes(detectedShapes);
  const manifest = await loadManifest();
  const byId = new Map(manifest.resources.map((resource) => [resource.id, resource]));
  const reviewMatches = manifest.resources
    .filter((resource) => resource.stages.includes("review"))
    .flatMap((resource) => matchResource(resource, shapes))
    .toSorted((left, right) => {
      const leftSignal = left.resource.kind === "signal" ? 1 : 0;
      const rightSignal = right.resource.kind === "signal" ? 1 : 0;
      return (
        rightSignal - leftSignal ||
        right.score - left.score ||
        left.resource.title.localeCompare(right.resource.title)
      );
    });
  const signalMatches = reviewMatches
    .filter((match) => match.resource.kind === "signal")
    .slice(0, 6);
  const workflowMatches = reviewMatches.filter((match) => match.resource.kind === "workflow");
  const primaryMatches =
    signalMatches.length > 0 ? signalMatches.slice(0, 2) : workflowMatches.slice(0, 1);

  const primaryIds = new Set(primaryMatches.map((match) => match.resource.id));
  const selectedIds = new Set(primaryIds);
  for (const match of primaryMatches.filter((candidate) => candidate.resource.kind === "signal")) {
    for (const link of match.resource.links.slice(0, 3)) {
      const linked = byId.get(link);
      if (linked !== undefined) {
        selectedIds.add(linked.id);
      }
    }
  }
  for (const match of signalMatches.slice(2, 5)) {
    selectedIds.add(match.resource.id);
  }
  for (const match of workflowMatches.slice(0, 1)) {
    selectedIds.add(match.resource.id);
  }

  const resources: SelectedGuidanceResource[] = [];
  const matchesById = new Map(reviewMatches.map((match) => [match.resource.id, match]));
  for (const id of selectedIds) {
    const resource = byId.get(id);
    if (resource === undefined) {
      continue;
    }
    const match = matchesById.get(id);
    const shapesForResource =
      match?.shapes ?? resource.selectWhen.filter((shape) => shapes.includes(shape));
    const reason =
      shapesForResource.length === 0
        ? `Included because it is linked from selected refactoring signals.`
        : `Selected because owned files show ${shapesForResource.join(", ")}.`;
    const use =
      resource.kind === "signal"
        ? `Use ${resource.title} as a Refactoring Signal: verify evidence, behavior contract, and a small repair path before reporting.`
        : resource.kind === "workflow"
          ? `Use ${resource.title} as a workflow constraint for reporting, fixing, and revalidation.`
          : `Use ${resource.title} as a candidate repair move only when it is the smallest behavior-preserving fit.`;
    const text = await resourceText(resource);
    resources.push({
      resource,
      role: primaryIds.has(id) ? "primary" : "supporting",
      reason,
      use,
      score:
        match?.score ?? shapesForResource.reduce((total, shape) => total + shapeWeight(shape), 0),
      shapes: shapesForResource,
      fullText: primaryIds.has(id),
      text,
      contentHash: hashText(text),
    });
  }

  const ordered = resources
    .toSorted(
      (left, right) =>
        (left.role === "primary" ? 0 : 1) - (right.role === "primary" ? 0 : 1) ||
        Number(right.fullText) - Number(left.fullText) ||
        right.score - left.score ||
        left.resource.title.localeCompare(right.resource.title),
    )
    .slice(0, 5);
  const selected = ordered.map(traceEntryForResource);
  const prompt = guidancePrompt(ordered);
  const selectedSet = new Set(selected.map((entry) => entry.resourceId));
  const rejected = manifest.resources
    .filter((resource) => resource.kind === "signal" && resource.stages.includes("review"))
    .filter((resource) => !selectedSet.has(resource.id))
    .map((resource) => ({
      resourceId: resource.id,
      title: resource.title,
      kind: resource.kind,
      reason:
        resource.selectWhen.length === 0
          ? "Resource has no review selection shapes."
          : `No observed owned-code shape matched ${resource.selectWhen.join(", ")}.`,
    }));
  return {
    detectedShapes: shapes,
    selected,
    resources: ordered,
    audit: {
      featureId: feature.featureId,
      title: feature.title,
      detectedShapes,
      selected,
      rejected,
      promptedResources: ordered.map((selection) => ({
        resourceId: selection.resource.id,
        title: selection.resource.title,
        kind: selection.resource.kind,
        role: selection.role,
        contentHash: selection.contentHash,
        fullText: selection.fullText,
      })),
      promptHash: hashText(prompt),
    },
    prompt,
  };
}

function matchResource(
  resource: ManifestResource,
  shapes: string[],
): Array<{ resource: ManifestResource; shapes: string[]; score: number }> {
  const matched = resource.selectWhen.filter((shape) => shapes.includes(shape));
  if (matched.length === 0) {
    return [];
  }
  return [
    {
      resource,
      shapes: matched,
      score: matched.reduce((total, shape) => total + shapeWeight(shape), 0),
    },
  ];
}

export async function guidanceTextForTrace(
  trace: GuidanceTraceEntry[],
  stage: GuidanceStage,
): Promise<string> {
  if (trace.length === 0) {
    return "No applied refactoring guidance was recorded for this finding.";
  }
  const manifest = await loadManifest();
  const byId = new Map(manifest.resources.map((resource) => [resource.id, resource]));
  const blocks: string[] = [];
  for (const entry of trace) {
    const resource = byId.get(entry.resourceId);
    const body = resource === undefined ? "" : `\nResource text:\n${await resourceText(resource)}`;
    blocks.push(
      [
        `- ${entry.title} (${entry.role}, ${entry.kind}, ${entry.resourceId})`,
        `  why: ${entry.reason}`,
        `  use: ${entry.use}`,
        `  stage: ${stage}`,
        body,
      ].join("\n"),
    );
  }
  return blocks.join("\n\n");
}

export async function reviewGuidanceDryRun(
  root: string,
  features: FeatureRecord[],
): Promise<
  Array<{
    featureId: string;
    title: string;
    detectedShapes: string[];
    selected: GuidanceTraceEntry[];
    audit: GuidanceSelectionAudit;
  }>
> {
  return Promise.all(
    features.map(async (feature) => {
      const selection = await selectReviewGuidance(root, feature);
      return {
        featureId: feature.featureId,
        title: feature.title,
        detectedShapes: selection.detectedShapes,
        selected: selection.selected,
        audit: selection.audit,
      };
    }),
  );
}

function traceEntryForResource(selection: SelectedGuidanceResource): GuidanceTraceEntry {
  return {
    resourceId: selection.resource.id,
    title: selection.resource.title,
    kind: selection.resource.kind,
    role: selection.role,
    reason: selection.reason,
    use: selection.use,
  };
}

function guidancePrompt(resources: SelectedGuidanceResource[]): string {
  if (resources.length === 0) {
    return `Selected refactoring guidance:
- No specific Refactoring Resources were selected. Continue to use codenuke's evidence and behavior-preservation rules.`;
  }
  const cards = resources.map(
    (selection) =>
      `- ${selection.resource.title} (${selection.role}, ${selection.resource.kind}, ${selection.resource.id})
  why selected: ${selection.reason}
  how to use: ${selection.use}
  matched shapes: ${selection.shapes.length === 0 ? "linked resource" : selection.shapes.join(", ")}`,
  );
  const full = resources
    .filter((selection) => selection.fullText)
    .map((selection) => `### ${selection.resource.title}\n${selection.text}`);
  return [
    "Selected refactoring guidance:",
    "- Primary guidance is mandatory for review/fix/revalidation unless explicitly marked not applicable with evidence.",
    "- Supporting guidance is optional context for the smallest behavior-preserving repair.",
    ...cards,
    "",
    "Full guidance for strongest matches:",
    full.length === 0 ? "- none" : full.join("\n\n"),
  ].join("\n");
}

async function detectOwnedCodeShapes(
  root: string,
  feature: FeatureRecord,
): Promise<DetectedShape[]> {
  const byShape = new Map<string, DetectedShape>();
  if (feature.tests.length === 0) {
    byShape.set("missing-linked-tests", {
      shape: "missing-linked-tests",
      path: "__feature_tests__",
      startLine: null,
      endLine: null,
      quote: null,
      metric: "0 linked tests",
    });
  }
  for (const file of feature.ownedFiles.slice(0, 12)) {
    const source = await readFile(join(root, file.path), "utf8").then(
      (value) => value,
      () => "",
    );
    if (source.length === 0) {
      continue;
    }
    for (const evidence of shapesForSource(file.path, source)) {
      const existing = byShape.get(evidence.shape);
      if (existing === undefined || evidenceStrength(evidence) > evidenceStrength(existing)) {
        byShape.set(evidence.shape, evidence);
      }
    }
  }
  return [...byShape.values()].toSorted(
    (left, right) =>
      shapeWeight(right.shape) - shapeWeight(left.shape) || left.shape.localeCompare(right.shape),
  );
}

function shapesForSource(path: string, source: string): DetectedShape[] {
  const shapes: DetectedShape[] = [];
  const lines = source.split(/\r?\n/u);
  if (lines.length > 180) {
    shapes.push(shapeEvidence("large-file", path, 1, lines[0] ?? null, `${lines.length} lines`));
  }
  const functionBlocks = functionLikeBlocks(source);
  const largeBlock = functionBlocks.find((block) => block.lines >= 45);
  if (largeBlock !== undefined) {
    shapes.push(
      shapeEvidence(
        "large-function-like-block",
        path,
        largeBlock.startLine,
        largeBlock.quote,
        `${largeBlock.lines} lines`,
      ),
    );
  }
  const branchyBlock = functionBlocks.find((block) => block.branches >= 6);
  if (branchyBlock !== undefined) {
    shapes.push(
      shapeEvidence(
        "many-branches",
        path,
        branchyBlock.startLine,
        branchyBlock.quote,
        `${branchyBlock.branches} branches`,
      ),
    );
  }
  const nested =
    /(if|else if|for|while|switch)[\s\S]{0,500}(if|else if|for|while|switch)[\s\S]{0,500}(if|else if|for|while|switch)/u.exec(
      source,
    );
  if (nested !== null) {
    shapes.push(shapeEvidenceAtIndex("nested-conditionals", path, source, nested.index, null));
  }
  const longParams = [...source.matchAll(/\([^()]{0,400}\)/gu)].find(
    (match) => match[0].split(",").length >= 5,
  );
  if (longParams !== undefined) {
    shapes.push(
      shapeEvidenceAtIndex(
        "long-parameter-list",
        path,
        source,
        longParams.index,
        `${longParams[0].split(",").length} parameters`,
      ),
    );
  }
  const repeatedLines = repeatedSignificantLineEvidence(path, lines);
  if (repeatedLines.count >= 2) {
    shapes.push({
      ...repeatedLines.evidence,
      shape: "repeated-lines",
      metric: `${repeatedLines.count} repeated significant lines`,
    });
    shapes.push({
      ...repeatedLines.evidence,
      shape: "duplicate-block",
      metric: `${repeatedLines.count} repeated significant lines`,
    });
  }
  const switchMatches = [...source.matchAll(/\b(?:case|elif|else if)\b/gu)];
  if (switchMatches.length >= 5) {
    shapes.push(
      shapeEvidenceAtIndex(
        "repeated-switch-like-branches",
        path,
        source,
        switchMatches[0]?.index ?? 0,
        `${switchMatches.length} switch-like branches`,
      ),
    );
  }
  const messageChain = /(?:\.\w+\([^)]*\)|\.\w+){3,}/u.exec(source);
  if (messageChain !== null) {
    shapes.push(shapeEvidenceAtIndex("message-chain", path, source, messageChain.index, null));
  }
  const delegatingMatches = [...source.matchAll(/return\s+(?:this\.)?\w+\.\w+\([^)]*\);?/gu)];
  if (delegatingMatches.length >= 3) {
    const evidence = shapeEvidenceAtIndex(
      "many-small-delegating-functions",
      path,
      source,
      delegatingMatches[0]?.index ?? 0,
      `${delegatingMatches.length} delegating returns`,
    );
    shapes.push(evidence);
    shapes.push({ ...evidence, shape: "delegation-wrapper" });
  }
  const comment = /[/#]{1,2}\s*(?:TODO|explain|step|phase|first|then|finally)\b/iu.exec(source);
  if (comment !== null) {
    shapes.push(shapeEvidenceAtIndex("commented-complex-block", path, source, comment.index, null));
  }
  const primitive = /\b(?:type|kind|status|mode)\s*[=:]\s*["'][A-Za-z0-9_-]+["']/u.exec(source);
  if (primitive !== null) {
    shapes.push(shapeEvidenceAtIndex("primitive-type-code", path, source, primitive.index, null));
  }
  return shapes;
}

function functionLikeBlocks(
  source: string,
): Array<{ lines: number; branches: number; startLine: number; quote: string | null }> {
  const blocks: Array<{
    lines: number;
    branches: number;
    startLine: number;
    quote: string | null;
  }> = [];
  const regex = /(?:function\s+\w+|(?:async\s+)?\w+\s*\([^)]*\)\s*(?::\s*[^{=]+)?\{|=>\s*\{)/gu;
  for (const match of source.matchAll(regex)) {
    const start = match.index ?? 0;
    const end = balancedBlockEnd(source, source.indexOf("{", start));
    if (end <= start) {
      continue;
    }
    const block = source.slice(start, end);
    blocks.push({
      lines: block.split(/\r?\n/u).length,
      branches: (block.match(/\b(?:if|else if|for|while|switch|case|catch)\b/gu) ?? []).length,
      startLine: lineNumberAt(source, start),
      quote: source
        .slice(start, source.indexOf("\n", start) < 0 ? undefined : source.indexOf("\n", start))
        .trim(),
    });
  }
  return blocks;
}

function balancedBlockEnd(source: string, openIndex: number): number {
  if (openIndex < 0) {
    return -1;
  }
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return source.length;
}

function repeatedSignificantLineEvidence(
  path: string,
  lines: string[],
): { count: number; evidence: DetectedShape } {
  const counts = new Map<string, { count: number; line: number; quote: string }>();
  for (const [index, line] of lines.entries()) {
    const normalized = line.trim().replace(/\s+/gu, " ");
    if (
      normalized.length < 18 ||
      normalized.startsWith("//") ||
      normalized.startsWith("#") ||
      normalized === "}" ||
      normalized === "};"
    ) {
      continue;
    }
    const current = counts.get(normalized);
    counts.set(normalized, {
      count: (current?.count ?? 0) + 1,
      line: current?.line ?? index + 1,
      quote: current?.quote ?? normalized,
    });
  }
  const repeated = [...counts.values()]
    .filter((entry) => entry.count > 1)
    .toSorted((left, right) => right.count - left.count || left.line - right.line);
  const first = repeated[0];
  return {
    count: repeated.length,
    evidence:
      first === undefined
        ? shapeEvidence("repeated-lines", path, null, null, null)
        : shapeEvidence("repeated-lines", path, first.line, first.quote, `${first.count} copies`),
  };
}

function shapeWeight(shape: string): number {
  switch (shape) {
    case "duplicate-block":
    case "repeated-switch-like-branches":
    case "missing-linked-tests":
      return 4;
    case "large-function-like-block":
    case "long-parameter-list":
    case "nested-conditionals":
      return 3;
    case "many-branches":
    case "message-chain":
    case "delegation-wrapper":
      return 2;
    default:
      return 1;
  }
}

function uniqueShapes(detectedShapes: DetectedShape[]): string[] {
  return detectedShapes.map((shape) => shape.shape);
}

function evidenceStrength(evidence: DetectedShape): number {
  const metricValue = Number.parseInt(evidence.metric ?? "0", 10);
  return shapeWeight(evidence.shape) * 1000 + (Number.isNaN(metricValue) ? 0 : metricValue);
}

function shapeEvidence(
  shape: string,
  path: string,
  startLine: number | null,
  quote: string | null,
  metric: string | null,
): DetectedShape {
  return {
    shape,
    path,
    startLine,
    endLine: startLine,
    quote,
    metric,
  };
}

function shapeEvidenceAtIndex(
  shape: string,
  path: string,
  source: string,
  index: number,
  metric: string | null,
): DetectedShape {
  const line = lineNumberAt(source, index);
  return shapeEvidence(shape, path, line, lineAt(source, index), metric);
}

function lineNumberAt(source: string, index: number): number {
  return source.slice(0, index).split(/\r?\n/u).length;
}

function lineAt(source: string, index: number): string | null {
  const start = source.lastIndexOf("\n", index) + 1;
  const end = source.indexOf("\n", index);
  return source.slice(start, end < 0 ? undefined : end).trim() || null;
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function loadManifest(): Promise<Manifest> {
  if (cachedManifest !== null) {
    return cachedManifest;
  }
  const root = await resourceRoot();
  const raw = await readFile(join(root, "manifest.json"), "utf8");
  cachedManifest = JSON.parse(raw) as Manifest;
  validateManifest(cachedManifest);
  return cachedManifest;
}

function validateManifest(manifest: Manifest): void {
  const knownIds = new Set(manifest.resources.map((resource) => resource.id));
  const invalidReferences: string[] = [];
  for (const resource of manifest.resources) {
    for (const shape of resource.selectWhen) {
      if (!detectedSelectableShapes.has(shape)) {
        invalidReferences.push(`${resource.id} selectWhen ${shape}`);
      }
    }
    for (const link of resource.links) {
      if (!knownIds.has(link)) {
        invalidReferences.push(`${resource.id} link ${link}`);
      }
    }
  }
  for (const shape of detectedSelectableShapes) {
    if (!manifest.resources.some((resource) => resource.selectWhen.includes(shape))) {
      invalidReferences.push(`detected selectable shape ${shape} has no manifest resource`);
    }
  }
  for (const shape of detectedAuditOnlyShapes) {
    if (!knownDetectedShapes.has(shape)) {
      invalidReferences.push(`audit-only shape ${shape} is not a known detected shape`);
    }
    if (manifest.resources.some((resource) => resource.selectWhen.includes(shape))) {
      invalidReferences.push(`audit-only shape ${shape} is used as selectable guidance`);
    }
  }
  if (invalidReferences.length > 0) {
    throw new Error(`invalid refactoring resource manifest: ${invalidReferences.join(", ")}`);
  }
}

async function resourceText(resource: ManifestResource): Promise<string> {
  const [path, anchor] = resource.path.split("#");
  const root = await resourceRoot();
  const raw = await readFile(join(root, path ?? ""), "utf8");
  return anchor === undefined ? raw.trim() : sectionForAnchor(raw, anchor).trim();
}

function sectionForAnchor(raw: string, anchor: string): string {
  const lines = raw.split(/\r?\n/u);
  const heading = anchor
    .split("-")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
  const start = lines.findIndex(
    (line) => line.trim().toLowerCase() === `## ${heading}`.toLowerCase(),
  );
  if (start < 0) {
    return raw;
  }
  const end = lines.findIndex((line, index) => index > start && /^##\s+/u.test(line));
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
}

async function resourceRoot(): Promise<string> {
  if (cachedResourceRoot !== null) {
    return cachedResourceRoot;
  }
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(moduleDir, "../../resources/refactoring"),
    resolve(moduleDir, "../resources/refactoring"),
    resolve(process.cwd(), "resources/refactoring"),
  ];
  for (const candidate of candidates) {
    if (await pathExists(join(candidate, "manifest.json"))) {
      cachedResourceRoot = candidate;
      return candidate;
    }
  }
  throw new Error("codenuke refactoring resources not found");
}
