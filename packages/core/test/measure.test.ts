import { describe, expect, it } from "@effect/vitest";
import {
  isSourceFile,
  isTestFile,
  measureFiles,
  measureText,
} from "../src/measure/index.ts";
import * as measureMod from "../src/measure/index.ts";

/**
 * RULE-003/004/005 — measurement via the TS compiler API, implemented for real
 * (Slice 0). Assertions are RELATIVE/structural where exact AST node counts would
 * be brittle, but each pins the rule's stated THEN.
 */

describe("RULE-003 size metric L (AST node count)", () => {
  it("RULE-003 whitespace-only reformatting leaves L unchanged", () => {
    const compact = "function f(){return 1}";
    const reformatted = "function f() {\n  return 1\n}";
    expect(measureText(compact).L).toBe(measureText(reformatted).L);
    expect(measureText(compact).L).toBeGreaterThan(0);
  });

  it("RULE-003 deleting a statement decreases L", () => {
    const two = "const a = 1;\nconst b = 2;\n";
    const one = "const a = 1;\n";
    expect(measureText(two).L).toBeGreaterThan(measureText(one).L);
  });

  it("RULE-003 test files contribute 0", () => {
    const code = "const a = 1;\nconst b = 2;\n";
    expect(measureFiles({ "a.test.ts": code }).L).toBe(0);
    expect(measureFiles({ "x.ts": code }).L).toBeGreaterThan(0);
  });
});

describe("RULE-004 cyclomatic complexity", () => {
  it("RULE-004 no decision points → complexity 1", () => {
    expect(measureText("const x = 1;\n").complexity).toBe(1);
  });

  it("RULE-004 if + && → 1 + 2 == 3", () => {
    const src = "function f(a,b){ if (a && b) { return 1 } return 0 }";
    expect(measureText(src).complexity).toBe(3);
  });

  it("RULE-004 nullish-coalescing `??` is counted (+1); optional-chaining `?.` is not", () => {
    expect(measureText("const y = a ?? b;\n").complexity).toBe(2);
    expect(measureText("const y = a?.b;\n").complexity).toBe(1);
  });

  it("RULE-004 each `case` clause counts (+1); `default` does not", () => {
    const src = "switch (x) { case 1: break; case 2: break; default: break; }";
    expect(measureText(src).complexity).toBe(3); // 1 + two case clauses
  });
});

describe("RULE-005 duplicate-window mass", () => {
  it("RULE-005 no repetition → 0", () => {
    expect(measureText("const x = 1;\n").dupMass).toBe(0);
  });

  it("RULE-005 a repeated ≥12-token, ≥5-distinct-content block adds copies beyond the first", () => {
    // Two identical statement blocks, each well over 12 tokens with >=5 distinct
    // identifiers — the second copy contributes to the duplicate mass.
    const block = "const alpha = beta + gamma * delta - epsilon / zeta;\n";
    const once = measureText(block);
    const twice = measureText(block + block);
    expect(once.dupMass).toBe(0);
    expect(twice.dupMass).toBeGreaterThanOrEqual(1);
  });
});

describe("RULE-016/017 retired surface (confirmation)", () => {
  it("RULE-016 measure surface exports no probe subsystem (runProbes/scoreControl/transpile)", () => {
    const keys = Object.keys(measureMod);
    expect(keys).not.toContain("runProbes");
    expect(keys).not.toContain("scoreControl");
    expect(keys).not.toContain("transpile");
  });

  it("RULE-017 measure surface exposes only the live quantities (no any/cloneSites/dupRate/kappa)", () => {
    const m = measureText("const a = 1;\n");
    expect(Object.keys(m).sort()).toEqual(["L", "complexity", "dupMass"]);
  });
});

describe("RULE-033 source/test classification helpers", () => {
  it("RULE-033 isSourceFile accepts source extensions and rejects tests", () => {
    expect(isSourceFile("src/a.ts")).toBe(true);
    expect(isSourceFile("src/a.tsx")).toBe(true);
    expect(isSourceFile("src/a.mjs")).toBe(true);
    expect(isSourceFile("a.test.ts")).toBe(false);
    expect(isSourceFile("__tests__/a.ts")).toBe(false);
    expect(isSourceFile("README.md")).toBe(false);
    expect(isTestFile("a.spec.tsx")).toBe(true);
  });
});
