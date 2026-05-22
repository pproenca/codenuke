import { describe, expect, it } from "vitest";
import { tokenize, lcsEditSize, editCost, verifyCost } from "./lib.mjs";

describe("tokenize — formatting & comment invariant (METRIC.md P1)", () => {
  it("ignores whitespace and comments", () => {
    const a = `export const x=1*RATE;export const y=2*RATE;`;
    const b = `// a comment\nexport const x = 1 * RATE;\n\n  export const y = 2 * RATE; // trailing`;
    expect(tokenize("f.ts", a)).toEqual(tokenize("f.ts", b));
  });
  it("a reformat/comment-only change has edit cost 0", () => {
    const before = { "src/m.ts": `export const x=1*RATE;` };
    const after = { "src/m.ts": `// reformatted\nexport const x = 1 * RATE;` };
    expect(editCost(before, after).tokens).toBe(0);
  });
});

describe("lcsEditSize", () => {
  it("counts insertions+deletions", () => {
    expect(lcsEditSize(["a", "b", "c"], ["a", "b", "c"])).toBe(0);
    expect(lcsEditSize(["a", "b", "c"], ["a", "x", "c"])).toBe(2); // 1 del + 1 ins
    expect(lcsEditSize([], ["a", "b"])).toBe(2);
  });
});

// POSITIVE CONTROL (THEORY.md T1, 𝒟_coupled case): a concept duplicated k times costs
// ~k× to change. This is the empirical claim that makes "less code helps" true *here* —
// and the metric must measure it. (The 𝒟_decoupled flip, where dedup HURTS, is T1.)
describe("positive control — edit cost scales with amplification", () => {
  const clean = `const RATE = 1.0;
export const a = 1 * RATE;
export const b = 2 * RATE;
export const c = 3 * RATE;`;
  const taxed = `export const a = 1 * 1.0;
export const b = 2 * 1.0;
export const c = 3 * 1.0;`;

  // δ (𝒟_coupled): the shared rate becomes 2.0.
  const cleanAfter = clean.replace("RATE = 1.0", "RATE = 2.0");          // 1 site
  const taxedAfter = taxed.replaceAll("* 1.0", "* 2.0");                  // 3 sites

  it("changing a deduplicated concept is cheaper than a duplicated one", () => {
    const eClean = editCost({ "src/m.ts": clean }, { "src/m.ts": cleanAfter }).tokens;
    const eTaxed = editCost({ "src/m.ts": taxed }, { "src/m.ts": taxedAfter }).tokens;
    expect(eClean).toBeGreaterThan(0);
    expect(eTaxed).toBeGreaterThan(eClean);          // duplication ⇒ more expensive change
    expect(eTaxed).toBeGreaterThanOrEqual(eClean * 2.5); // ≈ 3× (amplification factor)
  });
});

describe("editCost ignores test/accept files", () => {
  it("does not count *.test.ts / *.accept.test.ts", () => {
    const before = { "src/m.ts": `const a=1;` };
    const after = {
      "src/m.ts": `const a=1;`,
      "src/m.accept.test.ts": `it("x",()=>{})`,
      "src/m.test.ts": `it("y",()=>{})`,
    };
    expect(editCost(before, after).tokens).toBe(0);
  });
});

describe("verifyCost — safer = cheaper to verify", () => {
  const art = { regions: { cli: { p: 0.98 }, mappers: { p: 0.62 } } };
  it("is low for a well-fenced region, high for a weak one", () => {
    expect(verifyCost(["cli"], art)).toBeCloseTo(0.02, 5);
    expect(verifyCost(["mappers"], art)).toBeCloseTo(0.38, 5);
  });
  it("fails closed (cost 1) for an unmeasured region", () => {
    expect(verifyCost(["unknown"], art)).toBe(1);
  });
});
