import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { spearmanRho, validateValueProxy } from "./value-proxy.mjs";

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

describe("value proxy validation", () => {
  it("passes when higher proxy values track lower change-cost", () => {
    const report = validateValueProxy([
      { id: "small", proxy: 1, Vhat: 30 },
      { id: "medium", proxy: 2, Vhat: 20 },
      { id: "large", proxy: 3, Vhat: 10 },
    ]);

    expect(report).toMatchObject({
      passed: true,
      rho: 1,
      minimumRho: 0.6,
      candidates: 3,
    });
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
});

describe("codenuke validate-proxy", () => {
  it("writes a passing Spearman validation artifact for score/changecost candidates", () => {
    const root = fixtureRoot("codenuke-validate-proxy-pass-");
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
    });
    const artifact = JSON.parse(
      readFileSync(join(root, ".codenuke/value-proxy-validation.json"), "utf8"),
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("value proxy validation: PASS");
    expect(artifact).toMatchObject({ passed: true, rho: 1, candidates: 3 });
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
