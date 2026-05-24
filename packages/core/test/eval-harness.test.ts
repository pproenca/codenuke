import { describe, expect, it } from "@effect/vitest";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

describe("metric evaluation harness", () => {
  it("reports weighted metric and baseline policy comparisons", () => {
    const out = execFileSync(
      "node",
      [
        resolve(repoRoot, "scripts/metric-eval.mjs"),
        resolve(here, "fixtures/metric-eval-corpus.json"),
      ],
      { encoding: "utf8" },
    );
    const result = JSON.parse(out) as {
      schemaVersion: number;
      candidates: number;
      reports: Array<{ policy: string; retainedReduction: number; revertRate: number | null; lift: number | null }>;
    };
    expect(result.schemaVersion).toBe(1);
    expect(result.candidates).toBe(4);
    expect(result.reports.map((r) => r.policy)).toEqual([
      "weighted-metric",
      "dL-positive",
      "loc-only",
      "tests-pass-only",
      "random",
    ]);
    const weighted = result.reports.find((r) => r.policy === "weighted-metric")!;
    const testsOnly = result.reports.find((r) => r.policy === "tests-pass-only")!;
    expect(weighted.retainedReduction).toBe(40);
    expect(weighted.revertRate).toBe(0);
    expect(testsOnly.revertRate).toBeGreaterThan(0);
  });
});
