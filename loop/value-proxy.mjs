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
