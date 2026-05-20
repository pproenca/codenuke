# Map-quality autoresearch loop

Codenuke will treat map quality as the first-class research object for semantic
algorithm work. The durable map should get better before review-time prompts get
more clever.

The loop is inspired by `karpathy/autoresearch`:

- fixed evaluation surface
- one mutable research surface
- first run establishes the baseline
- experiments are kept only when the metric or supporting evidence improves
- results are written to a lightweight artifact for later analysis

The concrete code analogy is:

- `karpathy/autoresearch/prepare.py` is the fixed harness: constants, data
  loading, tokenizer, and `evaluate_bpb`. In codenuke, that role belongs to
  `evals/scripts/run-map-quality.mjs` plus checked-in fixtures under
  `evals/map-quality/`.
- `karpathy/autoresearch/train.py` is the mutable experiment file. In codenuke,
  that role starts with mapper/evidence code such as
  `src/mapping/semantic-evidence.ts`; experiments should move the map evidence,
  not the metric.
- `karpathy/autoresearch/program.md` defines the research operating loop:
  baseline first, run the fixed metric, log status, keep improvements, discard
  regressions. In codenuke, `pnpm eval:map` is the local decision surface.

Unlike `autoresearch`, codenuke must not run an indefinite autonomous loop or
reset user work automatically. Mapper experiments still follow codenuke's normal
dirty-worktree and review safety rules.

The map-quality loop follows this shape:

1. Build the local CLI.
2. Run `map` against an isolated state directory.
3. Run `map` again against the same isolated state.
4. Score the resulting Feature Slices.
5. Write the result JSON.
6. Mark the run `keep` or `discard` from explicit checks.
7. Keep mapper changes only when the score or supporting evidence improves
   without weakening safety constraints.

The first metric is `pnpm eval:map`. It is intentionally deterministic and does
not call a provider. It scores:

- Feature Slice ID stability across repeated map runs
- idempotence of the second map run
- coverage of reviewable source files under `src/`, `scripts/`, and eval scripts
- absence of generated, dependency, or local state ownership
- bounded owned-file counts
- linked test references
- persisted semantic-neighbor evidence produced at map time
- checked-in semantic-neighbor fixtures with expected links and forbidden links
- an explicit keep/discard decision for the run

This is not the final semantic mapper. It is the scoreboard for improving one.
Future linguistic, semantic, graph, clone, and co-change algorithms should feed
map-time evidence that review, fix, and revalidation can consume from durable
Feature Slice records or adjacent map records. Review-time Ludicrous candidates
can remain useful instrumentation, but they should not be the main place where
semantic codebase understanding lives.

The first implementation slice persists `semanticEvidence` on `FeatureRecord`.
It uses identifier token splitting, common abbreviation expansion, light
inflection normalization, domain-weighted path and Feature metadata tokens, and
deterministic TF-IDF/cosine similarity to link Feature Slices with shared domain
vocabulary. Code-body tokens are lower weight and generic implementation words
are filtered so evidence prefers domain neighbors over incidental helper
vocabulary. Findings may persist `mapEvidenceTrace` when review promotes that
map evidence into a concrete finding, which lets fix and revalidation consume
the same map-time context.

Consequences:

- `map` becomes the stable place to improve codebase understanding.
- `review` should consume map evidence rather than rediscovering sibling
  opportunities from scratch.
- `fix` and `revalidate` should be able to use the same map evidence for Patch
  Boundary and sibling-risk checks.
- Semantic algorithm work needs eval evidence before it changes default mapping
  behavior.
