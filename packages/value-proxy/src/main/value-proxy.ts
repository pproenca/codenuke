/**
 * Value-proxy validation: does the cheap inner-loop proxy actually predict the
 * expensive change-cost ground truth (𝒱̂)? Gates whether long unattended runs
 * may trust the proxy.
 *
 * Migrated from `legacy/codenuke/loop/value-proxy.mjs` (the pure core). The file
 * I/O + process glue is implemented as a thin adapter over the pure
 * {@link runValidation} core.
 *
 * @see analysis/codenuke/BUSINESS_RULES.md — RULE-024, RULE-027, RULE-028, RULE-029
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadConfig } from "@codenuke/config";
import { type PermutationOptions, spearmanPValue, spearmanRho } from "./spearman.js";

/** A scored candidate: the cheap `proxy` vs the expensive ground-truth `Vhat`. Extra fields are preserved. */
export interface Candidate {
  id: string;
  proxy: number;
  Vhat: number;
  [key: string]: unknown;
}

/** Thresholds for {@link validateValueProxy}, plus pass-through permutation options. */
export type ValidateOptions = {
  /** Minimum acceptable effect size ρ. Default `0.6` (RULE-028). */
  readonly minimumRho?: number;
  /** Minimum corpus size. Default `6` (AI-native HITL decision for RULE-027). */
  readonly minimumCandidates?: number;
  /** Significance level. Default `0.05` (RULE-029). */
  readonly alpha?: number;
} & PermutationOptions;

/** Environment view (process.env-shaped) for {@link parseValidationOptions}. */
export type Env = Record<string, string | undefined>;

/** Why a validation failed; `null` when it passed. */
export type ValidationFailure =
  | "too-small-corpus"
  | "undefined-rank-correlation"
  | "low-rho"
  | "not-significant"
  | "invalid-config"
  | "malformed-input";

/** The validation verdict. Mirrors the JSON the legacy CLI wrote to disk. */
export interface ValidationReport {
  readonly passed: boolean;
  readonly reason: ValidationFailure | null;
  readonly candidates: number;
  readonly minimumCandidates: number;
  readonly minimumRho: number;
  readonly alpha: number;
  readonly rho: number | null;
  readonly pValue: number | null;
  readonly pMethod: "exact" | "sampled" | "degenerate" | null;
  readonly rows: readonly Candidate[];
  /** Present only on `invalid-config` / `malformed-input`. */
  readonly error?: string;
}

export interface ValueProxyValidationArtifact extends ValidationReport {
  readonly schemaVersion: 1;
  readonly input: string;
}

export interface ValidateProxyCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ValidateProxyCommandOptions {
  readonly reporter?: { emit(line: string): void };
}

const finiteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function candidateId(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return `${value}`;
  }
  return fallback;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Validate that the proxy ranks candidates the same way change-cost does
 * (RULE-027/028/029). Lexicographic: corpus size, then a finite ρ, then effect
 * size `ρ ≥ minimumRho`, then significance `p ≤ alpha`. Fails closed.
 */
export function validateValueProxy(
  candidates: Candidate[],
  options: ValidateOptions = {},
): ValidationReport {
  const minimumRho = options.minimumRho ?? 0.6;
  const minimumCandidates = options.minimumCandidates ?? 6;
  const alpha = options.alpha ?? 0.05;
  const base = { candidates: candidates.length, minimumCandidates, minimumRho, alpha };

  if (candidates.length < minimumCandidates) {
    return {
      passed: false,
      reason: "too-small-corpus",
      ...base,
      rho: null,
      pValue: null,
      pMethod: null,
      rows: candidates,
    };
  }

  const proxy = candidates.map((candidate) => candidate.proxy);
  const negVhat = candidates.map((candidate) => -candidate.Vhat);
  const rho = spearmanRho(proxy, negVhat);
  if (!Number.isFinite(rho)) {
    return {
      passed: false,
      reason: "undefined-rank-correlation",
      ...base,
      rho: null,
      pValue: null,
      pMethod: null,
      rows: candidates,
    };
  }

  const { p: pValue, method: pMethod } = spearmanPValue(proxy, negVhat, options);
  // Effect size AND significance: a strong ρ on too few candidates (the n=3 trap) is not evidence.
  const reason: ValidationFailure | null =
    rho < minimumRho ? "low-rho" : pValue > alpha ? "not-significant" : null;
  return { passed: reason === null, reason, ...base, rho, pValue, pMethod, rows: candidates };
}

/**
 * Resolve validation thresholds from environment variables, with the documented
 * defaults and bounds (RULE-024 config contract). Throws on out-of-range values.
 */
export function parseValidationOptions(env: Env): {
  minimumRho: number;
  minimumCandidates: number;
  alpha: number;
} {
  const minimumRho = env.CN_MIN_RHO == null ? 0.6 : Number(env.CN_MIN_RHO);
  const minimumCandidates = env.CN_MIN_CANDIDATES == null ? 6 : Number(env.CN_MIN_CANDIDATES);
  const alpha = env.CN_ALPHA == null ? 0.05 : Number(env.CN_ALPHA);

  if (!Number.isFinite(minimumRho) || minimumRho < -1 || minimumRho > 1) {
    throw new Error("CN_MIN_RHO must be a finite number between -1 and 1");
  }
  if (!Number.isInteger(minimumCandidates) || minimumCandidates < 2) {
    throw new Error("CN_MIN_CANDIDATES must be an integer >= 2");
  }
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha > 1) {
    throw new Error("CN_ALPHA must be a finite number in (0, 1]");
  }

  return { minimumRho, minimumCandidates, alpha };
}

/**
 * Normalize already-parsed candidate JSON (a bare array or `{ candidates: [...] }`)
 * into validated {@link Candidate} rows. Defaults a missing `id`; throws on a
 * non-finite `proxy`/`Vhat`. Operates on parsed JSON — no file I/O.
 */
export function parseCandidates(parsed: unknown): Candidate[] {
  const rows = Array.isArray(parsed)
    ? parsed
    : (parsed as { candidates?: unknown } | null)?.candidates;
  if (!Array.isArray(rows)) {
    throw new Error("expected an array or { candidates: [...] }");
  }

  return rows.map((row, index) => {
    const record = (row ?? {}) as Record<string, unknown>;
    const id = candidateId(record.id, `candidate-${index + 1}`);
    if (id.length === 0) {
      throw new Error(`candidate ${index + 1} must include a non-empty id`);
    }
    if (!finiteNumber(record.proxy) || !finiteNumber(record.Vhat)) {
      throw new Error(`candidate ${id} must include finite proxy and Vhat numbers`);
    }
    return Object.assign({}, record, { id }) as Candidate;
  });
}

/**
 * Pure orchestrator: resolve env options, parse candidates, then validate —
 * returning the `invalid-config` / `malformed-input` report variants instead of
 * exiting the process. Config is resolved before input, so a config error wins.
 * Never throws and never touches the filesystem.
 */
export function runValidation(parsedInput: unknown, env: Env): ValidationReport {
  let options: ReturnType<typeof parseValidationOptions>;
  try {
    options = parseValidationOptions(env);
  } catch (error) {
    return {
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
      error: messageOf(error),
    };
  }

  let candidates: Candidate[];
  try {
    candidates = parseCandidates(parsedInput);
  } catch (error) {
    return {
      passed: false,
      reason: "malformed-input",
      candidates: 0,
      minimumCandidates: options.minimumCandidates,
      minimumRho: options.minimumRho,
      alpha: options.alpha,
      rho: null,
      pValue: null,
      pMethod: null,
      rows: [],
      error: messageOf(error),
    };
  }

  return validateValueProxy(candidates, options);
}

export const defaultValueProxyInputPath = (repo: string): string =>
  `${repo}/.codenuke/value-proxy.json`;

export const valueProxyValidationOutputPath = (repo: string): string =>
  `${repo}/.codenuke/value-proxy-validation.json`;

export function createValueProxyValidationArtifact(input: {
  readonly report: ValidationReport;
  readonly inputPath: string;
}): ValueProxyValidationArtifact {
  return {
    schemaVersion: 1,
    ...input.report,
    input: input.inputPath,
  };
}

export function formatValueProxyValidationSummary(report: ValidationReport): string {
  const rho = report.rho == null ? "n/a" : report.rho.toFixed(3);
  const pValue = report.pValue == null ? "n/a" : report.pValue.toFixed(3);
  return `value proxy validation: ${report.passed ? "PASS" : "FAIL"} rho=${rho} p=${pValue} (alpha=${report.alpha}) min=${report.minimumRho} candidates=${report.candidates}/${report.minimumCandidates}`;
}

const ensureParent = (path: string): void => {
  const parent = path.split("/").slice(0, -1).join("/");
  if (parent) {
    mkdirSync(parent, { recursive: true });
  }
};

function writeReport(path: string, report: ValueProxyValidationArtifact): void {
  ensureParent(path);
  writeFileSync(path, JSON.stringify(report, null, 2));
}

export async function runValidateProxyCommand(
  args: readonly string[] = [],
  env: Env = process.env,
  cwd = process.cwd(),
  options: ValidateProxyCommandOptions = {},
): Promise<ValidateProxyCommandResult> {
  options.reporter?.emit("validate-proxy: resolving config");
  const config = loadConfig(env, cwd);
  const inputPath = args[0] ?? defaultValueProxyInputPath(config.repo);
  const outputPath = valueProxyValidationOutputPath(config.repo);
  const out: string[] = [];

  if (!existsSync(inputPath)) {
    out.push(
      `value proxy candidates missing at ${inputPath}; write candidate rows with {id, proxy, Vhat} from score/changecost runs first.`,
    );
    for (const line of out) {
      options.reporter?.emit(line);
    }
    return { exitCode: 1, stdout: `${out.join("\n")}\n`, stderr: "" };
  }

  options.reporter?.emit("validate-proxy: validating configuration");
  const optionsReport = runValidation([], env);
  if (optionsReport.reason === "invalid-config") {
    const report = createValueProxyValidationArtifact({ inputPath, report: optionsReport });
    writeReport(outputPath, report);
    out.push(`value proxy validation config invalid: ${report.error}`);
    out.push(`-> ${outputPath}`);
    for (const line of out) {
      options.reporter?.emit(line);
    }
    return { exitCode: 1, stdout: `${out.join("\n")}\n`, stderr: "" };
  }

  let parsed: unknown;
  try {
    options.reporter?.emit(`validate-proxy: reading candidates from ${inputPath}`);
    parsed = JSON.parse(readFileSync(inputPath, "utf8"));
  } catch (error) {
    const report = createValueProxyValidationArtifact({
      inputPath,
      report: {
        passed: false,
        reason: "malformed-input",
        candidates: 0,
        minimumCandidates: optionsReport.minimumCandidates,
        minimumRho: optionsReport.minimumRho,
        alpha: optionsReport.alpha,
        rho: null,
        pValue: null,
        pMethod: null,
        rows: [],
        error: messageOf(error),
      },
    });
    writeReport(outputPath, report);
    out.push(`value proxy validation input invalid: ${report.error}`);
    out.push(`-> ${outputPath}`);
    for (const line of out) {
      options.reporter?.emit(line);
    }
    return { exitCode: 1, stdout: `${out.join("\n")}\n`, stderr: "" };
  }

  options.reporter?.emit("validate-proxy: computing rank correlation");
  const report = createValueProxyValidationArtifact({
    inputPath,
    report: runValidation(parsed, env),
  });
  options.reporter?.emit("validate-proxy: writing validation artifact");
  writeReport(outputPath, report);

  if (report.reason === "invalid-config") {
    out.push(`value proxy validation config invalid: ${report.error}`);
  } else if (report.reason === "malformed-input") {
    out.push(`value proxy validation input invalid: ${report.error}`);
  } else {
    out.push(formatValueProxyValidationSummary(report));
    if (!report.passed && report.reason) {
      out.push(`reason: ${report.reason}`);
    }
  }
  out.push(`-> ${outputPath}`);
  for (const line of out) {
    options.reporter?.emit(line);
  }
  return { exitCode: report.passed ? 0 : 1, stdout: `${out.join("\n")}\n`, stderr: "" };
}
