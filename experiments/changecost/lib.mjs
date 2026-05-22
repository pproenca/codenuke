// evaluate_changecost — the refactoring analog of evaluate_bpb (THEORY.md).
//
// The objective is 𝒱(C) = 𝔼_{δ~𝒟}[K(C_δ|C)] — the conditional codelength of the next
// version given this one. We estimate K(C_δ|C) by the *realized edit size* of a correct
// implementation of δ on C (a computable upper bound on K, exactly as cross-entropy ≥
// entropy). Edit size is measured on the AST TOKEN stream, so it is invariant to
// formatting and comments (METRIC.md P1) — a rename or reindent is not an "edit".
//
// cost(δ,C) = edit(δ,C) + β·verify(δ,C)
//   edit   = token-level diff size (insertions+deletions) of non-test src, C → C_δ
//   verify = 1 − fence-fidelity of the regions δ touched (safer = cheaper to verify)

import ts from "typescript";

// Formatting/comment-invariant token stream via the TS parser (leaf tokens only).
export function tokenize(name, text) {
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, /\.tsx$/.test(name) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const toks = [];
  (function walk(node) {
    const kids = node.getChildren(sf);
    if (kids.length === 0) { const t = node.getText(sf); if (t !== "") toks.push(t); }
    else for (const k of kids) walk(k);
  })(sf);
  return toks;
}

// LCS-based edit size between two token arrays = deletions + insertions (rolling DP).
export function lcsEditSize(a, b) {
  const n = a.length, m = b.length;
  if (n === 0) return m;
  if (m === 0) return n;
  let prev = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    const cur = new Array(m + 1).fill(0);
    const ai = a[i - 1];
    for (let j = 1; j <= m; j++) cur[j] = ai === b[j - 1] ? prev[j - 1] + 1 : (prev[j] >= cur[j - 1] ? prev[j] : cur[j - 1]);
    prev = cur;
  }
  const lcs = prev[m];
  return (n - lcs) + (m - lcs);
}

// Edit size between two file maps {relpath: text}. Only non-test src counts.
const isCountedSrc = (p) => /^src\/.*\.(ts|tsx)$/.test(p) && !/\.d\.ts$/.test(p) && !/\.(test|spec|accept)\./.test(p);
export function editCost(beforeMap, afterMap) {
  const files = new Set([...Object.keys(beforeMap), ...Object.keys(afterMap)].filter(isCountedSrc));
  let tokens = 0, touched = 0;
  const perFile = {};
  for (const f of files) {
    if (beforeMap[f] === afterMap[f]) continue; // identical text ⇒ 0 (skip O(n²) LCS)
    const a = beforeMap[f] != null ? tokenize(f, beforeMap[f]) : [];
    const b = afterMap[f] != null ? tokenize(f, afterMap[f]) : [];
    const d = lcsEditSize(a, b);
    if (d > 0) { perFile[f] = d; touched++; tokens += d; }
  }
  return { tokens, filesTouched: touched, perFile };
}

// verify cost: how hard the change was to trust = 1 − fence fidelity of touched regions.
// Unmeasured region ⇒ 1 (fail closed). regions = set of region slugs the change touched.
export function verifyCost(touchedRegions, fenceArtifact, beta = 1.0) {
  if (touchedRegions.length === 0) return 0;
  const fidelityOf = (r) => fenceArtifact?.regions?.[r]?.p ?? 0; // p = mutation score
  const mean = touchedRegions.reduce((s, r) => s + (1 - fidelityOf(r)), 0) / touchedRegions.length;
  return beta * mean;
}

export const regionOf = (p) => p.replace(/^src\//, "").split("/")[0];
