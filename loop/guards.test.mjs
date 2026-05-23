import { describe, expect, it } from "vitest";
import { finiteNumber } from "./guards.mjs";

describe("validation guards", () => {
  it("accepts only finite numbers", () => {
    expect(finiteNumber(1)).toBe(true);
    expect(finiteNumber(0)).toBe(true);
    expect(finiteNumber(NaN)).toBe(false);
    expect(finiteNumber(Infinity)).toBe(false);
    expect(finiteNumber("1")).toBe(false);
  });
});
