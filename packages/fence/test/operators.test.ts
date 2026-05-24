import { describe, expect, it } from "@effect/vitest";
import { OPERATORS, collectSites } from "../src/operators.ts";

describe("RULE-007 mutation operator table & site collection", () => {
  it("RULE-007 operator table covers the three contract families", () => {
    const ops = new Set(OPERATORS.map((o) => o.op));
    // equality flips (both directions)
    expect(ops.has("eq->neq")).toBe(true);
    expect(ops.has("neq->eq")).toBe(true);
    // string-predicate swaps
    expect(ops.has("startsWith->endsWith")).toBe(true);
    expect(ops.has("endsWith->startsWith")).toBe(true);
    // boolean-return flips
    expect(ops.has("true->false")).toBe(true);
    expect(ops.has("false->true")).toBe(true);
  });

  it("RULE-007 collectSites flips === to !==, .startsWith( to .endsWith(, return true to return false", () => {
    const source = "if (a === b) {} s.startsWith(x); function f() { return true; }";
    const sites = collectSites(source);

    const eq = sites.find((s) => s.op === "eq->neq");
    expect(eq).toBeDefined();
    expect(eq!.repl).toBe("!==");
    expect(source.slice(eq!.start, eq!.end)).toBe("===");

    const sw = sites.find((s) => s.op === "startsWith->endsWith");
    expect(sw).toBeDefined();
    expect(sw!.repl).toBe(".endsWith(");
    expect(source.slice(sw!.start, sw!.end)).toBe(".startsWith(");

    const rt = sites.find((s) => s.op === "true->false");
    expect(rt).toBeDefined();
    expect(rt!.repl).toBe("return false");
    expect(source.slice(rt!.start, rt!.end)).toBe("return true");
  });

  it("RULE-007 every site carries start/end/repl/op with 0 <= start < end", () => {
    const sites = collectSites("a !== b; return false; t.endsWith(q)");
    expect(sites.length).toBeGreaterThan(0);
    for (const s of sites) {
      expect(typeof s.start).toBe("number");
      expect(typeof s.end).toBe("number");
      expect(s.start).toBeGreaterThanOrEqual(0);
      expect(s.start).toBeLessThan(s.end);
      expect(s.repl.length).toBeGreaterThan(0);
      expect(s.op.length).toBeGreaterThan(0);
    }
  });

  it("RULE-007 longest-match-first: === is one site, not === plus ==", () => {
    const sites = collectSites("a === b");
    const eqSites = sites.filter((s) => s.op.startsWith("eq") || s.op.startsWith("neq"));
    expect(eqSites.length).toBe(1);
    expect(eqSites[0]!.repl).toBe("!==");
  });
});
