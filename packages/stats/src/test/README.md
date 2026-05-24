# Characterization tests — `codenuke/stats`

These tests pin the **observable behavior** of the legacy module
`legacy/codenuke/loop/stats.mjs` so a rewrite can be proven equivalent. They
cover only the two LIVE exports being migrated:

| Export   | Rule          | What it does                                          |
| -------- | ------------- | ----------------------------------------------------- |
| `wilson` | RULE-006 (P0) | Wilson score interval for a binomial proportion `k/n` |
| `ranks`  | RULE-014      | Tie-averaged ranks, preserving input order            |

The legacy module is the **oracle**: every expected value was computed by
running the legacy code, not by reading a spec. If spec and legacy disagree, the
test follows the legacy and the discrepancy is flagged separately.

The other legacy exports (`erf`, `normalCDF`, `mannWhitney`, `aucFromScores`,
`bootstrapAUC`, `permutationAUC`, `bootstrapRatioMedian`, `bootstrapAUCDiff`)
are confirmed dead and are intentionally **not** tested.

## Layout

- `stats.test.ts` imports BOTH:
  - the NEW target — `import { wilson, ranks } from "../main/stats";`
    (implemented to satisfy this contract; written after these tests are
    approved)
  - the LEGACY oracle — for dual-execution differential testing.

## How to run

From the package root (`stats`):

```sh
npm test            # or: npx vitest run
npx vitest          # watch mode
```

> The implementation `src/main/stats.ts` does not exist yet. Until it is
> written the suite fails to resolve `../main/stats` — that is expected; these
> tests are the contract authored first.

## What is covered

- **Exact known cases** — `ranks([10,20,10,30]) -> [1.5,3,1.5,4]`;
  `wilson(0,0) -> {p:0,lo:0,hi:1}`; `wilson(56,60)` ranged + exact-double pins.
- **Fence admissibility (RULE-006, P0)** — `wilson(34,34).lo < 0.90` AND
  `wilson(35,35).lo >= 0.90` (>= 35/35 all-caught required to clear the 0.90 bar).
- **Edge cases** — `n=0`; `k=0` (lo clamped to 0); `k=n` (hi clamped to 1);
  `ranks([])`; single element; all-equal ties; sorted/reverse-sorted; negatives
  and floats.
- **Invariants** — at `n=20`, `0 <= lo <= p <= hi <= 1` and `lo` monotonic
  non-decreasing in `k`.
- **Dual-execution equivalence** — ~1000 seeded-random `(k,n)` pairs
  (`0 <= k <= n <= 200`) compared field-by-field within `1e-12`, plus an
  exhaustive `n=0..50` grid; ~500 seeded-random arrays (length 0..50, with
  duplicates) compared by exact deep-equality.

Randomness is seeded via an inline `mulberry32`, so runs are reproducible.

## How to add a new case

1. Compute the expected value from the **legacy** module (the oracle):

   ```sh
   node --input-type=module -e '
     import { wilson, ranks } from "./legacy/codenuke/loop/stats.mjs";
     console.log(JSON.stringify(wilson(7, 9)));
   '
   ```

2. Add an `it(...)` inside the matching `describe` block in `stats.test.ts`
   with a behavioral name (reads as a specification) and the literal expected
   value.
3. For floating-point fields prefer `toBeCloseTo(value, 15)`; reserve `toBe`
   for values that are exactly representable (e.g. `p === 0.5`, clamps to
   `0`/`1`).
4. If the new behavior is not yet implemented in the target, mark it
   `it.todo(...)` / `it.skip(... "pending RULE-NNN")` rather than deleting it.
