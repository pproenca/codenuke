// Characterization + dual-execution tests for legacy/codenuke/loop/guards.mjs.
import { describe, expect, it } from "vitest";

import { finiteNumber } from "../main/guards";
import { finiteNumber as legacyFiniteNumber } from "../../../test-fixtures/legacy-loop/guards.mjs";

describe("finiteNumber", () => {
  it("accepts only real finite numbers", () => {
    expect(finiteNumber(0)).toBe(true);
    expect(finiteNumber(-3.5)).toBe(true);
    expect(finiteNumber(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(finiteNumber(Number.NaN)).toBe(false);
    expect(finiteNumber(Number.POSITIVE_INFINITY)).toBe(false);
    expect(finiteNumber(Number.NEGATIVE_INFINITY)).toBe(false);
    expect(finiteNumber("1")).toBe(false);
    expect(finiteNumber(null)).toBe(false);
    expect(finiteNumber(undefined)).toBe(false);
  });

  it("matches legacy across a broad value set (dual-execution)", () => {
    const cases: unknown[] = [
      0, 1, -1, 3.14, 1e9, -0, Number.MAX_SAFE_INTEGER, Number.MIN_VALUE,
      Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
      "1", "", "abc", null, undefined, {}, [], true, false, 1n,
    ];
    for (const value of cases) {
      expect(finiteNumber(value)).toBe(legacyFiniteNumber(value));
    }
  });
});
