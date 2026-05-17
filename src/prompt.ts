import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { requiresChangedTestForFix } from "./test-coverage.js";
import { CodenukeConfig, FeatureRecord, FindingRecord, ProjectRecord } from "./types.js";

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
  const owned = feature.ownedFiles.slice(0, config.review.maxOwnedFiles);
  const context = feature.contextFiles.slice(0, config.review.maxContextFiles);
  const tests = feature.tests.slice(0, config.review.maxContextFiles);
  const paths: string[] = [];
  const push = (path: string): void => {
    if (!paths.includes(path)) {
      paths.push(path);
    }
  };
  for (const ref of owned) {
    push(ref.path);
  }
  for (const ref of context) {
    push(ref.path);
  }
  for (const test of tests) {
    push(test.path);
  }
  const fileBlocks: string[] = [];
  for (const path of paths) {
    fileBlocks.push(await fileBlock(root, path));
  }
  return `You are reviewing one semantic feature for codenuke.

Return strict JSON only. No markdown fences.

Mission:
- codenuke's primary mission is reliable, trusted refactoring.
- Find behavior-preserving opportunities to reduce algorithmic complexity, code volume, duplicated
  structure, derived state, and accidental abstraction.
- Report correctness, security, data-loss, or concurrency bugs only when they are directly
  evidenced, material, and relevant to safely changing or trusting this feature.
- Do not turn this review into a broad bug hunt or style review.

Project:
${JSON.stringify({ name: project.name, detected: project.detected }, null, 2)}

Feature:
${JSON.stringify(feature, null, 2)}

Review categories:
- algorithmic or render-path complexity
- behavior-preserving simplification
- trusted-refactor test gaps
- build/release hazards that block validation
- correctness bugs with concrete evidence
- security issues
- race/concurrency bugs
- data loss/corruption
- resource leaks
- bad error handling
- permission/auth gaps
- API contract mismatches
- missing/weak tests
- release/build hazards
- maintainability risks with concrete impact

Codenuke focus:
- Prioritize concrete simplification and complexity-reduction findings over bugfixing.
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

Inspect owned files, context files, and linked tests. Treat included tests as first-class
evidence of intended behavior. If tests contradict a suspected issue, either skip it or
downgrade confidence and explain the uncertainty. Avoid reporting behavior as a bug
solely because a helper name implies a broader contract. Deduplicate sibling/root-cause
issues: when the same pattern appears in multiple owned files, emit one finding with
multiple evidence refs instead of separate one-off findings.

Avoid speculative low-evidence findings. Evidence must point at included files.

JSON shape:
{
  "findings": [
    {
      "title": "string",
      "category": "bug|security|performance|concurrency|api-contract|data-loss|test-gap|docs-gap|build-release|maintainability",
      "severity": "critical|high|medium|low",
      "confidence": "high|medium|low",
      "evidence": [{"path":"string","startLine":1,"endLine":1,"symbol":null,"quote":null}],
      "reasoning": "string",
      "reproduction": null,
      "recommendation": "string",
      "whyTestsDoNotAlreadyCoverThis": "string",
      "suggestedRegressionTest": "string or null",
      "minimumFixScope": "string"
    }
  ],
  "inspected": {"files":["string"],"symbols":["string"],"notes":["string"]}
}

Files:
${fileBlocks.join("\n\n")}`;
}

export async function buildRevalidatePrompt(root: string, findingJson: string): Promise<string> {
  return `Revalidate this codenuke finding against the current repository at ${root}.

Check whether the original evidence paths/lines still exist. If evidence moved or changed,
decide whether the issue is fixed, stale/false-positive, still open elsewhere, or uncertain.
Use tests and current code as evidence; do not assume a missing line means fixed. For complexity
or simplification findings, confirm both that the original simplification opportunity is gone and
that the replacement preserves the behavior contract visible in tests and context files.

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
  const fileBlocks: string[] = [];
  for (const path of fixPromptPaths(finding, feature, config)) {
    fileBlocks.push(await fileBlock(root, path));
  }
  const testRequirement = requiresChangedTestForFix(finding, feature)
    ? `\nTDD requirement:\n- This is a trusted-refactor finding with no linked feature tests.\n- Add or update a focused behavior test before changing production code.\n- The fix will be rejected unless the patch changes at least one test file.\n`
    : "";
  return `You are codenuke applying one small simplification or complexity repair in the current repository.

Fix only the finding below. Keep the patch minimal and behavior-preserving. Prefer removing code,
collapsing duplication, simplifying data flow, or improving algorithmic complexity over broad
rewrites. Add or update focused tests when feasible.
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
  const paths: string[] = [];
  const owned = feature.ownedFiles.slice(0, config.review.maxOwnedFiles);
  const context = feature.contextFiles.slice(0, config.review.maxContextFiles);
  const tests = feature.tests.slice(0, config.review.maxContextFiles);
  const allowed = new Set([
    ...feature.ownedFiles.map((ref) => ref.path),
    ...feature.contextFiles.map((ref) => ref.path),
    ...feature.tests.map((test) => test.path),
    ...feature.entrypoints.map((entrypoint) => entrypoint.path),
  ]);
  const push = (path: string): void => {
    if (!paths.includes(path)) {
      paths.push(path);
    }
  };
  for (const evidence of finding.evidence) {
    if (allowed.has(evidence.path)) {
      push(evidence.path);
    }
  }
  for (const ref of owned) {
    push(ref.path);
  }
  for (const ref of context) {
    push(ref.path);
  }
  for (const test of tests) {
    push(test.path);
  }
  return paths;
}

async function fileBlock(root: string, path: string): Promise<string> {
  const full = resolve(root, path);
  if (!isInside(root, full)) {
    return `--- ${path}\n[skipped: path escapes repository root]`;
  }
  const realRoot = await realpath(root).catch(() => root);
  const realFull = await realpath(full).catch(() => full);
  if (!isInside(realRoot, realFull)) {
    return `--- ${path}\n[skipped: path escapes repository root]`;
  }
  const contents = await readFile(full, "utf8").catch(() => "[unreadable]");
  const trimmed =
    contents.length > 24_000 ? `${contents.slice(0, 24_000)}\n...[truncated]` : contents;
  return `--- ${path}\n${trimmed}`;
}

function isInside(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}
