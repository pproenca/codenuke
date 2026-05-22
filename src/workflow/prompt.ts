import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { requiresChangedTestForFix } from "./test-coverage.js";
import { RefactoringOpportunityCandidate } from "./ludicrous.js";
import { CodenukeConfig, FeatureRecord, FindingRecord, ProjectRecord } from "../platform/types.js";

export function buildAgentMapPrompt(project: ProjectRecord, inventory: unknown): string {
  return `You are mapping a repository into semantic codenuke review slices.

Return strict JSON only. No markdown fences.

Goal:
- split the repository into coherent packages/features that should be reviewed together
- prefer many bounded review units over one giant bucket
- use tests and context files to explain intent
- do not invent paths; use only paths from the inventory
- do not own generated, vendored, lock, build, or dependency-cache files

Good review slices include:
- packages, apps, CLI commands, services, routes, jobs, UI flows
- native app targets, test suites, infra/config, shared libraries

For each feature:
- ownedFiles are the primary files to review
- contextFiles are tests, docs, schemas, config, generated interfaces, or nearby dependencies
- tests are executable or likely test files for this slice
- reason explains why this group belongs together
- confidence reflects how certain the grouping is

Project:
${JSON.stringify({ name: project.name, detected: project.detected }, null, 2)}

Repository inventory:
${JSON.stringify(inventory, null, 2)}

JSON shape:
{
  "features": [
    {
      "title": "string",
      "summary": "string",
      "kind": "cli-command|route|ui-flow|service|job|agent-tool|library|config|release|test-suite|infra|unknown",
      "confidence": "high|medium|low",
      "entrypoints": [{"path":"string","symbol":null,"route":null,"command":null}],
      "ownedFiles": [{"path":"string","reason":"string"}],
      "contextFiles": [{"path":"string","reason":"string"}],
      "tests": [{"path":"string","command":null}],
      "tags": ["string"],
      "trustBoundaries": ["user-input|network|filesystem|secrets|process-exec|database|auth|permissions|concurrency|external-api|serialization"],
      "reason": "string"
    }
  ],
  "notes": ["string"]
}`;
}

export async function buildReviewPrompt(
  root: string,
  project: ProjectRecord,
  feature: FeatureRecord,
  config: CodenukeConfig,
): Promise<string> {
  return (await buildReviewPromptWithCandidates(root, project, feature, config)).prompt;
}

export async function buildReviewPromptWithCandidates(
  root: string,
  project: ProjectRecord,
  feature: FeatureRecord,
  config: CodenukeConfig,
  options: { ludicrousCandidates?: RefactoringOpportunityCandidate[] } = {},
): Promise<{ prompt: string }> {
  const ludicrousCandidates = options.ludicrousCandidates ?? [];
  const ludicrousPaths = ludicrousCandidates.flatMap((candidate) =>
    candidate.files.map((file) => file.path),
  );
  const owned = feature.ownedFiles.slice(0, config.review.maxOwnedFiles);
  const context = feature.contextFiles.slice(0, config.review.maxContextFiles);
  const tests = feature.tests.slice(0, config.review.maxContextFiles);
  const fileBlocks = await fileBlocksForPaths(
    root,
    uniquePaths(
      owned.map((ref) => ref.path),
      context.map((ref) => ref.path),
      tests.map((test) => test.path),
      ludicrousPaths,
    ),
  );
  const prompt = `You are reviewing one semantic feature for codenuke.

Return strict JSON only. No markdown fences.

Mission:
- Find behavior-preserving refactoring opportunities that reduce the amount of code.
- Do not hunt for bugs. Report only code-reduction findings where the included code proves
  structural friction and a smaller target shape.
- Refactoring means improving code structure while preserving behavior so future change becomes
  cheaper, safer, and clearer.
- Prefer findings that can be migrated in slices, validated at boundaries, and finished by deleting
  the old shape.

Project:
${JSON.stringify({ name: project.name, detected: project.detected }, null, 2)}

Feature:
${JSON.stringify(feature, null, 2)}

Code-reduction targets:
- duplicated behavior, repeated conditionals, and copy-pasted policy
- dead scaffolding, obsolete compatibility paths, or unused indirection
- pass-through layers, middle-men, wrappers, or adapters that no longer isolate real variation
- split concepts where one conceptual change forces edits across unrelated files
- test/setup friction that makes behavior preservation harder than the code change itself

Finding bar:
- A valid finding must point to code that can be deleted, merged, or made more local while preserving
  behavior.
- Do not report cosmetic cleanup, style-only preferences, renames, formatting, or abstraction churn.
- Defect discovery is out of scope; use any defect-like evidence only to justify a
  behavior-preserving code-reduction refactor.
- Future-change claims must name the change scenario. "Cleaner" is not enough.
- Define current cost and target cost in terms of locality, touched graph, verification cost, blast
  radius, coordination, reversibility, cycle time, or rework risk.
- Treat scanner-style complexity patterns as leads, not proof.
- Evidence must show why less code is possible and what behavior boundary protects the refactor.

Large-refactor loop:
- Name systemic friction.
- Map the current shape.
- Choose a smaller target shape.
- Protect behavior at boundaries.
- Migrate in slices.
- Delete the old shape.
- Rebalance.
- Repeat only if another measured code-reduction scenario remains.

${ludicrousCandidatePrompt(ludicrousCandidates)}

Inspect owned files, context files, and linked tests. Treat included tests as first-class
evidence of intended behavior. If tests contradict a possible refactor, skip it or downgrade
confidence and explain the uncertainty. Deduplicate sibling/root-cause signals: when the same
structural friction appears in multiple owned files, emit one finding with multiple evidence refs
instead of separate one-off findings.

Avoid speculative low-evidence findings. Evidence must point at included files. Use category
"maintainability" for code-reduction findings and include a concrete changeScenario.

JSON shape:
{
  "findings": [
    {
      "title": "string",
      "category": "maintainability",
      "severity": "critical|high|medium|low",
      "confidence": "high|medium|low",
      "evidence": [{"path":"string","startLine":1,"endLine":1,"symbol":null,"quote":null}],
      "reasoning": "string",
      "reproduction": null,
      "recommendation": "string",
      "changeScenario": {
        "futureChange": "defined class of future change",
        "currentCost": "what that change requires today",
        "targetCost": "what that change should require after the refactor",
        "behaviorInvariant": "what must remain unchanged",
        "evidence": ["how included code proves the current cost and target"],
        "costDimensions": ["change-amplification|cognitive-load|coupling|verification-cost|blast-radius|coordination|reversibility|cycle-time|rework-risk"]
      }
    }
  ],
  "inspected": {"files":["string"],"symbols":["string"],"notes":["string"]}
}

Files:
${fileBlocks.join("\n\n")}`;
  return { prompt };
}

function ludicrousCandidatePrompt(candidates: RefactoringOpportunityCandidate[]): string {
  if (candidates.length === 0) {
    return "";
  }
  return `Ludicrous Review Mode:
- The following are high-recall Refactoring Opportunity Candidates, not findings.
- Use them only as leads while inspecting related files.
- Do not report a finding unless included code proves a bounded, evidence-backed refactor path.
- Prefer one root-cause finding over many small sibling findings when the candidate is real.

${JSON.stringify(
  candidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    title: candidate.title,
    source: candidate.source,
    score: Number(candidate.score.toFixed(2)),
    signals: candidate.signals,
    audit: candidate.audit,
    files: candidate.files,
    summary: candidate.summary,
  })),
  null,
  2,
)}`;
}

export async function buildRevalidatePrompt(root: string, findingJson: string): Promise<string> {
  return `Revalidate this codenuke refactoring finding against the current repository at ${root}.

Check whether the original evidence paths/lines still exist. If evidence moved or changed,
decide whether the code-reduction opportunity is fixed, stale/false-positive, still open elsewhere,
or uncertain. Use tests and current code as evidence; do not assume a missing line means fixed. A
finding may be marked fixed only when the old shape is gone, behavior is still protected, and
validation supports the result.

Return strict JSON only:
{"outcome":"fixed|open|false-positive|uncertain","reasoning":"string","commands":["string"]}

Finding:
${findingJson}`;
}

export async function buildFixPrompt(
  root: string,
  finding: FindingRecord,
  feature: FeatureRecord,
  config: CodenukeConfig,
): Promise<string> {
  const fileBlocks = await fileBlocksForPaths(root, fixPromptPaths(finding, feature, config));
  const testRequirement = requiresChangedTestForFix(finding, feature)
    ? `\nTDD requirement:\n- This finding has no linked feature tests.\n- Add or update a focused behavior test before changing production code.\n- The fix will be rejected unless the patch changes at least one test file.\n`
    : "";
  return `You are codenuke applying one behavior-preserving refactor in the current repository.

Apply only the finding below. The goal is less code with the same behavior, not a bug hunt. Keep the
patch as small as the refactor allows.
For larger refactors: name systemic friction, map the current shape, choose a smaller target shape,
protect behavior at boundaries, migrate in slices, delete the old shape, rebalance, and stop.
Use tests or existing executable checks to protect behavior before and after the structural change.
Do not commit, push, switch branches, or run destructive git commands.
After editing, return strict JSON only:
{
  "summary": "string",
  "findingIds": ["string"],
  "plannedFiles": ["string"],
  "risk": "low|medium|high",
  "steps": ["string"],
  "validationCommands": ["string"]
}

${testRequirement}
Finding:
${JSON.stringify(finding, null, 2)}

Feature:
${JSON.stringify(feature, null, 2)}

Relevant files:
${fileBlocks.join("\n\n")}`;
}

function fixPromptPaths(
  finding: FindingRecord,
  feature: FeatureRecord,
  config: CodenukeConfig,
): string[] {
  const owned = feature.ownedFiles.slice(0, config.review.maxOwnedFiles);
  const context = feature.contextFiles.slice(0, config.review.maxContextFiles);
  const tests = feature.tests.slice(0, config.review.maxContextFiles);
  const allowed = new Set([
    ...feature.ownedFiles.map((ref) => ref.path),
    ...feature.contextFiles.map((ref) => ref.path),
    ...feature.tests.map((test) => test.path),
    ...feature.entrypoints.map((entrypoint) => entrypoint.path),
  ]);
  return uniquePaths(
    finding.evidence.flatMap((evidence) => (allowed.has(evidence.path) ? [evidence.path] : [])),
    owned.map((ref) => ref.path),
    context.map((ref) => ref.path),
    tests.map((test) => test.path),
  );
}

function uniquePaths(...groups: Array<Iterable<string>>): string[] {
  const paths = new Set<string>();
  for (const group of groups) {
    for (const path of group) {
      paths.add(path);
    }
  }
  return [...paths];
}

async function fileBlocksForPaths(root: string, paths: string[]): Promise<string[]> {
  if (paths.length === 0) {
    return [];
  }
  const realRoot = await realpath(root).then(
    (value) => value,
    () => root,
  );
  return Promise.all(paths.map((path) => fileBlock(root, realRoot, path)));
}

async function fileBlock(root: string, realRoot: string, path: string): Promise<string> {
  const full = resolve(root, path);
  if (!isInside(root, full)) {
    return `--- ${path}\n[skipped: path escapes repository root]`;
  }
  const realFull = await realpath(full).then(
    (value) => value,
    () => full,
  );
  if (!isInside(realRoot, realFull)) {
    return `--- ${path}\n[skipped: path escapes repository root]`;
  }
  const contents = await readFile(full, "utf8").then(
    (value) => value,
    () => "[unreadable]",
  );
  const trimmed =
    contents.length > 24_000 ? `${contents.slice(0, 24_000)}\n...[truncated]` : contents;
  return `--- ${path}\n${trimmed}`;
}

function isInside(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}
