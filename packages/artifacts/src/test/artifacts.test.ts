// Characterization + dual-execution tests for legacy/codenuke/loop/artifacts.mjs.
// The validators read .codenuke artifacts from disk and resolve git refs, so each
// case is a temp git repo with a written artifact. Valid fence values are generated
// with the real wilson() so the anti-tamper recomputation passes; tampered copies
// must be rejected.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  calibrationArtifactStatus,
  fenceArtifactStatus,
  valueProxyValidationStatus,
} from "@codenuke/artifacts";
import { wilson } from "@codenuke/stats";
import {
  calibrationArtifactStatus as legacyCalibration,
  fenceArtifactStatus as legacyFence,
  valueProxyValidationStatus as legacyValueProxy,
} from "../../../../test-fixtures/legacy-loop/artifacts.mjs";

const created: string[] = [];
afterAll(() => {
  for (const d of created) rmSync(d, { recursive: true, force: true });
});

function makeRepo(): { dir: string; head: string } {
  const dir = mkdtempSync(join(tmpdir(), "cn-artifacts-"));
  created.push(dir);
  const git = (args: string[]) => execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  git(["init", "-q"]);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-q", "-m", "init"]);
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  return { dir, head };
}

function writeArtifact(dir: string, name: string, obj: unknown): void {
  mkdirSync(join(dir, ".codenuke"), { recursive: true });
  writeFileSync(join(dir, ".codenuke", name), JSON.stringify(obj, null, 2));
}

const cfg = (dir: string) => ({
  repo: dir,
  baseline: "HEAD",
  fenceArtifact: join(dir, ".codenuke", "fence-fidelity.json"),
  thresholds: { fenceLB: 0.9 },
});

const both = <T>(fn: (c: ReturnType<typeof cfg>) => T, legacy: (c: ReturnType<typeof cfg>) => T, dir: string): [T, T] => [
  fn(cfg(dir)),
  legacy(cfg(dir)),
];

// A valid fence artifact: one all-caught region + one with a single survivor.
function validFence(head: string) {
  const a = wilson(35, 35);
  const b = wilson(34, 35);
  return {
    baseline: "HEAD",
    baselineSha: head,
    generatedAt: new Date().toISOString(),
    method: "ast-aware",
    threshold: 0.9,
    capPerRegion: 60,
    seed: 1337,
    regions: {
      alpha: { caught: 35, total: 35, p: a.p, lo: a.lo, hi: a.hi, admissible: a.lo >= 0.9, survivorSpecs: [] },
      beta: {
        caught: 34,
        total: 35,
        p: b.p,
        lo: b.lo,
        hi: b.hi,
        admissible: b.lo >= 0.9,
        survivorSpecs: [{ rel: "a.ts", start: 0, end: 5, repl: "x", op: "<" }],
      },
    },
  };
}

describe("fenceArtifactStatus — dual-execution", () => {
  it("missing when no file", () => {
    const { dir } = makeRepo();
    const [a, b] = both(fenceArtifactStatus, legacyFence, dir);
    expect(a).toEqual(b);
    expect(a.reason).toBe("missing");
  });

  it("usable for a valid artifact (anti-tamper recomputation passes)", () => {
    const { dir, head } = makeRepo();
    writeArtifact(dir, "fence-fidelity.json", validFence(head));
    const [a, b] = both(fenceArtifactStatus, legacyFence, dir);
    expect(a).toEqual(b);
    expect(a.usable).toBe(true);
  });

  it("stale-baseline-sha when the recorded sha differs", () => {
    const { dir, head } = makeRepo();
    writeArtifact(dir, "fence-fidelity.json", { ...validFence(head), baselineSha: "0".repeat(40) });
    const [a, b] = both(fenceArtifactStatus, legacyFence, dir);
    expect(a).toEqual(b);
    expect(a.reason).toBe("stale-baseline-sha");
  });

  it("invalid-metadata for a wrong method", () => {
    const { dir, head } = makeRepo();
    writeArtifact(dir, "fence-fidelity.json", { ...validFence(head), method: "line-based" });
    const [a, b] = both(fenceArtifactStatus, legacyFence, dir);
    expect(a).toEqual(b);
    expect(a.reason).toBe("invalid-metadata");
  });

  it("invalid-regions when p is tampered (recomputation mismatch)", () => {
    const { dir, head } = makeRepo();
    const art = validFence(head);
    (art.regions.alpha as { p: number }).p = 0.5; // hand-edited, no longer matches wilson()
    writeArtifact(dir, "fence-fidelity.json", art);
    const [a, b] = both(fenceArtifactStatus, legacyFence, dir);
    expect(a).toEqual(b);
    expect(a.reason).toBe("invalid-regions");
  });

  it("invalid-regions when admissible disagrees with lo>=threshold", () => {
    const { dir, head } = makeRepo();
    const art = validFence(head);
    (art.regions.alpha as { admissible: boolean }).admissible = false; // lo>=0.9 but claims false
    writeArtifact(dir, "fence-fidelity.json", art);
    const [a, b] = both(fenceArtifactStatus, legacyFence, dir);
    expect(a).toEqual(b);
    expect(a.reason).toBe("invalid-regions");
  });
});

describe("calibrationArtifactStatus — dual-execution", () => {
  const valid = (head: string) => ({
    schemaVersion: 1,
    baseline: "HEAD",
    baselineSha: head,
    generatedAt: new Date().toISOString(),
    commitsSampled: 5,
    scales: { sL: 120, sCx: 12, sDup: 4 },
  });

  it("missing when no file", () => {
    const { dir } = makeRepo();
    const [a, b] = both(calibrationArtifactStatus, legacyCalibration, dir);
    expect(a).toEqual(b);
    expect(a.reason).toBe("missing");
  });

  it("usable for a valid artifact", () => {
    const { dir, head } = makeRepo();
    writeArtifact(dir, "calibration.json", valid(head));
    const [a, b] = both(calibrationArtifactStatus, legacyCalibration, dir);
    expect(a).toEqual(b);
    expect(a.usable).toBe(true);
  });

  it("invalid-metadata for an otherwise valid unversioned artifact", () => {
    const { dir, head } = makeRepo();
    const { schemaVersion: _schemaVersion, ...unversioned } = valid(head);
    writeArtifact(dir, "calibration.json", unversioned);
    const status = calibrationArtifactStatus(cfg(dir));
    expect(status.usable).toBe(false);
    expect(status.reason).toBe("invalid-metadata");
  });

  it("invalid-provenance for <3 commits with non-default scales", () => {
    const { dir, head } = makeRepo();
    writeArtifact(dir, "calibration.json", { ...valid(head), commitsSampled: 2 });
    const [a, b] = both(calibrationArtifactStatus, legacyCalibration, dir);
    expect(a).toEqual(b);
    expect(a.reason).toBe("invalid-provenance");
  });

  it("invalid-scales for a non-positive scale", () => {
    const { dir, head } = makeRepo();
    writeArtifact(dir, "calibration.json", { ...valid(head), scales: { sL: -1, sCx: 12, sDup: 4 } });
    const [a, b] = both(calibrationArtifactStatus, legacyCalibration, dir);
    expect(a).toEqual(b);
    expect(a.reason).toBe("invalid-scales");
  });
});

describe("valueProxyValidationStatus — dual-execution", () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, proxy: i + 1, Vhat: (6 - i) * 10 }));
  const valid = {
    schemaVersion: 1,
    passed: true,
    reason: null,
    candidates: 6,
    minimumCandidates: 6,
    minimumRho: 0.6,
    rho: 1,
    alpha: 0.05,
    pValue: 1 / 720,
    pMethod: "exact",
    rows,
  };

  it("missing when no file", () => {
    const { dir } = makeRepo();
    const [a, b] = both(valueProxyValidationStatus, legacyValueProxy, dir);
    expect(a).toEqual(b);
    expect(a.reason).toBe("missing");
  });

  it("usable for a valid passing report", () => {
    const { dir } = makeRepo();
    writeArtifact(dir, "value-proxy-validation.json", valid);
    const [a, b] = both(valueProxyValidationStatus, legacyValueProxy, dir);
    expect(a).toEqual(b);
    expect(a.usable).toBe(true);
  });

  it("invalid for an otherwise valid unversioned passing report", () => {
    const { dir } = makeRepo();
    const { schemaVersion: _schemaVersion, ...unversioned } = valid;
    writeArtifact(dir, "value-proxy-validation.json", unversioned);
    const status = valueProxyValidationStatus(cfg(dir));
    expect(status.usable).toBe(false);
    expect(status.reason).toBe("invalid");
  });

  it("invalid when reported proxy statistics do not match the candidate rows", () => {
    const { dir } = makeRepo();
    writeArtifact(dir, "value-proxy-validation.json", {
      ...valid,
      rows: rows.map((row) => ({ ...row, Vhat: row.proxy * 10 })),
    });
    const status = valueProxyValidationStatus(cfg(dir));
    expect(status.usable).toBe(false);
    expect(status.reason).toBe("invalid");
  });

  it("invalid when passed is false", () => {
    const { dir } = makeRepo();
    writeArtifact(dir, "value-proxy-validation.json", { ...valid, passed: false, reason: "low-rho" });
    const [a, b] = both(valueProxyValidationStatus, legacyValueProxy, dir);
    expect(a).toEqual(b);
    expect(a.reason).toBe("invalid");
  });

  it("invalid when rho is below minimumRho", () => {
    const { dir } = makeRepo();
    writeArtifact(dir, "value-proxy-validation.json", { ...valid, rho: 0.5 });
    const [a, b] = both(valueProxyValidationStatus, legacyValueProxy, dir);
    expect(a).toEqual(b);
    expect(a.reason).toBe("invalid");
  });
});
