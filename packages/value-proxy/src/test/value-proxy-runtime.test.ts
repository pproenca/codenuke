import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as valueProxy from "@codenuke/value-proxy";
import { describe, expect, it } from "vitest";

interface Candidate {
  readonly id: string;
  readonly proxy: number;
  readonly Vhat: number;
}

interface ValidationReport {
  readonly schemaVersion: number;
  readonly passed: boolean;
  readonly reason:
    | "too-small-corpus"
    | "undefined-rank-correlation"
    | "low-rho"
    | "not-significant"
    | "invalid-config"
    | "malformed-input"
    | null;
  readonly candidates: number;
  readonly minimumCandidates: number;
  readonly minimumRho: number;
  readonly alpha: number;
  readonly rho: number | null;
  readonly pValue: number | null;
  readonly pMethod: "exact" | "sampled" | "degenerate" | null;
  readonly rows: readonly Candidate[];
  readonly input: string;
  readonly error?: string;
}

interface RuntimeResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface RuntimeApi {
  readonly defaultValueProxyInputPath: (repo: string) => string;
  readonly valueProxyValidationOutputPath: (repo: string) => string;
  readonly createValueProxyValidationArtifact: (input: {
    readonly report: Omit<ValidationReport, "schemaVersion" | "input">;
    readonly inputPath: string;
  }) => ValidationReport;
  readonly formatValueProxyValidationSummary: (report: ValidationReport) => string;
  readonly runValidateProxyCommand: (
    args: readonly string[],
    env: Record<string, string | undefined>,
    cwd: string,
  ) => Promise<RuntimeResult>;
}

function runtime<K extends keyof RuntimeApi>(name: K): RuntimeApi[K] {
  const value = (valueProxy as Record<string, unknown>)[name];
  if (typeof value !== "function") {
    throw new Error(`@codenuke/value-proxy must export runtime helper ${name}`);
  }
  return value as RuntimeApi[K];
}

function fixtureRoot(name = "codenuke-value-proxy-"): string {
  return mkdtempSync(join(tmpdir(), name));
}

function writeJson(root: string, path: string, value: unknown): string {
  const absolute = join(root, path);
  mkdirSync(absolute.split("/").slice(0, -1).join("/"), { recursive: true });
  writeFileSync(absolute, JSON.stringify(value, null, 2));
  return absolute;
}

function readReport(root: string): ValidationReport {
  return JSON.parse(
    readFileSync(join(root, ".codenuke/value-proxy-validation.json"), "utf8"),
  ) as ValidationReport;
}

function monotoneCorpus(n: number): Candidate[] {
  return Array.from({ length: n }, (_, index) => ({
    id: `candidate-${index + 1}`,
    proxy: index + 1,
    Vhat: (n - index) * 10,
  }));
}

describe("validate-proxy runtime paths and artifacts", () => {
  it("uses the repo-local default input path and fixed validation output path", () => {
    const defaultValueProxyInputPath = runtime("defaultValueProxyInputPath");
    const valueProxyValidationOutputPath = runtime("valueProxyValidationOutputPath");

    expect(defaultValueProxyInputPath("/repo")).toBe("/repo/.codenuke/value-proxy.json");
    expect(valueProxyValidationOutputPath("/repo")).toBe(
      "/repo/.codenuke/value-proxy-validation.json",
    );
  });

  it("writes the validation report with rebuild schemaVersion and the input path", () => {
    const createValueProxyValidationArtifact = runtime("createValueProxyValidationArtifact");

    expect(
      createValueProxyValidationArtifact({
        inputPath: "/repo/.codenuke/value-proxy.json",
        report: {
          passed: true,
          reason: null,
          candidates: 6,
          minimumCandidates: 6,
          minimumRho: 0.6,
          alpha: 0.05,
          rho: 1,
          pValue: 1 / 720,
          pMethod: "exact",
          rows: monotoneCorpus(6),
        },
      }),
    ).toEqual({
      schemaVersion: 1,
      passed: true,
      reason: null,
      candidates: 6,
      minimumCandidates: 6,
      minimumRho: 0.6,
      alpha: 0.05,
      rho: 1,
      pValue: 1 / 720,
      pMethod: "exact",
      rows: monotoneCorpus(6),
      input: "/repo/.codenuke/value-proxy.json",
    });
  });

  it("formats PASS and FAIL summaries exactly like the CLI contract", () => {
    const formatValueProxyValidationSummary = runtime("formatValueProxyValidationSummary");

    const pass = createReport({
      passed: true,
      reason: null,
      candidates: 6,
      minimumCandidates: 6,
      rho: 1,
      pValue: 1 / 720,
    });
    const fail = createReport({
      passed: false,
      reason: "too-small-corpus",
      candidates: 3,
      minimumCandidates: 6,
      rho: null,
      pValue: null,
      rows: monotoneCorpus(3),
    });

    expect(formatValueProxyValidationSummary(pass)).toBe(
      "value proxy validation: PASS rho=1.000 p=0.001 (alpha=0.05) min=0.6 candidates=6/6",
    );
    expect(formatValueProxyValidationSummary(fail)).toBe(
      "value proxy validation: FAIL rho=n/a p=n/a (alpha=0.05) min=0.6 candidates=3/6",
    );
  });
});

describe("runValidateProxyCommand", () => {
  it("fails closed when the default candidate input is missing", async () => {
    const root = fixtureRoot();
    const runValidateProxyCommand = runtime("runValidateProxyCommand");

    const result = await runValidateProxyCommand([], { CN_REPO: root }, root);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(
      `value proxy candidates missing at ${join(root, ".codenuke/value-proxy.json")}`,
    );
    expect(result.stdout).toContain("write candidate rows with {id, proxy, Vhat}");
    expect(existsSync(join(root, ".codenuke/value-proxy-validation.json"))).toBe(false);
  });

  it("reads the default input and writes a passing schema-versioned report", async () => {
    const root = fixtureRoot();
    writeJson(root, ".codenuke/value-proxy.json", { candidates: monotoneCorpus(6) });
    const runValidateProxyCommand = runtime("runValidateProxyCommand");

    const result = await runValidateProxyCommand([], { CN_REPO: root }, root);
    const report = readReport(root);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(
      "value proxy validation: PASS rho=1.000 p=0.001 (alpha=0.05) min=0.6 candidates=6/6",
    );
    expect(result.stdout).toContain(`-> ${join(root, ".codenuke/value-proxy-validation.json")}`);
    expect(report).toMatchObject({
      schemaVersion: 1,
      passed: true,
      reason: null,
      candidates: 6,
      minimumCandidates: 6,
      minimumRho: 0.6,
      alpha: 0.05,
      rho: 1,
      pMethod: "exact",
      input: join(root, ".codenuke/value-proxy.json"),
    });
    expect(report.pValue).toBeCloseTo(1 / 720, 12);
    expect(report.rows).toEqual(monotoneCorpus(6));
  });

  it("accepts an explicit JSON input while always writing the repo-local validation output", async () => {
    const root = fixtureRoot();
    const explicitInput = writeJson(
      fixtureRoot("codenuke-value-proxy-input-"),
      "proxy.json",
      monotoneCorpus(6),
    );
    const runValidateProxyCommand = runtime("runValidateProxyCommand");

    const result = await runValidateProxyCommand([explicitInput], { CN_REPO: root }, root);
    const report = readReport(root);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`-> ${join(root, ".codenuke/value-proxy-validation.json")}`);
    expect(report.input).toBe(explicitInput);
    expect(report.schemaVersion).toBe(1);
    expect(report.passed).toBe(true);
  });

  it("writes and prints an invalid-config report before reading candidate JSON", async () => {
    const root = fixtureRoot();
    writeJson(root, ".codenuke/value-proxy.json", {
      candidates: [{ id: "bad", proxy: null, Vhat: 10 }],
    });
    const runValidateProxyCommand = runtime("runValidateProxyCommand");

    const result = await runValidateProxyCommand([], { CN_REPO: root, CN_MIN_RHO: "2" }, root);
    const report = readReport(root);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(
      "value proxy validation config invalid: CN_MIN_RHO must be a finite number between -1 and 1",
    );
    expect(result.stdout).toContain(`-> ${join(root, ".codenuke/value-proxy-validation.json")}`);
    expect(report).toEqual({
      schemaVersion: 1,
      passed: false,
      reason: "invalid-config",
      candidates: 0,
      minimumCandidates: 6,
      minimumRho: 0.6,
      alpha: 0.05,
      rho: null,
      pValue: null,
      pMethod: null,
      rows: [],
      input: join(root, ".codenuke/value-proxy.json"),
      error: "CN_MIN_RHO must be a finite number between -1 and 1",
    });
  });

  it("keeps invalid-config precedence when the candidate JSON is malformed", async () => {
    const root = fixtureRoot();
    const input = join(root, ".codenuke/value-proxy.json");
    mkdirSync(join(root, ".codenuke"), { recursive: true });
    writeFileSync(input, "{ not json");
    const runValidateProxyCommand = runtime("runValidateProxyCommand");

    const result = await runValidateProxyCommand([], { CN_REPO: root, CN_ALPHA: "0" }, root);
    const report = readReport(root);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "value proxy validation config invalid: CN_ALPHA must be a finite number in (0, 1]",
    );
    expect(report.reason).toBe("invalid-config");
    expect(report.error).toBe("CN_ALPHA must be a finite number in (0, 1]");
  });

  it("normalizes numeric candidate ids so produced reports pass artifact schema checks", async () => {
    const root = fixtureRoot();
    writeJson(root, ".codenuke/value-proxy.json", {
      candidates: monotoneCorpus(6).map((candidate, index) =>
        Object.assign({}, candidate, { id: index + 1 }),
      ),
    });
    const runValidateProxyCommand = runtime("runValidateProxyCommand");

    const result = await runValidateProxyCommand([], { CN_REPO: root }, root);
    const report = readReport(root);

    expect(result.exitCode).toBe(0);
    expect(report.rows.map((row) => row.id)).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("writes and prints a malformed-input report", async () => {
    const root = fixtureRoot();
    writeJson(root, ".codenuke/value-proxy.json", {
      candidates: [{ id: "bad", proxy: null, Vhat: 10 }],
    });
    const runValidateProxyCommand = runtime("runValidateProxyCommand");

    const result = await runValidateProxyCommand(
      [],
      { CN_REPO: root, CN_MIN_CANDIDATES: "4" },
      root,
    );
    const report = readReport(root);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(
      "value proxy validation input invalid: candidate bad must include finite proxy and Vhat numbers",
    );
    expect(result.stdout).toContain(`-> ${join(root, ".codenuke/value-proxy-validation.json")}`);
    expect(report).toEqual({
      schemaVersion: 1,
      passed: false,
      reason: "malformed-input",
      candidates: 0,
      minimumCandidates: 4,
      minimumRho: 0.6,
      alpha: 0.05,
      rho: null,
      pValue: null,
      pMethod: null,
      rows: [],
      input: join(root, ".codenuke/value-proxy.json"),
      error: "candidate bad must include finite proxy and Vhat numbers",
    });
  });

  it("fails closed for a validation failure but still publishes the diagnostic report", async () => {
    const root = fixtureRoot();
    writeJson(root, ".codenuke/value-proxy.json", { candidates: monotoneCorpus(3) });
    const runValidateProxyCommand = runtime("runValidateProxyCommand");

    const result = await runValidateProxyCommand([], { CN_REPO: root }, root);
    const report = readReport(root);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(
      "value proxy validation: FAIL rho=n/a p=n/a (alpha=0.05) min=0.6 candidates=3/6",
    );
    expect(result.stdout).toContain("reason: too-small-corpus");
    expect(report).toMatchObject({
      schemaVersion: 1,
      passed: false,
      reason: "too-small-corpus",
      candidates: 3,
      minimumCandidates: 6,
      rho: null,
      pValue: null,
      input: join(root, ".codenuke/value-proxy.json"),
    });
  });
});

function createReport(overrides: Partial<ValidationReport>): ValidationReport {
  return {
    schemaVersion: 1,
    passed: false,
    reason: "too-small-corpus",
    candidates: 0,
    minimumCandidates: 6,
    minimumRho: 0.6,
    alpha: 0.05,
    rho: null,
    pValue: null,
    pMethod: null,
    rows: [],
    input: "/repo/.codenuke/value-proxy.json",
    ...overrides,
  };
}
