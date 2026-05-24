import type { Candidate, PMethod } from "../domain/index.ts";
import { spearmanRho } from "../kernel/index.ts";

export const PERMUTATION_SEED = 0x9e3779b9;
export const PERMUTATION_SAMPLES = 50_000;
export const EXACT_CAP = 362_880;
export const PERMUTATION_EPS = 1e-9;

export const MIN_CANDIDATES = 6;
export const MIN_RHO = 0.6;
export const ALPHA = 0.05;

export interface ValidationOptions {
  readonly minimumCandidates: number;
  readonly minimumRho: number;
  readonly alpha: number;
}

export const DEFAULT_VALIDATION_OPTIONS: ValidationOptions = {
  minimumCandidates: MIN_CANDIDATES,
  minimumRho: MIN_RHO,
  alpha: ALPHA,
};

export interface ValidationReportCore {
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
  readonly pMethod: PMethod | null;
}

export const makePrng = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const factorial = (n: number): number => {
  let f = 1;
  for (let i = 2; i <= n; i += 1) f *= i;
  return f;
};

const forEachPermutation = (n: number, visit: (perm: readonly number[]) => void): void => {
  const arr = Array.from({ length: n }, (_, i) => i);
  const c = new Array<number>(n).fill(0);
  visit(arr);
  let i = 0;
  while (i < n) {
    if (c[i]! < i) {
      const j = i % 2 === 0 ? 0 : c[i]!;
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
      visit(arr);
      c[i] = c[i]! + 1;
      i = 0;
    } else {
      c[i] = 0;
      i += 1;
    }
  }
};

export const pMethodForSize = (n: number): "exact" | "sampled" => {
  let f = 1;
  for (let i = 2; i <= n && f <= EXACT_CAP; i += 1) f *= i;
  return f <= EXACT_CAP ? "exact" : "sampled";
};

export interface PermutationResult {
  readonly p: number;
  readonly method: PMethod;
}

const coreSpearman = (a: readonly number[], b: readonly number[]): number => {
  const r = spearmanRho(a, b);
  return r === null ? Number.NaN : r;
};

export const permutationPValue = (
  proxy: readonly number[],
  negVhat: readonly number[],
  observedRho: number,
  spearman: (a: readonly number[], b: readonly number[]) => number = coreSpearman,
): PermutationResult => {
  if (!Number.isFinite(observedRho)) return { p: 1, method: "degenerate" };
  const n = proxy.length;
  const nFact = factorial(n);

  if (nFact <= EXACT_CAP) {
    let ge = 0;
    const permuted = new Array<number>(n);
    forEachPermutation(n, (perm) => {
      for (let i = 0; i < n; i += 1) permuted[i] = negVhat[perm[i]!]!;
      const rho = spearman(proxy, permuted);
      if (Number.isFinite(rho) && rho >= observedRho - PERMUTATION_EPS) ge += 1;
    });
    return { p: ge / nFact, method: "exact" };
  }

  const rand = makePrng(PERMUTATION_SEED);
  let ge = 1;
  const shuffled = negVhat.slice();
  for (let s = 0; s < PERMUTATION_SAMPLES; s += 1) {
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    const rho = spearman(proxy, shuffled);
    if (Number.isFinite(rho) && rho >= observedRho - PERMUTATION_EPS) ge += 1;
  }
  return { p: ge / (PERMUTATION_SAMPLES + 1), method: "sampled" };
};

export const validateValueProxy = (
  candidates: readonly Candidate[],
  options: ValidationOptions = DEFAULT_VALIDATION_OPTIONS,
  spearman: (a: readonly number[], b: readonly number[]) => number = coreSpearman,
): ValidationReportCore => {
  const { minimumCandidates, minimumRho, alpha } = options;
  const base = {
    candidates: candidates.length,
    minimumCandidates,
    minimumRho,
    alpha,
  };

  if (candidates.length < minimumCandidates) {
    return { ...base, passed: false, reason: "too-small-corpus", rho: null, pValue: null, pMethod: null };
  }

  const proxy = candidates.map((c) => c.proxy);
  const negVhat = candidates.map((c) => -c.Vhat);
  const rho = spearman(proxy, negVhat);

  if (!Number.isFinite(rho)) {
    return {
      ...base,
      passed: false,
      reason: "undefined-rank-correlation",
      rho: null,
      pValue: null,
      pMethod: null,
    };
  }
  if (rho < minimumRho) {
    return { ...base, passed: false, reason: "low-rho", rho, pValue: null, pMethod: null };
  }

  const perm = permutationPValue(proxy, negVhat, rho, spearman);
  if (perm.p > alpha) {
    return { ...base, passed: false, reason: "not-significant", rho, pValue: perm.p, pMethod: perm.method };
  }

  return { ...base, passed: true, reason: null, rho, pValue: perm.p, pMethod: perm.method };
};

