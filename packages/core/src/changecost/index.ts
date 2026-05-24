export const DEFAULT_BETA = 60;

export const tokenize = (source: string): string[] =>
  source.match(/[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|[^\s]/gu) ?? [];

export const lcsLength = (a: readonly string[], b: readonly string[]): number => {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return 0;
  let prev = new Array<number>(m + 1).fill(0);
  let curr = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, curr[j - 1]!);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
    curr.fill(0);
  }
  return prev[m]!;
};

export const editSize = (a: readonly string[], b: readonly string[]): number => {
  const lcs = lcsLength(a, b);
  return a.length - lcs + (b.length - lcs);
};

export interface PerFileEdit {
  readonly rel: string;
  readonly before: readonly string[];
  readonly after: readonly string[];
}

export const editTokensOf = (files: readonly PerFileEdit[]): number =>
  files.reduce((sum, file) => sum + editSize(file.before, file.after), 0);

export interface FenceRegions {
  readonly [region: string]: { readonly p?: number } | undefined;
}

export const fidelityOf = (fence: FenceRegions, region: string): number =>
  typeof fence[region]?.p === "number" ? fence[region]!.p! : 0;

export const verifyFrac = (regions: readonly string[], fence: FenceRegions): number => {
  if (regions.length === 0) return 0;
  let sum = 0;
  for (const region of regions) sum += 1 - fidelityOf(fence, region);
  return sum / regions.length;
};

export const costOf = (
  editTokens: number,
  verificationFraction: number,
  beta: number = DEFAULT_BETA,
): number => editTokens + beta * verificationFraction;

export const vhatOf = (doneCosts: readonly number[]): number | null => {
  if (doneCosts.length === 0) return null;
  return doneCosts.reduce((a, b) => a + b, 0) / doneCosts.length;
};

