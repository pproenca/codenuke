// Characterization + dual-execution tests for legacy/codenuke/loop/measure.mjs.
// The migrated measure() keeps only the live quantities (L, complexity, dupMass);
// the legacy oracle returns more fields, so we compare the shared three.
import { describe, expect, it } from "vitest";

import { measure } from "../main/measure";
import { measure as legacyMeasure } from "../../../test-fixtures/legacy-loop/measure.mjs";

type Files = Record<string, string>;
const shared = (m: { L: number; complexity: number; dupMass: number }) => ({
  L: m.L,
  complexity: m.complexity,
  dupMass: m.dupMass,
});

const DUP_BLOCK =
  "const a1 = 1; const a2 = 2; const a3 = 3; const a4 = 4; const a5 = 5; const a6 = 6;\n";

const fileSets: Files[] = [
  { "empty.ts": "" },
  { "const.ts": "export const x = 1;" },
  {
    "branches.ts":
      "export function f(x: number) { if (x > 0) return 1; for (const _ of [x]) {} while (x) x--; return x > 0 && x < 9 ? 1 : 2; }",
  },
  {
    "switch.ts":
      "export function g(n: number) { switch (n) { case 1: return 'a'; case 2: return 'b'; default: return 'c'; } try { g(n - 1); } catch (e) { return 'x'; } }",
  },
  { "dup.ts": DUP_BLOCK + DUP_BLOCK + DUP_BLOCK },
  {
    "multi-a.ts": "export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);",
    "multi-b.ts": "export function pick<T>(xs: T[], i: number): T | undefined { return xs[i]; }",
    "multi.test.ts": "export const ignored = 999; if (true) {}",
  },
  { "nullish.ts": "export const h = (a?: number, b?: number) => (a ?? b) || 0;" },
];

describe("measure — characterization (RULE-003/004/005)", () => {
  it("excludes test files from all three quantities", () => {
    const withTest = measure({ "a.ts": "export const x = 1;", "a.test.ts": "const y = 2; if (y) {}" });
    const without = measure({ "a.ts": "export const x = 1;" });
    expect(shared(withTest)).toEqual(shared(without));
  });

  it("counts decision points for cyclomatic complexity (oracle-pinned)", () => {
    const files = { "branches.ts": fileSets[2]!["branches.ts"]! };
    const m = measure(files);
    expect(m.complexity).toBe(legacyMeasure(files).complexity);
    expect(m.complexity).toBeGreaterThan(1);
  });

  it("accrues duplicate-window mass for repeated blocks, zero for a single copy", () => {
    expect(measure({ "d.ts": DUP_BLOCK + DUP_BLOCK + DUP_BLOCK }).dupMass).toBeGreaterThan(0);
    expect(measure({ "s.ts": DUP_BLOCK }).dupMass).toBe(0);
  });

  it("measures an empty source identically to the legacy oracle (EOF-token node only)", () => {
    const files = { "e.ts": "" };
    expect(measure(files).L).toBe(legacyMeasure(files).L);
    expect(measure(files).dupMass).toBe(0);
  });
});

describe("dual-execution vs legacy measure — L / complexity / dupMass", () => {
  it("matches the legacy oracle across realistic file sets", () => {
    for (const files of fileSets) {
      expect(shared(measure(files))).toEqual(shared(legacyMeasure(files)));
    }
  });
});
