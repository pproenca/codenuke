import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { requiresChangedTestForFix } from "./test-coverage.js";
import { selectReviewGuidance, guidanceTextForTrace, GuidanceSelection } from "./guidance.js";
import { RefactoringOpportunityCandidate } from "./ludicrous.js";
import {
  CodenukeConfig,
  FeatureRecord,
  FindingRecord,
  GuidanceTraceEntry,
  ProjectRecord,
} from "../platform/types.js";

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
  return (await buildReviewPromptWithGuidance(root, project, feature, config)).prompt;
}

export async function buildReviewPromptWithGuidance(
  root: string,
  project: ProjectRecord,
  feature: FeatureRecord,
  config: CodenukeConfig,
  options: { ludicrousCandidates?: RefactoringOpportunityCandidate[] } = {},
): Promise<{ prompt: string; guidance: GuidanceSelection }> {
  const guidance = await selectReviewGuidance(root, feature);
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
- Identify bounded, evidence-backed refactoring findings for simplification and complexity
  reduction.
- Prefer findings that can be fixed with a small behavior-preserving patch and validated with
  existing or focused tests.
- Ignore unrelated concerns unless they directly block validating the refactor.

Project:
${JSON.stringify({ name: project.name, detected: project.detected }, null, 2)}

Feature:
${JSON.stringify(feature, null, 2)}

Review categories:
- algorithmic or render-path complexity
- behavior-preserving simplification
- trusted-refactor test gaps
- build/release hazards that block validation

Codenuke focus:
- Report algorithmic or render-path complexity under "performance". Strong examples include nested
  lookup loops, repeated membership checks inside loops, sorting inside loops, pairwise comparisons
  that can use sorting/sweep-line/indexing, N+1 database/API/file calls, and repeated expensive
  derived work during render.
- Report behavior-preserving reductions under "maintainability" only when the reduction is
  specific and low-risk: dead code, duplicate code/state, derived state stored unnecessarily,
  unnecessary effect flows, over-abstraction, redundant prop surfaces, unused dependencies, or
  redundant types.
- Treat scanner-style complexity patterns as leads, not proof. Do not report a finding unless the
  path is plausibly hot or large-input, the behavior contract is visible, and the suggested change
  preserves ordering, duplicates, key equality, mutation/identity, cache invalidation, permissions,
  pagination, and error behavior where relevant.
- Treat selected Refactoring Resources as tools for judgment, not automatic findings. If a selected
  signal does not apply after inspecting the code, do not report it.
- For each finding, return guidance.applied entries that explain which selected resources actually
  shaped the finding and how to use them during fix/revalidation. Do not return bare citations.

${guidance.prompt}

${ludicrousCandidatePrompt(ludicrousCandidates)}

Inspect owned files, context files, and linked tests. Treat included tests as first-class
evidence of intended behavior. If tests contradict a possible refactor, either skip it or
downgrade confidence and explain the uncertainty. Deduplicate sibling/root-cause refactoring
signals: when the same pattern appears in multiple owned files, emit one finding with multiple
evidence refs instead of separate one-off findings.

Avoid speculative low-evidence findings. Evidence must point at included files.

JSON shape:
{
  "findings": [
    {
      "title": "string",
      "category": "performance|maintainability|test-gap|build-release",
      "severity": "critical|high|medium|low",
      "confidence": "high|medium|low",
      "evidence": [{"path":"string","startLine":1,"endLine":1,"symbol":null,"quote":null}],
      "reasoning": "string",
      "reproduction": null,
      "recommendation": "string",
      "whyTestsDoNotAlreadyCoverThis": "string",
      "suggestedRegressionTest": "string or null",
      "minimumFixScope": "string",
      "candidateTrace": [
        {
          "candidateId": "string",
          "source": "lexical-phrase|tfidf-file-similarity",
          "title": "string",
          "reason": "how this candidate shaped the finding, or why it was only supporting evidence",
          "use": "how fix and revalidation should account for this candidate"
        }
      ],
      "guidance": {
        "applied": [
          {
            "resourceId": "string",
            "title": "string",
            "kind": "signal|technique|workflow",
            "role": "primary|supporting",
            "reason": "why this resource applies to this finding",
            "use": "how fix and revalidation should use this resource"
          }
        ]
      }
    }
  ],
  "inspected": {"files":["string"],"symbols":["string"],"notes":["string"]}
}

Files:
${fileBlocks.join("\n\n")}`;
  return { prompt, guidance };
}

function ludicrousCandidatePrompt(candidates: RefactoringOpportunityCandidate[]): string {
  if (candidates.length === 0) {
    return "";
  }
  return `Ludicrous Review Mode:
- The following are high-recall Refactoring Opportunity Candidates, not findings.
- Use them to inspect related files and look for larger behavior-preserving refactors.
- Do not report a finding unless included code proves a bounded, evidence-backed repair path.
- Prefer one root-cause finding over many small sibling findings when the candidate is real.
- If a candidate shaped a finding, include its candidateId in that finding's candidateTrace.

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
  const finding = JSON.parse(findingJson) as { guidance?: { applied?: GuidanceTraceEntry[] } };
  const guidance = await guidanceTextForTrace(finding.guidance?.applied ?? [], "revalidate");
  return `Revalidate this codenuke finding against the current repository at ${root}.

Check whether the original evidence paths/lines still exist. If evidence moved or changed,
decide whether the issue is fixed, stale/false-positive, still open elsewhere, or uncertain.
Use tests and current code as evidence; do not assume a missing line means fixed. For complexity
or simplification findings, confirm both that the original simplification opportunity is gone and
that the replacement preserves the behavior contract visible in tests and context files.
Also assess whether the applied guidance trace was followed appropriately. Primary guidance is
mandatory unless the current code makes it not applicable; supporting guidance is optional context.
A finding may be marked fixed only when the original issue is resolved, visible behavior is
preserved, and the guidance fit is acceptable. If the code removed the symptom but violated the
primary guidance intent, return uncertain.

Return strict JSON only:
{"outcome":"fixed|open|false-positive|uncertain","reasoning":"string","guidanceAssessment":{"followed":"yes|partially|no|not-applicable","reasoning":"string","deviations":["string"],"acceptable":true},"commands":["string"]}

Applied guidance:
${guidance}

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
  const guidance = await guidanceTextForTrace(finding.guidance.applied, "fix");
  const testRequirement = requiresChangedTestForFix(finding, feature)
    ? `\nTDD requirement:\n- This is a trusted-refactor finding with no linked feature tests.\n- Add or update a focused behavior test before changing production code.\n- The fix will be rejected unless the patch changes at least one test file.\n`
    : "";
  return `You are codenuke applying one small simplification or complexity repair in the current repository.

Fix only the finding below. Keep the patch minimal and behavior-preserving. Prefer removing code,
collapsing duplication, simplifying data flow, or improving algorithmic complexity over broad
rewrites. Add or update focused tests when feasible.
Apply the finding's guidance trace. Primary guidance is mandatory unless the current code makes it
not applicable; supporting guidance is optional context for the smallest safe move. If a listed
technique is too broad for the current code, choose the smallest safer behavior-preserving move and
explain why in guidanceApplication. Do not switch to a larger technique unless the finding's
evidence requires it.
Use a red-green-refactor loop for behavior-preserving refactors: prove the intended behavior with
the smallest focused test, make the minimal production change, then run validation.
Do not commit, push, switch branches, or run destructive git commands.
After editing, return strict JSON only:
{
  "summary": "string",
  "findingIds": ["string"],
  "plannedFiles": ["string"],
  "risk": "low|medium|high",
  "steps": ["string"],
  "guidanceApplication": {
    "appliedResources": [
      {
        "resourceId": "string",
        "action": "applied|adapted|not-used",
        "reasoning": "string"
      }
    ],
    "deviations": ["string"],
    "risk": "low|medium|high"
  },
  "validationCommands": ["string"]
}

${testRequirement}
Applied guidance:
${guidance}

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
