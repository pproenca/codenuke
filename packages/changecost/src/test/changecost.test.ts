// Dual-execution + characterization tests for the pure core of loop/changecost.mjs.
import { describe, expect, it } from "vitest";

import { buildImplementerPrompt, costOf, editCost, lcsEditSize, meanChangeCost, tokenize, verifyCost } from "@codenuke/changecost";
import {
  buildImplementerPrompt as lPrompt,
  editCost as lEdit,
  lcsEditSize as lLcs,
  tokenize as lTok,
  verifyCost as lVerify,
} from "../../../../test-fixtures/legacy-loop/changecost.mjs";

describe("tokenize / lcsEditSize / editCost / verifyCost — dual-execution (RULE-012/013)", () => {
  it("tokenize matches legacy", () => {
    const samples: [string, string][] = [
      ["a.ts", "export const x = 1 + 2;"],
      ["b.tsx", "const C = () => <div>{x}</div>;"],
      ["c.ts", "function f(a: number, b: number) { return a && b ? 1 : 0; }"],
    ];
    for (const [n, t] of samples) expect(tokenize(n, t)).toEqual(lTok(n, t));
  });

  it("lcsEditSize matches legacy", () => {
    const cases: [string[], string[]][] = [
      [[], []],
      [["a"], []],
      [[], ["a", "b"]],
      [["a", "b", "c"], ["a", "x", "c"]],
      [["a", "b"], ["a", "b"]],
      [["a", "b", "c", "d"], ["d", "c", "b", "a"]],
    ];
    for (const [a, b] of cases) expect(lcsEditSize(a, b)).toBe(lLcs(a, b));
  });

  it("editCost matches legacy across change scenarios", () => {
    const before = { "src/a.ts": "export const x = 1;", "src/b.ts": "export const y = 2;", "src/a.test.ts": "if (1) {}" };
    const after = { "src/a.ts": "export const x = 1 + 0;", "src/b.ts": "export const y = 2;", "src/c.ts": "export const z = 3;" };
    expect(editCost(before, after, "src")).toEqual(lEdit(before, after, "src"));
    expect(editCost({}, after, "src")).toEqual(lEdit({}, after, "src"));
    expect(editCost(before, {}, ".")).toEqual(lEdit(before, {}, "."));
  });

  it("verifyCost matches legacy", () => {
    const fence = { regions: { a: { p: 0.9 }, b: { p: 0.5 } } };
    expect(verifyCost(["a", "b"], fence)).toBe(lVerify(["a", "b"], fence));
    expect(verifyCost([], fence)).toBe(lVerify([], fence));
    expect(verifyCost(["a", "missing"], fence)).toBe(lVerify(["a", "missing"], fence));
    expect(verifyCost(["a"], null)).toBe(lVerify(["a"], null));
  });

  it("buildImplementerPrompt matches legacy", () => {
    const d = { prompt: "do x", acceptPath: "src/x.accept.test.ts" };
    expect(buildImplementerPrompt(d, "src")).toBe(lPrompt(d, "src"));
  });
});

describe("costOf / meanChangeCost — RULE-011 (cost = tokens + β·verify; 𝒱̂ = mean)", () => {
  it("costOf", () => {
    expect(costOf(10, 0.5, 60)).toBe(40);
    expect(costOf(10, 0.5)).toBe(40); // default β = 60
    expect(costOf(0, 1, 60)).toBe(60);
  });
  it("meanChangeCost", () => {
    expect(meanChangeCost([40, 20, 30])).toBe(30);
    expect(meanChangeCost([])).toBeNull();
  });
});
