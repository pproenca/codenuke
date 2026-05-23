import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { spearmanPValue, spearmanRho, validateValueProxy } from "./value-proxy.mjs";

// A perfectly rank-correlated corpus of n candidates (higher proxy ↔ lower Vhat).
const monotoneCorpus = (n) =>
  Array.from({ length: n }, (_, i) => ({ id: `c${i}`, proxy: i + 1, Vhat: (n - i) * 10 }));

const cli = fileURLToPath(new URL("../bin/codenuke.mjs", import.meta.url));

function fixtureRoot(name) {
  return mkdtempSync(join(tmpdir(), name));
}

function write(root, path, contents) {
  const absolute = join(root, path);
  mkdirSync(absolute.split("/").slice(0, -1).join("/"), { recursive: true });
  writeFileSync(absolute, contents);
}

describe("Spearman rho", () => {
  it("detects positive and negative rank correlation", () => {
    expect(spearmanRho([1, 2, 3], [10, 20, 30])).toBeCloseTo(1, 12);
    expect(spearmanRho([1, 2, 3], [30, 20, 10])).toBeCloseTo(-1, 12);
  });

  it("handles tied ranks with average ranks", () => {
    expect(spearmanRho([1, 1, 2, 3], [10, 10, 20, 30])).toBeCloseTo(1, 12);
  });
});

describe("Spearman permutation p-value", () => {
  it("returns the exact one-sided p for small n by enumeration", () => {
    // n=3 perfect correlation: only 1 of 3! orderings reaches rho=1 → p = 1/6 ≈ 0.167.
    const { p, method, permutations } = spearmanPValue([1, 2, 3], [10, 20, 30]);
    expect(method).toBe("exact");
    expect(permutations).toBe(6);
    expect(p).toBeCloseTo(1 / 6, 12);
  });

  it("reproduces the codecharter n=3 result as non-significant (p ≈ 0.333)", () => {
    // The 2026-05-22 codecharter run: proxy vs -Vhat with a tie (Vhat 17,17,14).
    const { p } = spearmanPValue([4.2, 4.36, 5.88], [-17, -17, -14]);
    expect(p).toBeCloseTo(1 / 3, 12);
  });

  it("falls to a deterministic sample beyond the exact cap", () => {
    const proxy = monotoneCorpus(12).map((c) => c.proxy);
    const negVhat = monotoneCorpus(12).map((c) => -c.Vhat);
    const a = spearmanPValue(proxy, negVhat);
    const b = spearmanPValue(proxy, negVhat);
    expect(a.method).toBe("sampled");
    expect(a.p).toBe(b.p); // same seed → identical p (INV-5)
    expect(a.p).toBeLessThanOrEqual(0.05);
  });
});

describe("value proxy validation", () => {
  it("passes when a large enough corpus tracks change-cost significantly", () => {
    const report = validateValueProxy(monotoneCorpus(9));

    expect(report).toMatchObject({
      passed: true,
      reason: null,
      rho: 1,
      minimumRho: 0.6,
      alpha: 0.05,
      pMethod: "exact",
      candidates: 9,
    });
    expect(report.pValue).toBeLessThanOrEqual(0.05);
  });

  it("rejects a strong but statistically vacuous n=3 correlation", () => {
    // Perfect rho on 3 candidates is the n=3 trap: significant only as low as p = 1/6.
    const report = validateValueProxy([
      { id: "small", proxy: 1, Vhat: 30 },
      { id: "medium", proxy: 2, Vhat: 20 },
      { id: "large", proxy: 3, Vhat: 10 },
    ]);

    expect(report).toMatchObject({
      passed: false,
      reason: "not-significant",
      rho: 1,
      candidates: 3,
    });
    expect(report.pValue).toBeCloseTo(1 / 6, 12);
  });

  it("fails closed for too-small corpora", () => {
    const report = validateValueProxy([
      { id: "one", proxy: 1, Vhat: 1 },
      { id: "two", proxy: 2, Vhat: 2 },
    ]);

    expect(report).toMatchObject({
      passed: false,
      reason: "too-small-corpus",
      candidates: 2,
    });
  });

  it("reports low-rho before significance when the effect size is wrong", () => {
    const report = validateValueProxy(
      monotoneCorpus(9).map((c) => ({ ...c, Vhat: -c.Vhat })), // flip → anti-correlated
    );

    expect(report).toMatchObject({ passed: false, reason: "low-rho", candidates: 9 });
  });
});

describe("codenuke validate-proxy", () => {
  it("writes a passing Spearman validation artifact for score/changecost candidates", () => {
    const root = fixtureRoot("codenuke-validate-proxy-pass-");
    write(
      root,
      ".codenuke/value-proxy.json",
      JSON.stringify({
        candidates: Array.from({ length: 9 }, (_, i) => ({
          id: `c${i}`,
          proxy: i + 1,
          Vhat: (9 - i) * 10,
        })),
      }),
    );

    const result = spawnSync("node", [cli, "validate-proxy"], {
      cwd: root,
      encoding: "utf8",
    });
    const artifact = JSON.parse(
      readFileSync(join(root, ".codenuke/value-proxy-validation.json"), "utf8"),
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("value proxy validation: PASS");
    expect(artifact).toMatchObject({ passed: true, rho: 1, candidates: 9 });
    expect(artifact.pValue).toBeLessThanOrEqual(0.05);
  });

  it("fails closed and records why when the candidate corpus is too small", () => {
    const root = fixtureRoot("codenuke-validate-proxy-small-");
    write(
      root,
      ".codenuke/value-proxy.json",
      JSON.stringify([
        { id: "one", proxy: 1, Vhat: 1 },
        { id: "two", proxy: 2, Vhat: 2 },
      ]),
    );

    const result = spawnSync("node", [cli, "validate-proxy"], {
      cwd: root,
      encoding: "utf8",
    });
    const artifact = JSON.parse(
      readFileSync(join(root, ".codenuke/value-proxy-validation.json"), "utf8"),
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("value proxy validation: FAIL");
    expect(artifact).toMatchObject({
      passed: false,
      reason: "too-small-corpus",
      candidates: 2,
    });
  });

  it("fails closed when proxy rank does not track measured change-cost", () => {
    const root = fixtureRoot("codenuke-validate-proxy-low-rho-");
    write(
      root,
      ".codenuke/value-proxy.json",
      JSON.stringify([
        { id: "bad-a", proxy: 1, Vhat: 10 },
        { id: "bad-b", proxy: 2, Vhat: 20 },
        { id: "bad-c", proxy: 3, Vhat: 30 },
      ]),
    );

    const result = spawnSync("node", [cli, "validate-proxy"], {
      cwd: root,
      encoding: "utf8",
    });
    const artifact = JSON.parse(
      readFileSync(join(root, ".codenuke/value-proxy-validation.json"), "utf8"),
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("value proxy validation: FAIL");
    expect(artifact).toMatchObject({
      passed: false,
      reason: "low-rho",
      rho: -1,
      candidates: 3,
      minimumRho: 0.6,
    });
  });

  it("fails closed and writes an artifact for malformed candidate rows", () => {
    const root = fixtureRoot("codenuke-validate-proxy-malformed-");
    write(
      root,
      ".codenuke/value-proxy.json",
      JSON.stringify({
        candidates: [{ id: "bad", proxy: null, Vhat: 10 }],
      }),
    );

    const result = spawnSync("node", [cli, "validate-proxy"], {
      cwd: root,
      encoding: "utf8",
    });
    const artifact = JSON.parse(
      readFileSync(join(root, ".codenuke/value-proxy-validation.json"), "utf8"),
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("value proxy validation input invalid");
    expect(artifact).toMatchObject({
      passed: false,
      reason: "malformed-input",
      candidates: 0,
      minimumCandidates: 3,
      minimumRho: 0.6,
      rho: null,
      rows: [],
    });
    expect(artifact.error).toContain("candidate bad");
  });

  it("fails closed and writes an artifact for invalid validation thresholds", () => {
    const root = fixtureRoot("codenuke-validate-proxy-bad-threshold-");
    write(
      root,
      ".codenuke/value-proxy.json",
      JSON.stringify({
        candidates: [
          { id: "small", proxy: 1, Vhat: 30 },
          { id: "medium", proxy: 2, Vhat: 20 },
          { id: "large", proxy: 3, Vhat: 10 },
        ],
      }),
    );

    const result = spawnSync("node", [cli, "validate-proxy"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, CN_MIN_RHO: "not-a-number" },
    });
    const artifact = JSON.parse(
      readFileSync(join(root, ".codenuke/value-proxy-validation.json"), "utf8"),
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("value proxy validation config invalid");
    expect(artifact).toMatchObject({
      passed: false,
      reason: "invalid-config",
      candidates: 0,
      minimumCandidates: 3,
      minimumRho: 0.6,
      rho: null,
      rows: [],
    });
    expect(artifact.error).toContain("CN_MIN_RHO");
  });
});
