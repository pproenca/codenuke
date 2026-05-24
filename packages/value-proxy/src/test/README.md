# Characterization tests — `codenuke/value-proxy`

These tests pin the **observable behavior** of the legacy module
`legacy/codenuke/loop/value-proxy.mjs` so the rewrite can be proven equivalent.
This is the **second strangler-fig slice** (the first, `@codenuke/stats`, is
already migrated; this module reuses its `ranks`).

The legacy module is the **oracle**: every literal expected value was computed
by _running the legacy code_, not by reading a spec. If spec and legacy ever
disagree, the test follows the legacy and the discrepancy is flagged separately.

## Rules under test

| Symbol                   | Rule(s)          | What it does                                                             |
| ------------------------ | ---------------- | ------------------------------------------------------------------------ |
| `spearmanRho`            | RULE-014         | Rank correlation via tie-averaged `ranks` (Pearson on ranks)             |
| `spearmanPValue`         | RULE-015         | One-sided permutation test: `exact` \| `sampled` \| `degenerate`         |
| `validateValueProxy`     | RULE-027/028/029 | Effect-size + significance + corpus-size gate -> validation report       |
| `parseValidationOptions` | RULE-029         | Mirrors legacy `validationOptionsFromEnv` (defaults + bound checks)      |
| `parseCandidates`        | RULE-029         | Mirrors legacy `readCandidates` on ALREADY-PARSED JSON (no file I/O)     |
| `runValidation`          | RULE-027/028/029 | Pure orchestrator: returns `invalid-config` / `malformed-input` variants |

## Imports — new target AND legacy oracle

`value-proxy.test.ts` imports BOTH:

- the **NEW target** (implemented to satisfy this contract, written after the
  tests are approved):
  - `import { spearmanRho, spearmanPValue } from "../main/spearman";`
  - `import { validateValueProxy, parseValidationOptions, parseCandidates, runValidation } from "../main/value-proxy";`
- the **LEGACY oracle** for dual-execution differential testing:
  - `import { spearmanRho as legacySpearmanRho, spearmanPValue as legacySpearmanPValue, validateValueProxy as legacyValidateValueProxy } from "../../../../test-fixtures/legacy-loop/value-proxy.mjs";`

> The legacy file exports **only** those three functions.
> `parseValidationOptions` / `parseCandidates` / `runValidation` have **no**
> legacy export — they are characterized from the legacy private logic
> (`validationOptionsFromEnv`, `readCandidates`) and the CLI `if (import.meta…)`
> block (which builds the `invalid-config` / `malformed-input` report shapes).

## How to run

From the package root (`value-proxy`):

```sh
npm test            # or: npx vitest run
npx vitest          # watch mode
```

> The implementations `src/main/spearman.ts` and `src/main/value-proxy.ts` do
> not exist yet. Until they are written the suite fails to resolve `../main/*` —
> that is expected; these tests are the contract authored first.

## What is covered

- **Carried forward** — every assertion from the legacy
  `value-proxy.test.mjs`, including its five CLI (`spawnSync`) scenarios, which
  are re-expressed as `runValidation` cases asserting the same report fields the
  legacy CLI wrote to `value-proxy-validation.json` (no process spawn, no FS).
- **spearmanRho (RULE-014)** — exact ρ=1 / ρ=-1, tie-averaged ρ; `length < 2`
  -> `NaN`; unequal lengths -> throws the legacy message; zero-variance
  (degenerate) -> `NaN`.
- **spearmanPValue (RULE-015)** — exact path with the documented n=3 vacuity
  (even ρ=1 gives p = 1/6, `method: "exact"`) and the n=8 exact boundary;
  degenerate path (`{ p: 1, method: "degenerate", permutations: 0 }`); forced
  sampled path via `{ exactCap: 1, samples: 500, seed: 0x12345 }` proving
  `method: "sampled"`, add-one smoothing (`p > 0`, `p = ge/(samples+1)`), and
  seed reproducibility.
- **validateValueProxy (RULE-027/028/029)** — one case per `reason`:
  `too-small-corpus`, `undefined-rank-correlation`, `low-rho`,
  `not-significant`, plus PASS (perfect and imperfect-but-strong). Full report
  shape asserted (`passed`, `reason`, `candidates`, `minimumCandidates`,
  `minimumRho`, `alpha`, `rho`, `pValue`, `pMethod`, `rows`) with the
  `negVhat = -Vhat` mapping and the reimagined `minimumCandidates` default of 6.
- **parseValidationOptions** — defaults `0.6 / 6 / 0.05`; throws on `CN_MIN_RHO`
  out of `[-1,1]`, `CN_MIN_CANDIDATES` non-integer or `< 2`, `CN_ALPHA` `<= 0`
  or `> 1` — matching the legacy error messages exactly.
- **parseCandidates** — accepts a bare array AND `{ candidates: [...] }`; throws
  `"expected an array or { candidates: [...] }"` otherwise; defaults missing
  `id` to `candidate-<n>`; throws on non-finite `proxy`/`Vhat`.
- **runValidation** — `invalid-config` on bad env, `malformed-input` on bad
  candidates, normal report otherwise; never throws, never touches the
  filesystem; config errors take precedence over input errors (legacy order).
- **Dual-execution equivalence** — seeded-random sweeps comparing the new
  target against the legacy oracle:
  - `spearmanRho` ≈ `legacySpearmanRho` within `1e-12` over ~500 random finite
    array pairs (with NaN-domain agreement);
  - `spearmanPValue` p **bit-identical** to legacy on the exact path (n ≤ 8) and
    on the forced sampled path (`{ exactCap: 1, samples: 500, seed: 0x12345 }`,
    same options to both);
  - `validateValueProxy` reports vs `legacyValidateValueProxy` over ~100 random
    candidate sets (ρ / pValue within `1e-12`, every other field deep-equal),
    plus a monotone n=3..8 grid.

Randomness is seeded via an inline `mulberry32` that replicates the legacy PRNG
**exactly** (note: legacy's variant has **no** `a |= 0` line), so every run is
reproducible.

## How to add a new case

1. Compute the expected value from the **legacy** module (the oracle):

   ```sh
   node --input-type=module -e '
     import { spearmanPValue } from "./legacy/codenuke/loop/value-proxy.mjs";
     console.log(JSON.stringify(spearmanPValue([1,2,3,4], [-40,-30,-20,-10])));
   '
   ```

   For the private helpers (`parseValidationOptions` / `parseCandidates` /
   `runValidation`) there is no legacy export — replicate the legacy private
   function body (`validationOptionsFromEnv` / `readCandidates`) or the CLI
   block in a one-off `node -e` script to obtain the literal expected value.

2. Add an `it(...)` inside the matching `describe` block in `value-proxy.test.ts`
   with a behavioral name (reads as a specification) and the literal expected
   value.
3. For floating-point fields prefer `toBeCloseTo(value, 12)` (or `15` where the
   double is exactly representable); reserve `toBe` for exact values
   (`p === 1`, `rho === 1`, clamps, `ge/(samples+1)`).
4. If the new behavior is not yet implemented in the target, mark it
   `it.todo(...)` / `it.skip(... "pending RULE-NNN")` rather than deleting it.

```

```
