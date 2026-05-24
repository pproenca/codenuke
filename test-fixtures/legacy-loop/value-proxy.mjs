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

const factorial = (n) => {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
};

// mulberry32: a tiny seeded PRNG so the sampled permutation test stays deterministic (INV-5).
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function* permute(arr) {
  if (arr.length <= 1) {
    yield arr;
    return;
  }
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const tail of permute(rest)) yield [arr[i], ...tail];
  }
}

// One-sided permutation test for H1: positive rank correlation (higher proxy ranks with lower
// Vhat). Exact enumeration when n! is small (≤ exactCap, default 9! so n≤9 is exact); otherwise a
// fixed-seed sample with add-one smoothing. n=3 can never beat α=0.05 — even a perfect ρ=1 gives
// p = 1/3! ≈ 0.167 — which is the whole point: a 3-candidate "PASS" is statistically vacuous.
export function spearmanPValue(left, right, options = {}) {
  const n = left.length;
  if (n !== right.length) throw new Error("spearman inputs must have equal length");
  const observed = spearmanRho(left, right);
  if (!Number.isFinite(observed)) return { p: 1, method: "degenerate", permutations: 0 };
  const eps = 1e-9;
  const exactCap = options.exactCap ?? 362880; // 9!
  const total = factorial(n);
  if (total <= exactCap) {
    let ge = 0;
    let count = 0;
    for (const perm of permute(right)) {
      if (spearmanRho(left, perm) >= observed - eps) ge++;
      count++;
    }
    return { p: ge / count, method: "exact", permutations: count };
  }
  const draws = options.samples ?? 50000;
  const rng = mulberry32(options.seed ?? 0x9e3779b9);
  const pool = [...right];
  let ge = 1; // include the observed arrangement (add-one smoothing → never reports p = 0)
  for (let s = 0; s < draws; s++) {
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    if (spearmanRho(left, pool) >= observed - eps) ge++;
  }
  return { p: ge / (draws + 1), method: "sampled", permutations: draws };
}

export function validateValueProxy(candidates, options = {}) {
  const minimumRho = options.minimumRho ?? 0.6;
  const minimumCandidates = options.minimumCandidates ?? 3;
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
  const reason = rho < minimumRho ? "low-rho" : pValue > alpha ? "not-significant" : null;
  return { passed: reason === null, reason, ...base, rho, pValue, pMethod, rows: candidates };
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
  const alpha = env.CN_ALPHA == null ? 0.05 : Number(env.CN_ALPHA);
  if (!Number.isFinite(minimumRho) || minimumRho < -1 || minimumRho > 1)
    throw new Error("CN_MIN_RHO must be a finite number between -1 and 1");
  if (!Number.isInteger(minimumCandidates) || minimumCandidates < 2)
    throw new Error("CN_MIN_CANDIDATES must be an integer >= 2");
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha > 1)
    throw new Error("CN_ALPHA must be a finite number in (0, 1]");
  return { minimumRho, minimumCandidates, alpha };
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
      alpha: 0.05,
      rho: null,
      pValue: null,
      pMethod: null,
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
      alpha: options.alpha,
      rho: null,
      pValue: null,
      pMethod: null,
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
  const pValue = report.pValue == null ? "n/a" : report.pValue.toFixed(3);
  console.log(
    `value proxy validation: ${report.passed ? "PASS" : "FAIL"} rho=${rho} p=${pValue} (alpha=${report.alpha}) min=${report.minimumRho} candidates=${report.candidates}/${report.minimumCandidates}`,
  );
  if (!report.passed && report.reason) console.log(`reason: ${report.reason}`);
  console.log(`-> ${output}`);
  process.exit(report.passed ? 0 : 1);
}
