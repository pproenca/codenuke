import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadConfig } from "./config.mjs";

function ranks(values) {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranked = Array.from({ length: values.length });
  let cursor = 0;
  while (cursor < sorted.length) {
    let end = cursor;
    while (end + 1 < sorted.length && sorted[end + 1].value === sorted[cursor].value) end++;
    const rank = (cursor + end) / 2 + 1;
    for (let index = cursor; index <= end; index++) ranked[sorted[index].index] = rank;
    cursor = end + 1;
  }
  return ranked;
}

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
  return {
    passed: Number.isFinite(rho) && rho >= minimumRho,
    reason: Number.isFinite(rho) ? null : "undefined-rank-correlation",
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
    const proxy = Number(row.proxy);
    const Vhat = Number(row.Vhat);
    if (!Number.isFinite(proxy) || !Number.isFinite(Vhat)) {
      throw new Error(`candidate ${id} must include finite proxy and Vhat numbers`);
    }
    return { ...row, id, proxy, Vhat };
  });
}

function ensureParent(path) {
  mkdirSync(path.split("/").slice(0, -1).join("/"), { recursive: true });
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
  try {
    report = validateValueProxy(readCandidates(input), {
      minimumRho: Number(process.env.CN_MIN_RHO ?? 0.6),
      minimumCandidates: Number(process.env.CN_MIN_CANDIDATES ?? 3),
    });
  } catch (error) {
    console.log(`value proxy validation input invalid: ${error.message}`);
    process.exit(1);
  }

  ensureParent(output);
  writeFileSync(output, JSON.stringify({ ...report, input }, null, 2));
  const rho = report.rho == null ? "n/a" : report.rho.toFixed(3);
  console.log(
    `value proxy validation: ${report.passed ? "PASS" : "FAIL"} rho=${rho} min=${report.minimumRho} candidates=${report.candidates}/${report.minimumCandidates}`,
  );
  if (!report.passed && report.reason) console.log(`reason: ${report.reason}`);
  console.log(`-> ${output}`);
  process.exit(report.passed ? 0 : 1);
}
