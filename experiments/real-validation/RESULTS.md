# Real-code validation — results

Subjects: **good** = opencode `packages/core/src` (112 files, 12k LOC, shallow-cloned),
**bad** = codenuke `src/` (55 files, 22k LOC). Both real TypeScript.
Run: `node experiments/real-validation/contrast.mjs` and `inspect-clones.mjs`.

## Outcome: construct validity NOT supported for the duplication term; SUPPORTED for complexity

| signal | good (opencode) | bad (codenuke) | prediction (bad>good) |
|---|---|---|---|
| duplication rate (idiom-filtered) | 9.68% | 3.91% | **FAIL** (good 2.5×) |
| duplication mass / KLOC | 94.1 | 21.6 | **FAIL** (good 4.3×) |
| complexity / 1k AST nodes | 21.08 | 34.37 | **PASS** (bad 1.63×) |

Two iterations on the duplication term (strip imports, require ≥5 distinct content
tokens per window) improved specificity (good 12.8%→9.7%, bad 8.7%→3.9%) but did
**not** change the ordering. The synthetic separation check still passes throughout.

## Why (evidence from inspect-clones.mjs)

opencode's top repeated windows are **benign idiomatic API usage**, not duplication:
- `PluginV2.define({ id: PluginV2.ID.make(` — **×33 across 32 files**. 32 independent
  plugins calling one well-designed API. Already DRY (one definition, many callers).
- `evt.provider.update(item.provider.id,` — ×13 across 12 files. Same: consistent API use.

codenuke's top repeated windows are mostly benign too (a mapper signature/interface
contract ×12; a regex), with one mild real tax (a status message built in 5 places).

## Conclusions (evidence-driven metric correction)

1. **Raw clone-mass is an invalid value signal.** It counts *good consistency*
   (calling one API the same way) as "duplication," so a high-quality codebase scores
   higher. It cannot distinguish benign similarity from harmful, change-coupled
   duplication. This empirically confirms codenuke's `changeScenario` thesis: "looks
   similar" is not a finding.
2. **The codebase-level contrast was the right test for a STATE signal (complexity)
   but the wrong test for a TRANSITION signal (reducible mass).** Duplication is
   *opportunity*, not *badness*; a good codebase can have lots of (benign) repetition.
3. **Complexity density is a valid state-quality signal** (bad 1.63× good) — keep it.
4. **The valid value signal is change-amplification / change-coupling** — "does one
   conceptual change force edits across N sites?" — which syntactic clone detection
   cannot measure. Next: measure it from **git co-change history** (deterministic,
   cheap, repo-native; the observational outcome record). Prediction: opencode's 32
   `PluginV2.define` sites do NOT co-change; a real tax does.

## Bugs noted (non-blocking)
- `coupling` (kappa) returns 0 for codenuke: the resolver doesn't handle `../` paths.
  Not in `gain` or the verdict; left for later.
