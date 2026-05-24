import {
  applyMutant,
  collectSites,
  isAdmissible,
  mulberry32,
  sampleSites,
  shuffle,
} from "@codenuke/fence";
// Characterization tests for the pure fence mutation core (loop/fence.mjs is a CLI
// script with no exports; values reasoned from its logic). The audit/replay loops
// that spawn the test suite per mutant are engine-level orchestration.
import { describe, expect, it } from "vitest";

describe("collectSites — mutation operators (RULE-007)", () => {
  it("flips relational/equality/logical operators", () => {
    const sites = collectSites("a.ts", "const r = a < b && c === d || e >= f;");
    const ops = sites.map((s) => s.op).toSorted();
    expect(ops).toContain("<→>");
    expect(ops).toContain("===→!==");
    expect(ops).toContain("&&→||");
    expect(ops).toContain(">=→<=");
  });

  it("swaps startsWith ↔ endsWith and flips return true/false", () => {
    const sites = collectSites(
      "a.ts",
      "function f(s: string) { if (s.startsWith('x')) return true; return false; }",
    );
    const ops = sites.map((s) => s.op);
    expect(ops).toContain("startsWith→endsWith");
    expect(ops).toContain("true→false");
    expect(ops).toContain("false→true");
  });

  it("does not mutate string literals or unrelated tokens", () => {
    const sites = collectSites("a.ts", "const s = 'a < b'; const n = 1 + 2;");
    expect(sites).toEqual([]);
  });

  it("parses JSX source files with JSX script kind", () => {
    const text = "export const C = ({a, b}) => <div>{a < b ? a : b}</div>;";
    const sites = collectSites("component.jsx", text);
    const site = sites.find((s) => s.op === "<→>");

    expect(site).toBeDefined();
    expect(applyMutant(text, site!)).toContain("a > b");
  });
});

describe("applyMutant", () => {
  it("replaces exactly the site span", () => {
    const text = "return a < b;";
    const site = collectSites("a.ts", text).find((s) => s.op === "<→>")!;
    expect(applyMutant(text, site)).toBe("return a > b;");
  });
});

describe("mulberry32 / shuffle / sampleSites — deterministic sampling (RULE-008)", () => {
  it("same seed yields the same stream", () => {
    const a = mulberry32(1337);
    const b = mulberry32(1337);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("sampleSites is deterministic and capped", () => {
    const sites = collectSites("a.ts", "const r = a < b && c === d || e >= f || g !== h;");
    const first = sampleSites(sites, 3, 1337);
    const second = sampleSites(sites, 3, 1337);
    expect(first).toEqual(second);
    expect(first.length).toBe(3);
    // a different seed generally reorders the sample
    expect(sampleSites(sites, sites.length, 1).map((s) => s.op)).not.toEqual(
      sampleSites(sites, sites.length, 999).map((s) => s.op),
    );
  });

  it("shuffle preserves the multiset", () => {
    const arr = [1, 2, 3, 4, 5];
    const shuffled = shuffle([...arr], mulberry32(42));
    expect(shuffled.toSorted((x, y) => x - y)).toEqual(arr);
  });
});

describe("isAdmissible — Wilson bar (RULE-006)", () => {
  it("requires >= 35/35 all-caught mutants to admit at 0.90", () => {
    expect(isAdmissible(34, 34, 0.9)).toBe(false);
    expect(isAdmissible(35, 35, 0.9)).toBe(true);
  });
  it("an unmeasured region (n=0) is never admissible", () => {
    expect(isAdmissible(0, 0, 0.9)).toBe(false);
  });
});
