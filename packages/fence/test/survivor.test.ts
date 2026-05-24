import { describe, expect, it } from "@effect/vitest";
import { classify, isCaught, survivesFromTestPassed, tally, type MutantStatus } from "../src/survivor.ts";

describe("RULE-009 survivor classification (only green survives)", () => {
  it("RULE-009 only a green mutant survives; fail and timeout are caught", () => {
    expect(classify("green")).toBe(true); // survives (escaped the fence)
    expect(classify("fail")).toBe(false); // caught
    expect(classify("timeout")).toBe(false); // caught
  });

  it("RULE-009 a missing status defaults to green (conservative survivor)", () => {
    expect(classify(undefined)).toBe(true);
    expect(isCaught(undefined)).toBe(false);
  });

  it("RULE-009 boolean form: a mutant survives iff its tests still passed", () => {
    expect(survivesFromTestPassed(true)).toBe(true);
    expect(survivesFromTestPassed(false)).toBe(false);
  });

  it("RULE-009 tally over [green, fail, timeout, missing] => caught==2, survivors==2, total==4", () => {
    const outcomes: MutantStatus[] = ["green", "fail", "timeout", undefined];
    const { caught, survivors, total } = tally(outcomes);
    expect(caught).toBe(2); // fail + timeout
    expect(survivors).toBe(2); // green + missing-as-green
    expect(total).toBe(4);
  });

  it("RULE-009 isCaught is the complement of classify", () => {
    for (const s of ["green", "fail", "timeout", undefined] as MutantStatus[]) {
      expect(isCaught(s)).toBe(!classify(s));
    }
  });
});
