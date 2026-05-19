import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FeatureRecord, GuidanceTraceEntry, guidanceResourceKinds } from "../platform/types.js";
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

export type SelectedGuidanceResource = {
  resource: ManifestResource;
  reason: string;
  use: string;
  score: number;
  shapes: string[];
  fullText: boolean;
  text: string;
};

export type GuidanceSelection = {
  detectedShapes: string[];
  selected: GuidanceTraceEntry[];
  resources: SelectedGuidanceResource[];
  prompt: string;
};

let cachedManifest: Manifest | null = null;
let cachedResourceRoot: string | null = null;

export async function selectReviewGuidance(
  root: string,
  feature: FeatureRecord,
): Promise<GuidanceSelection> {
  const shapes = await detectOwnedCodeShapes(root, feature);
  const manifest = await loadManifest();
  const byId = new Map(manifest.resources.map((resource) => [resource.id, resource]));
  const signalMatches = manifest.resources
    .filter((resource) => resource.kind === "signal" && resource.stages.includes("review"))
    .flatMap((resource) => {
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
    })
    .toSorted(
      (left, right) =>
        right.score - left.score || left.resource.title.localeCompare(right.resource.title),
    )
    .slice(0, 6);

  const selectedIds = new Set(signalMatches.map((match) => match.resource.id));
  for (const match of signalMatches.slice(0, 4)) {
    for (const link of match.resource.links.slice(0, 3)) {
      const linked = byId.get(link);
      if (linked !== undefined) {
        selectedIds.add(linked.id);
      }
    }
  }

  const resources: SelectedGuidanceResource[] = [];
  const strongSignals = new Set(signalMatches.slice(0, 3).map((match) => match.resource.id));
  for (const id of selectedIds) {
    const resource = byId.get(id);
    if (resource === undefined) {
      continue;
    }
    const match = signalMatches.find((candidate) => candidate.resource.id === id);
    const shapesForResource =
      match?.shapes ?? resource.selectWhen.filter((shape) => shapes.includes(shape));
    const reason =
      shapesForResource.length === 0
        ? `Included because it is linked from selected refactoring signals.`
        : `Selected because owned files show ${shapesForResource.join(", ")}.`;
    const use =
      resource.kind === "signal"
        ? `Use ${resource.title} as a Refactoring Signal: verify evidence, behavior contract, and a small repair path before reporting.`
        : `Use ${resource.title} as a candidate repair move only when it is the smallest behavior-preserving fit.`;
    resources.push({
      resource,
      reason,
      use,
      score:
        match?.score ?? shapesForResource.reduce((total, shape) => total + shapeWeight(shape), 0),
      shapes: shapesForResource,
      fullText: strongSignals.has(id),
      text: await resourceText(resource),
    });
  }

  const ordered = resources.toSorted(
    (left, right) =>
      Number(right.fullText) - Number(left.fullText) ||
      right.score - left.score ||
      left.resource.title.localeCompare(right.resource.title),
  );
  const selected = ordered.map(traceEntryForResource);
  return {
    detectedShapes: shapes,
    selected,
    resources: ordered,
    prompt: guidancePrompt(ordered),
  };
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
        `- ${entry.title} (${entry.kind}, ${entry.resourceId})`,
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
      };
    }),
  );
}

function traceEntryForResource(selection: SelectedGuidanceResource): GuidanceTraceEntry {
  return {
    resourceId: selection.resource.id,
    title: selection.resource.title,
    kind: selection.resource.kind,
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
      `- ${selection.resource.title} (${selection.resource.kind}, ${selection.resource.id})
  why selected: ${selection.reason}
  how to use: ${selection.use}
  matched shapes: ${selection.shapes.length === 0 ? "linked resource" : selection.shapes.join(", ")}`,
  );
  const full = resources
    .filter((selection) => selection.fullText)
    .map((selection) => `### ${selection.resource.title}\n${selection.text}`);
  return [
    "Selected refactoring guidance:",
    ...cards,
    "",
    "Full guidance for strongest matches:",
    full.length === 0 ? "- none" : full.join("\n\n"),
  ].join("\n");
}

async function detectOwnedCodeShapes(root: string, feature: FeatureRecord): Promise<string[]> {
  const counts = new Map<string, number>();
  for (const file of feature.ownedFiles.slice(0, 12)) {
    const source = await readFile(join(root, file.path), "utf8").then(
      (value) => value,
      () => "",
    );
    if (source.length === 0) {
      continue;
    }
    for (const shape of shapesForSource(source)) {
      counts.set(shape, (counts.get(shape) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([shape]) => shape);
}

function shapesForSource(source: string): string[] {
  const shapes = new Set<string>();
  const lines = source.split(/\r?\n/u);
  if (lines.length > 180) {
    shapes.add("large-file");
  }
  const functionBlocks = functionLikeBlocks(source);
  if (functionBlocks.some((block) => block.lines >= 45)) {
    shapes.add("large-function-like-block");
  }
  if (functionBlocks.some((block) => block.branches >= 6)) {
    shapes.add("many-branches");
  }
  if (
    /(if|else if|for|while|switch)[\s\S]{0,500}(if|else if|for|while|switch)[\s\S]{0,500}(if|else if|for|while|switch)/u.test(
      source,
    )
  ) {
    shapes.add("nested-conditionals");
  }
  if (/\([^()\n,]+,[^()\n,]+,[^()\n,]+,[^()\n,]+(?:,[^()\n,]+)*\)/u.test(source)) {
    shapes.add("long-parameter-list");
  }
  if (repeatedSignificantLines(lines) >= 2) {
    shapes.add("repeated-lines");
    shapes.add("duplicate-block");
  }
  if ((source.match(/\b(?:case|elif|else if)\b/gu) ?? []).length >= 5) {
    shapes.add("repeated-switch-like-branches");
  }
  if (/(?:\.\w+\([^)]*\)|\.\w+){3,}/u.test(source)) {
    shapes.add("message-chain");
  }
  if ((source.match(/return\s+(?:this\.)?\w+\.\w+\([^)]*\);?/gu) ?? []).length >= 3) {
    shapes.add("many-small-delegating-functions");
    shapes.add("delegation-wrapper");
  }
  if (/[/#]{1,2}\s*(?:TODO|explain|step|phase|first|then|finally)\b/iu.test(source)) {
    shapes.add("commented-complex-block");
  }
  if (/\b(?:type|kind|status|mode)\s*[=:]\s*["'][A-Za-z0-9_-]+["']/u.test(source)) {
    shapes.add("primitive-type-code");
  }
  return [...shapes];
}

function functionLikeBlocks(source: string): Array<{ lines: number; branches: number }> {
  const blocks: Array<{ lines: number; branches: number }> = [];
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

function repeatedSignificantLines(lines: string[]): number {
  const counts = new Map<string, number>();
  for (const line of lines) {
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
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return [...counts.values()].filter((count) => count > 1).length;
}

function shapeWeight(shape: string): number {
  switch (shape) {
    case "duplicate-block":
    case "repeated-switch-like-branches":
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

async function loadManifest(): Promise<Manifest> {
  if (cachedManifest !== null) {
    return cachedManifest;
  }
  const root = await resourceRoot();
  const raw = await readFile(join(root, "manifest.json"), "utf8");
  cachedManifest = JSON.parse(raw) as Manifest;
  return cachedManifest;
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
