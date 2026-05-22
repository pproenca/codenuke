// Statistical primitives for the metric's significance instruments.
// Implemented from standard formulas (Abramowitz-Stegun erf; Mann-Whitney with tie
// correction; Wilson score interval; percentile bootstrap; permutation test).

// erf via Abramowitz & Stegun 7.1.26
export function erf(x) {
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return s * y;
}
export const normalCDF = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

// Wilson score interval for a binomial proportion k/n
export function wilson(k, n, z = 1.96) {
  if (n === 0) return { p: 0, lo: 0, hi: 1 };
  const p = k / n,
    z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { p, lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

function ranks(values) {
  const idx = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(values.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

// Mann-Whitney U (two-sided, tie-corrected normal approx). auc = P(a > b).
export function mannWhitney(a, b) {
  const n1 = a.length,
    n2 = b.length,
    n = n1 + n2;
  if (n1 === 0 || n2 === 0) return { auc: NaN, z: NaN, p: NaN, n1, n2 };
  const all = [...a, ...b];
  const r = ranks(all);
  const R1 = a.reduce((s, _, i) => s + r[i], 0);
  const U1 = R1 - (n1 * (n1 + 1)) / 2;
  const mu = (n1 * n2) / 2;
  const counts = new Map();
  for (const v of all) counts.set(v, (counts.get(v) ?? 0) + 1);
  let tie = 0;
  for (const t of counts.values()) tie += t * t * t - t;
  const sigma = Math.sqrt(((n1 * n2) / 12) * (n + 1 - tie / (n * (n - 1))));
  const z = sigma > 0 ? (U1 - mu) / sigma : 0;
  return {
    U1,
    auc: U1 / (n1 * n2),
    z,
    p: 2 * (1 - normalCDF(Math.abs(z))),
    rankBiserial: 2 * (U1 / (n1 * n2)) - 1,
    n1,
    n2,
  };
}

const quantile = (sorted, q) => {
  const pos = (sorted.length - 1) * q,
    lo = Math.floor(pos),
    hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};
const sample = (arr) => arr[(Math.random() * arr.length) | 0];

// AUC of scores predicting binary labels (1/0), via Mann-Whitney.
export function aucFromScores(scores, labels) {
  const pos = scores.filter((_, i) => labels[i] === 1);
  const neg = scores.filter((_, i) => labels[i] === 0);
  return mannWhitney(pos, neg).auc;
}

// percentile bootstrap CI for AUC (resample cases)
export function bootstrapAUC(scores, labels, B = 2000) {
  const n = scores.length,
    aucs = [];
  for (let b = 0; b < B; b++) {
    const s = [],
      l = [];
    for (let i = 0; i < n; i++) {
      const j = (Math.random() * n) | 0;
      s.push(scores[j]);
      l.push(labels[j]);
    }
    if (l.includes(1) && l.includes(0)) aucs.push(aucFromScores(s, l));
  }
  aucs.sort((a, b) => a - b);
  return { lo: quantile(aucs, 0.025), hi: quantile(aucs, 0.975) };
}

// permutation p-value: H1 AUC > 0.5 (one-sided). Shuffle labels.
export function permutationAUC(scores, labels, B = 5000) {
  const obs = aucFromScores(scores, labels);
  const shuffled = [...labels];
  let ge = 0;
  for (let b = 0; b < B; b++) {
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    if (aucFromScores(scores, shuffled) >= obs) ge++;
  }
  return { obs, p: (ge + 1) / (B + 1) };
}

// bootstrap CI for ratio of medians median(a)/median(b)
export function bootstrapRatioMedian(a, b, B = 5000) {
  const med = (xs) =>
    quantile(
      [...xs].sort((x, y) => x - y),
      0.5,
    );
  const r = [];
  for (let i = 0; i < B; i++) {
    const aa = a.map(() => sample(a)),
      bb = b.map(() => sample(b));
    const mb = med(bb);
    if (mb !== 0) r.push(med(aa) / mb);
  }
  r.sort((x, y) => x - y);
  return { ratio: med(a) / med(b), lo: quantile(r, 0.025), hi: quantile(r, 0.975) };
}

// bootstrap CI for difference of two paired AUCs (same cases, two score vectors)
export function bootstrapAUCDiff(scoresA, scoresB, labels, B = 2000) {
  const n = labels.length,
    diffs = [];
  for (let b = 0; b < B; b++) {
    const sa = [],
      sb = [],
      l = [];
    for (let i = 0; i < n; i++) {
      const j = (Math.random() * n) | 0;
      sa.push(scoresA[j]);
      sb.push(scoresB[j]);
      l.push(labels[j]);
    }
    if (l.includes(1) && l.includes(0)) diffs.push(aucFromScores(sa, l) - aucFromScores(sb, l));
  }
  diffs.sort((x, y) => x - y);
  return {
    diff: aucFromScores(scoresA, labels) - aucFromScores(scoresB, labels),
    lo: quantile(diffs, 0.025),
    hi: quantile(diffs, 0.975),
  };
}
