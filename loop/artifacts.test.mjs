import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fenceArtifactStatus, valueProxyValidationStatus } from "./artifacts.mjs";

function fixtureRoot(name) {
  return mkdtempSync(join(tmpdir(), name));
}

function write(root, path, contents) {
  const absolute = join(root, path);
  mkdirSync(absolute.split("/").slice(0, -1).join("/"), { recursive: true });
  writeFileSync(absolute, contents);
}

function git(root, args) {
  execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
}

function initRepo(root) {
  write(root, "src/index.ts", "export const value = 1;\n");
  git(root, ["init"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test User"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "initial"]);
}

function config(root) {
  return {
    repo: root,
    baseline: "HEAD",
    fenceArtifact: join(root, ".codenuke/fence-fidelity.json"),
    thresholds: { fenceLB: 0.9 },
  };
}

function validFenceArtifact(overrides = {}) {
  return {
    baseline: "HEAD",
    generatedAt: "2026-05-22T00:00:00.000Z",
    method: "ast-aware",
    threshold: 0.9,
    capPerRegion: 60,
    seed: 1337,
    regions: {
      src: {
        caught: 35,
        total: 35,
        p: 1,
        lo: 0.9010957324106112,
        hi: 1,
        admissible: true,
        survivorSpecs: [],
      },
    },
    ...overrides,
  };
}

function writeFence(root, artifact) {
  write(root, ".codenuke/fence-fidelity.json", JSON.stringify(artifact));
}

describe("artifact validation", () => {
  it("accepts a fence artifact with schema metadata and replayable regions", () => {
    const root = fixtureRoot("codenuke-artifacts-valid-");
    initRepo(root);
    writeFence(root, validFenceArtifact());

    expect(fenceArtifactStatus(config(root))).toMatchObject({ usable: true, reason: null });
  });

  it("rejects a fence artifact produced by a non-AST-aware method", () => {
    const root = fixtureRoot("codenuke-artifacts-method-");
    initRepo(root);
    writeFence(root, validFenceArtifact({ method: "text" }));

    expect(fenceArtifactStatus(config(root))).toMatchObject({
      usable: false,
      stale: false,
      reason: "invalid-metadata",
    });
  });

  it("rejects a fence artifact admitted under a different threshold", () => {
    const root = fixtureRoot("codenuke-artifacts-threshold-");
    initRepo(root);
    writeFence(root, validFenceArtifact({ threshold: 0.5 }));

    expect(fenceArtifactStatus(config(root))).toMatchObject({
      usable: false,
      stale: false,
      reason: "invalid-metadata",
    });
  });

  it("rejects a fence artifact without one survivor spec per surviving mutant", () => {
    const root = fixtureRoot("codenuke-artifacts-survivors-");
    initRepo(root);
    writeFence(
      root,
      validFenceArtifact({
        regions: {
          src: {
            caught: 1,
            total: 2,
            p: 0.5,
            lo: 0.1,
            hi: 0.9,
            admissible: false,
            survivorSpecs: [],
          },
        },
      }),
    );

    expect(fenceArtifactStatus(config(root))).toMatchObject({
      usable: false,
      stale: false,
      reason: "invalid-regions",
    });
  });

  it("rejects a fence artifact with forged Wilson bounds", () => {
    const root = fixtureRoot("codenuke-artifacts-forged-wilson-");
    initRepo(root);
    writeFence(
      root,
      validFenceArtifact({
        regions: {
          src: {
            caught: 35,
            total: 35,
            p: 1,
            lo: 0.99,
            hi: 1,
            admissible: true,
            survivorSpecs: [],
          },
        },
      }),
    );

    expect(fenceArtifactStatus(config(root))).toMatchObject({
      usable: false,
      stale: false,
      reason: "invalid-regions",
    });
  });

  it("accepts a passing value-proxy validation artifact", () => {
    const root = fixtureRoot("codenuke-artifacts-proxy-valid-");
    initRepo(root);
    write(
      root,
      ".codenuke/value-proxy-validation.json",
      JSON.stringify({
        passed: true,
        reason: null,
        candidates: 3,
        minimumCandidates: 3,
        minimumRho: 0.6,
        rho: 1,
        rows: [
          { id: "baseline", proxy: 1, Vhat: 30 },
          { id: "candidate", proxy: 2, Vhat: 20 },
          { id: "target", proxy: 3, Vhat: 10 },
        ],
      }),
    );

    expect(valueProxyValidationStatus(config(root))).toMatchObject({ usable: true, reason: null });
  });

  it("rejects a failed value-proxy validation artifact", () => {
    const root = fixtureRoot("codenuke-artifacts-proxy-failed-");
    initRepo(root);
    write(
      root,
      ".codenuke/value-proxy-validation.json",
      JSON.stringify({
        passed: false,
        reason: "low-rho",
        candidates: 3,
        minimumCandidates: 3,
        minimumRho: 0.6,
        rho: -1,
        rows: [
          { id: "baseline", proxy: 1, Vhat: 10 },
          { id: "candidate", proxy: 2, Vhat: 20 },
          { id: "target", proxy: 3, Vhat: 30 },
        ],
      }),
    );

    expect(valueProxyValidationStatus(config(root))).toMatchObject({
      usable: false,
      reason: "invalid",
    });
  });

  it("rejects a value-proxy validation artifact with impossible rho", () => {
    const root = fixtureRoot("codenuke-artifacts-proxy-impossible-rho-");
    initRepo(root);
    write(
      root,
      ".codenuke/value-proxy-validation.json",
      JSON.stringify({
        passed: true,
        reason: null,
        candidates: 3,
        minimumCandidates: 3,
        minimumRho: 0.6,
        rho: 1.5,
        rows: [
          { id: "baseline", proxy: 1, Vhat: 30 },
          { id: "candidate", proxy: 2, Vhat: 20 },
          { id: "target", proxy: 3, Vhat: 10 },
        ],
      }),
    );

    expect(valueProxyValidationStatus(config(root))).toMatchObject({
      usable: false,
      reason: "invalid",
    });
  });
});
