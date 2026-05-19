import type { FeatureRecord } from "../platform/types.js";

export function stableFeatureJson(feature: FeatureRecord): string {
  const {
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    lock: _lock,
    analysisHistory: _analysisHistory,
    ...stable
  } = feature;
  return JSON.stringify(stable);
}
