import { describe, expect, it } from "vitest";
import { tokenize, lcsEditSize, editCost, verifyCost } from "./changecost.mjs";

describe("edit size — formatting & comment invariant", () => {
  it("ignores whitespace and comments", () => {
    expect(tokenize("f.ts", `export const x=1*RATE;`)).toEqual(
      tokenize("f.ts", `// c\nexport const x = 1 * RATE; // trailing`),
    );
  });
  it("a reformat-only change has edit cost 0", () => {
    expect(
      editCost({ "src/m.ts": `const x=1;` }, { "src/m.ts": `// r\nconst x = 1;` }).tokens,
    ).toBe(0);
  });
});

describe("lcsEditSize", () => {
  it("counts insertions + deletions", () => {
    expect(lcsEditSize(["a", "b", "c"], ["a", "x", "c"])).toBe(2);
    expect(lcsEditSize([], ["a", "b"])).toBe(2);
  });
});

// Positive control (docs/spec.md T1): a concept duplicated k times costs ~k× to
// change. This is what makes "less code helps" true here, and editCost must capture it.
describe("edit cost scales with amplification", () => {
  const clean = `const RATE = 1.0;\nexport const a = 1 * RATE;\nexport const b = 2 * RATE;\nexport const c = 3 * RATE;`;
  const taxed = `export const a = 1 * 1.0;\nexport const b = 2 * 1.0;\nexport const c = 3 * 1.0;`;
  it("changing a deduplicated concept is cheaper than a duplicated one (~3×)", () => {
    const eClean = editCost(
      { "src/m.ts": clean },
      { "src/m.ts": clean.replace("RATE = 1.0", "RATE = 2.0") },
    ).tokens;
    const eTaxed = editCost(
      { "src/m.ts": taxed },
      { "src/m.ts": taxed.replaceAll("* 1.0", "* 2.0") },
    ).tokens;
    expect(eClean).toBeGreaterThan(0);
    expect(eTaxed).toBeGreaterThanOrEqual(eClean * 2.5);
  });
});

describe("verifyCost — safer = cheaper to verify", () => {
  const art = { regions: { cli: { p: 0.98 }, mappers: { p: 0.62 } } };
  it("low for a well-fenced region, high for a weak one, 1 for unmeasured", () => {
    expect(verifyCost(["cli"], art)).toBeCloseTo(0.02, 5);
    expect(verifyCost(["mappers"], art)).toBeCloseTo(0.38, 5);
    expect(verifyCost(["unknown"], art)).toBe(1);
  });
});
