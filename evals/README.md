# codenuke evals

Deterministic eval fixtures for codenuke behavior.

The first loop exercises the local CLI through `init -> map -> review -> report`
using the built-in `mock` provider. Each fixture declares expected findings in
`eval.json`; the runner copies the fixture to a temporary repository, runs
codenuke, scores the JSON report, and writes `evals/results/latest.json`.
Fixtures can also opt into `fix` and `revalidate` steps. The result includes an
Agent Quality Baseline summary with deterministic eval health, guidance
selection, guidance application, patch boundary churn, and workflow outcome
signals from the durable `.codenuke/` records.

Guidance-focused fixtures can assert selected resources, primary/supporting
roles, absent resources, and detected shape names under `expect.baseline`.
These expectations make selector regressions fail even when the mock provider
does not return a finding. Use them for representative Refactoring Signal
fixtures such as Duplicate Code, Long Parameter List, clean code, and
missing-tests-only cases.

Every eval run also writes `evals/results/guidance-coverage-matrix.json` from
the manifest, fixture traces, patch guidance applications, and explicit
reservations in `evals/guidance-coverage.json`. Strict deterministic runs fail
when any guidance resource is neither covered, applied, nor reserved; the matrix
separately reports unowned selectable resources so new selector resources cannot
ship without an eval owner.

Run:

```bash
pnpm eval
```

`pnpm eval` is the only local eval gate. It builds the CLI, runs the
deterministic fixture loop, writes `evals/results/latest.json`, writes
`evals/results/guidance-coverage-matrix.json`, and then runs the semantic ROI
gate. The ROI gate writes `evals/results/semantic-roi-latest.json`,
`evals/results/semantic-roi-latest.md`, and an append-only ledger at
`evals/results/semantic-roi-ledger.jsonl`.

Semantic ROI is scenario-based. Each ROI fixture runs a control observation and
a treatment observation. Both observations use the same production `map`
command; the harness strips semantic-neighbor links from the copied control
state after mapping so the production mapper has one behavior while the eval can
still measure evidence impact. Positive fixtures must declare a concrete
future-change scenario, current cost, target cost, behavior invariants,
expected transformation, fix, and revalidation. The gate then measures whether
the treatment refactor keeps behavior green and makes the same future change
cheaper by touch points, changed files, patch-size lines, and validation
commands.

The semantic ROI gate is production-ready only when it has at least two positive
future-change fixtures, at least one semantic false-positive trap, all required
cost dimensions (`change-amplification`, `blast-radius`, `verification-cost`,
and `reversibility`), no hard constraint failures, and no protected evaluator
mutations. Protected evaluator files include behavior scripts, tests, package
metadata, TypeScript config, and any fixture-declared protected paths. Fix and
future-change probes may change source files, but they must not change the
sealed evaluator.
