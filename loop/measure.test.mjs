import { describe, expect, it } from "vitest";
import { measure } from "./measure.mjs";

const astSize = (files) => measure(files).L;

describe("AST size L", () => {
  it("is invariant under formatting, comments, and local renames", () => {
    const original = {
      "src/calc.ts": `
export function total(price: number, quantity: number): number {
  const subtotal = price * quantity;
  return subtotal + 1;
}
`,
    };
    const formatted = {
      "src/calc.ts": `// comment ignored by L
export function total( price:number, quantity:number ) : number
{
const subtotal=price*quantity
return subtotal + 1
}
`,
    };
    const renamed = {
      "src/calc.ts": `
export function total(unitPrice: number, itemCount: number): number {
  const amount = unitPrice * itemCount;
  return amount + 1;
}
`,
    };

    expect(astSize(formatted)).toBe(astSize(original));
    expect(astSize(renamed)).toBe(astSize(original));
  });

  it("is additive for disjoint file sets", () => {
    const left = {
      "src/left.ts": "export const left = (value: number) => value + 1;\n",
    };
    const right = {
      "src/right.ts": "export const right = (value: number) => value > 0;\n",
    };

    expect(astSize({ ...left, ...right })).toBe(astSize(left) + astSize(right));
  });

  it("strictly decreases when a statement is deleted", () => {
    const withStatement = {
      "src/run.ts": `
export function run(input: number): number {
  const doubled = input * 2;
  return doubled;
}
`,
    };
    const withoutStatement = {
      "src/run.ts": `
export function run(input: number): number {
  return input * 2;
}
`,
    };

    expect(astSize(withoutStatement)).toBeLessThan(astSize(withStatement));
  });
});
