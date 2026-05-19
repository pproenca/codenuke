import { FeatureRecord, FindingRecord } from "../platform/types.js";

const trustedRefactorCategories = new Set<FindingRecord["category"]>([
  "maintainability",
  "performance",
  "test-gap",
]);

export function requiresChangedTestForFix(finding: FindingRecord, feature: FeatureRecord): boolean {
  return trustedRefactorCategories.has(finding.category) && feature.tests.length === 0;
}

export function missingChangedTestMessage(
  finding: FindingRecord,
  feature: FeatureRecord,
  changedFiles: string[],
): string | null {
  if (!requiresChangedTestForFix(finding, feature)) {
    return null;
  }
  if (changedFiles.some(isTestPath)) {
    return null;
  }
  return "Provider did not add or update a test file for an uncovered trusted-refactor finding.";
}

export function isTestPath(path: string): boolean {
  return /(^|\/)(test|tests|__tests__)(\/|$)|(?:^|[._-])(?:test|spec)\.[^/]+$/iu.test(path);
}
