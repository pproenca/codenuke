/**
 * RULE-007 — Mutation operator table & site collection.
 *
 * Pure, AST-agnostic (string/offset based per the BEHAVIOR_CONTRACT acceptance
 * line). `collectSites(source)` scans the source text for known operator flips
 * and emits a `MutationSite` for each — `{ start, end, repl, op }` — where
 * `[start, end)` is the byte range to overwrite with `repl`.
 *
 * The contract's three operator families (BEHAVIOR_CONTRACT RULE-007 ACCEPTANCE):
 *   - equality flip            `===` ↔ `!==`   (and `==` ↔ `!=`)
 *   - string-predicate swap    `.startsWith(` ↔ `.endsWith(`
 *   - boolean-return flip      `return true` ↔ `return false`
 *
 * NOTE: the legacy implementation parses with the TS compiler API and is
 * ScriptKind-aware for `.jsx`/`.tsx` (RULE-007 AND-clause). That AST-precise
 * collection is the effectful, compiler-bound variant and is modeled in the
 * audit service skeleton (audit.ts). This pure string-scan core is what the
 * acceptance test pins and what `sampleSites` (RULE-008) consumes.
 */

/**
 * MutationSite is the cross-package contract type — imported (type-only) from
 * "@codenuke/core" per the contract, NOT redefined. The `import type` is
 * runtime-erased, so this pure module still runs even before core's value
 * exports exist; the structural shape is `{ start, end, repl, op }`.
 */
import type { MutationSite } from "@codenuke/core";
export type { MutationSite };

/**
 * A single operator-table entry: a literal `match` token and the `repl` it
 * flips to, tagged with an `op` label used in the survivor report.
 *
 * Pairs are intentionally listed in *both* directions (=== flips to !== AND
 * !== flips to ===) so any occurrence yields a behavior-changing mutant. The
 * scanner is longest-match-first within a position so `===` wins over `==`.
 */
export interface Operator {
  readonly match: string;
  readonly repl: string;
  readonly op: string;
}

/**
 * The AST-agnostic operator table (RULE-007). Order matters only for the
 * tie-break at a single offset — longer tokens are tried first per position.
 */
export const OPERATORS: readonly Operator[] = [
  // equality flips (strict before loose so `===` is not shadowed by `==`)
  { match: "===", repl: "!==", op: "eq->neq" },
  { match: "!==", repl: "===", op: "neq->eq" },
  { match: "==", repl: "!=", op: "eq->neq" },
  { match: "!=", repl: "==", op: "neq->eq" },
  // string-predicate swaps
  { match: ".startsWith(", repl: ".endsWith(", op: "startsWith->endsWith" },
  { match: ".endsWith(", repl: ".startsWith(", op: "endsWith->startsWith" },
  // boolean-return flips
  { match: "return true", repl: "return false", op: "true->false" },
  { match: "return false", repl: "return true", op: "false->true" },
];

/**
 * Operators sorted by descending token length so a longest-match scan never
 * emits both `===`→`!==` and `==`→`!=` for the same `===` occurrence.
 */
const OPERATORS_BY_LENGTH: readonly Operator[] = [...OPERATORS].sort(
  (a, b) => b.match.length - a.match.length,
);

/**
 * RULE-007 — collect every mutation site in `source`.
 *
 * Pure: walks the string left-to-right, and at each offset tries the operator
 * table (longest token first). On a hit it records a `MutationSite` covering
 * exactly the matched token and advances past it (non-overlapping). Sites are
 * returned in ascending `start` order, which keeps `sampleSites` deterministic.
 */
export const collectSites = (source: string): MutationSite[] => {
  const sites: MutationSite[] = [];
  let i = 0;
  outer: while (i < source.length) {
    for (const op of OPERATORS_BY_LENGTH) {
      if (source.startsWith(op.match, i)) {
        const start = i;
        const end = i + op.match.length;
        sites.push({ start, end, repl: op.repl, op: op.op });
        i = end;
        continue outer;
      }
    }
    i += 1;
  }
  return sites;
};
