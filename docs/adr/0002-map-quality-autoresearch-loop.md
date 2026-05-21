# Unified semantic ROI eval gate

Codenuke keeps one local eval gate for refactoring quality work:

```bash
pnpm eval
```

That command builds the CLI, runs the deterministic fixture suite, updates the
guidance coverage matrix, and runs the semantic ROI gate. Older standalone
map-quality and model-comparison eval surfaces were retired so mapper and
review changes have one decision surface.

Semantic evidence is production behavior, not a feature flag. The mapper always
persists `semanticEvidence` on Feature records. The ROI harness still measures
evidence impact by running control and treatment observations against copied
fixtures; after the control `map` run, the harness strips semantic-neighbor
links from copied `.codenuke/features` records before review. That keeps the
production CLI singular while preserving a sealed A/B comparison.

The eval gate treats "future change is easier" as a scenario measurement:

- define the future-change class
- record today's expected cost
- record the target cost after the refactor
- seal behavior invariants and evaluator files
- require fix and revalidation for positive ROI fixtures
- measure touch points, changed files, patch-size lines, and validation commands
- keep the run only when treatment improves the scenario without hard
  constraint failures

The semantic ROI gate is production-ready only with multiple positive
future-change scenarios, a semantic false-positive trap, required cost
dimensions, no protected evaluator mutation, and no hard constraint failures.
Protected evaluator files include behavior scripts, tests, package metadata,
TypeScript config, and any fixture-declared protected paths.

Future linguistic, semantic, graph, clone, and co-change algorithms should feed
map-time evidence that review, fix, and revalidation consume from durable
Feature records or adjacent map records. They should ship only when `pnpm eval`
shows behavior preservation and a better measured future-change scenario.

Consequences:

- `map` remains the stable place to improve codebase understanding.
- `review` consumes map evidence rather than rediscovering sibling opportunities
  from scratch.
- `fix` and `revalidate` can use the same map evidence for Patch Boundary and
  sibling-risk checks.
- Semantic algorithm work needs scenario-based eval evidence before it changes
  default mapping behavior.
