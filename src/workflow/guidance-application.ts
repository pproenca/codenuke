import { FindingRecord, GuidanceApplication, PatchFailure } from "../platform/types.js";

export function guidanceApplicationFailure(
  finding: FindingRecord,
  application: GuidanceApplication,
): PatchFailure | null {
  const expectedResources = [...new Set(finding.guidance.applied.map((entry) => entry.resourceId))];
  if (expectedResources.length === 0) {
    return null;
  }
  const accountedResources = new Set(
    application.appliedResources.map((resource) => resource.resourceId),
  );
  const notUsedResources = new Set(
    application.appliedResources
      .filter((resource) => resource.action === "not-used")
      .map((resource) => resource.resourceId),
  );
  const missingResources = expectedResources.filter(
    (resourceId) => !accountedResources.has(resourceId),
  );
  const rejectedPrimaryResources = finding.guidance.applied
    .filter((entry) => entry.role === "primary" && notUsedResources.has(entry.resourceId))
    .map((entry) => entry.resourceId);
  if (missingResources.length === 0 && rejectedPrimaryResources.length === 0) {
    return null;
  }
  return {
    code: "guidance-not-accounted",
    message:
      rejectedPrimaryResources.length === 0
        ? "Patch plan did not account for every applied guidance resource."
        : "Patch plan rejected primary guidance for the finding.",
    expectedResources,
    missingResources,
    rejectedPrimaryResources,
  };
}
