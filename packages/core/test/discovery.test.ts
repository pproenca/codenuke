import { describe, expect, it } from "@effect/vitest";
import { discoverOpportunities } from "../src/index.ts";

const files = {
  "src/a.ts": `
function core(x: number) { return x + 1; }
export function wrap(x: number) { return core(x); }
function duplicateA(value: number) {
  if (true) {
    return value + 1;
  }
  return value;
}
`,
  "src/b.ts": `
function duplicateB(input: number) {
  if (true) {
    return input + 1;
  }
  return input;
}
`,
};

describe("JS/TS discovery", () => {
  it("emits stable opportunity ids and deterministic ordering", () => {
    const first = discoverOpportunities(files, "src");
    const second = discoverOpportunities(files, "src");

    expect(first.map((op) => op.id)).toEqual(second.map((op) => op.id));
    expect(first.map((op) => op.id)).toEqual([...first.map((op) => op.id)].sort());
    expect(first.map((op) => op.kind)).toEqual(expect.arrayContaining(["duplicate-subtree", "wrapper-chain"]));
    expect(first.every((op) => op.region === "src")).toBe(true);
    expect(first.every((op) => op.inputHash.length > 0 && op.estimatedGain > 0)).toBe(true);
  });
});
