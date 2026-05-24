import { describe, expect, it } from "@effect/vitest";
import type { MutationSite } from "../src/operators.ts";
import { DEFAULT_CAP, DEFAULT_SEED, mulberry32, sampleSites } from "../src/sampling.ts";

const makeSites = (n: number): MutationSite[] =>
  Array.from({ length: n }, (_, i) => ({ start: i, end: i + 1, repl: "x", op: `op${i}` }));

describe("RULE-008 deterministic mutation sampling (cap/seed)", () => {
  it("RULE-008 mulberry32 is deterministic for a given seed", () => {
    const a = mulberry32(DEFAULT_SEED);
    const b = mulberry32(DEFAULT_SEED);
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("RULE-008 different seeds (generally) produce different streams", () => {
    const a = mulberry32(1337);
    const b = mulberry32(7331);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).not.toEqual(seqB);
  });

  it("RULE-008 same (cap=60, seed=1337) yields a byte-identical 60-site sample", () => {
    const sites = makeSites(200);
    const run1 = sampleSites(sites, 60, 1337, "r/file.ts");
    const run2 = sampleSites(sites, 60, 1337, "r/file.ts");
    expect(run1.length).toBe(60);
    expect(run2).toEqual(run1);
  });

  it("RULE-008 a different seed (generally) changes the sample", () => {
    const sites = makeSites(200);
    const a = sampleSites(sites, 60, 1337);
    const b = sampleSites(sites, 60, 4242);
    expect(b).not.toEqual(a);
  });

  it("RULE-008 fewer sites than cap keeps all of them", () => {
    const sites = makeSites(40);
    const plan = sampleSites(sites, DEFAULT_CAP, DEFAULT_SEED);
    expect(plan.length).toBe(40);
    // every original op is still present (sample is a permutation, just capped)
    expect(new Set(plan.map((p) => p.op))).toEqual(new Set(sites.map((s) => s.op)));
  });

  it("RULE-008 each PlannedMutation carries the repo-relative rel", () => {
    const plan = sampleSites(makeSites(5), 60, 1337, "packages/scorer/src/x.ts");
    for (const p of plan) {
      expect(p.rel).toBe("packages/scorer/src/x.ts");
      expect(p).toHaveProperty("start");
      expect(p).toHaveProperty("repl");
    }
  });

  // NOTE: this mulberry32 (with per-call `a |= 0`) is INTENTIONALLY distinct
  // from value-proxy's permutation PRNG (RULE-008 vs RULE-015). Do not share.
});
