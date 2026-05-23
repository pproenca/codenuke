import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadConfig } from "./config.mjs";
import { finiteNumber } from "./guards.mjs";
import { ranks } from "./stats.mjs";

function pearson(left, right) {
  const n = left.length;
  const meanLeft = left.reduce((sum, value) => sum + value, 0) / n;
  const meanRight = right.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let leftSquares = 0;
  let rightSquares = 0;
  for (let index = 0; index < n; index++) {
    const leftDelta = left[index] - meanLeft;
    const rightDelta = right[index] - meanRight;
    numerator += leftDelta * rightDelta;
    leftSquares += leftDelta * leftDelta;
    rightSquares += rightDelta * rightDelta;
  }
  const denominator = Math.sqrt(leftSquares * rightSquares);
  return denominator === 0 ? NaN : numerator / denominator;
}

export function spearmanRho(left, right) {
  if (left.length !== right.length) throw new Error("spearman inputs must have equal length");
  if (left.length < 2) return NaN;
  return pearson(ranks(left), ranks(right));
}

export function validateValueProxy(candidates, options = {}) {
  const minimumRho = options.minimumRho ?? 0.6;
  const minimumCandidates = options.minimumCandidates ?? 3;
  if (candidates.length < minimumCandidates) {
    return {
      passed: false,
      reason: "too-small-corpus",
      candidates: candidates.length,
      minimumCandidates,
      minimumRho,
      rho: null,
      rows: candidates,
    };
  }
  const rho = spearmanRho(
    candidates.map((candidate) => candidate.proxy),
    candidates.map((candidate) => -candidate.Vhat),
  );
  const passed = Number.isFinite(rho) && rho >= minimumRho;
  return {
    passed,
    reason: passed ? null : Number.isFinite(rho) ? "low-rho" : "undefined-rank-correlation",
    candidates: candidates.length,
    minimumCandidates,
    minimumRho,
    rho,
    rows: candidates,
  };
}

function readCandidates(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  const rows = Array.isArray(parsed) ? parsed : parsed.candidates;
  if (!Array.isArray(rows)) throw new Error("expected an array or { candidates: [...] }");
  return rows.map((row, index) => {
    const id = row.id ?? `candidate-${index + 1}`;
    if (!finiteNumber(row.proxy) || !finiteNumber(row.Vhat)) {
      throw new Error(`candidate ${id} must include finite proxy and Vhat numbers`);
    }
    return { ...row, id };
  });
}

function ensureParent(path) {
  mkdirSync(path.split("/").slice(0, -1).join("/"), { recursive: true });
}

function writeReport(path, report) {
  ensureParent(path);
  writeFileSync(path, JSON.stringify(report, null, 2));
}

function validationOptionsFromEnv(env) {
  const minimumRho = env.CN_MIN_RHO == null ? 0.6 : Number(env.CN_MIN_RHO);
  const minimumCandidates = env.CN_MIN_CANDIDATES == null ? 3 : Number(env.CN_MIN_CANDIDATES);
  if (!Number.isFinite(minimumRho) || minimumRho < -1 || minimumRho > 1)
    throw new Error("CN_MIN_RHO must be a finite number between -1 and 1");
  if (!Number.isInteger(minimumCandidates) || minimumCandidates < 2)
    throw new Error("CN_MIN_CANDIDATES must be an integer >= 2");
  return { minimumRho, minimumCandidates };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const C = loadConfig();
  const input = process.argv[2] || `${C.repo}/.codenuke/value-proxy.json`;
  const output = `${C.repo}/.codenuke/value-proxy-validation.json`;
  if (!existsSync(input)) {
    console.log(
      `value proxy candidates missing at ${input}; write candidate rows with {id, proxy, Vhat} from score/changecost runs first.`,
    );
    process.exit(1);
  }

  let report;
  let options;
  try {
    options = validationOptionsFromEnv(process.env);
  } catch (error) {
    report = {
      passed: false,
      reason: "invalid-config",
      candidates: 0,
      minimumCandidates: 3,
      minimumRho: 0.6,
      rho: null,
      rows: [],
      input,
      error: error.message,
    };
    writeReport(output, report);
    console.log(`value proxy validation config invalid: ${error.message}`);
    console.log(`-> ${output}`);
    process.exit(1);
  }
  try {
    report = validateValueProxy(readCandidates(input), options);
  } catch (error) {
    report = {
      passed: false,
      reason: "malformed-input",
      candidates: 0,
      minimumCandidates: options.minimumCandidates,
      minimumRho: options.minimumRho,
      rho: null,
      rows: [],
      input,
      error: error.message,
    };
    writeReport(output, report);
    console.log(`value proxy validation input invalid: ${error.message}`);
    console.log(`-> ${output}`);
    process.exit(1);
  }

  writeReport(output, { ...report, input });
  const rho = report.rho == null ? "n/a" : report.rho.toFixed(3);
  console.log(
    `value proxy validation: ${report.passed ? "PASS" : "FAIL"} rho=${rho} min=${report.minimumRho} candidates=${report.candidates}/${report.minimumCandidates}`,
  );
  if (!report.passed && report.reason) console.log(`reason: ${report.reason}`);
  console.log(`-> ${output}`);
  process.exit(report.passed ? 0 : 1);
}
