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

Map-quality research uses a smaller Karpathy/autoresearch-style loop: build the
local CLI, run `map` twice against an isolated state directory, score durable
Feature Slice structure, and write a JSON baseline. This is the metric for
mapper iterations before review/fix behavior is considered.

```bash
pnpm eval:map
```

The result scores Feature Slice ID stability, idempotence, reviewable source
coverage, safe ownership, bounded feature size, linked tests, and semantic
evidence links. Override the output path with `CODENUKE_MAP_QUALITY_RESULTS` or
`--results <path>` when running exploratory experiments. Semantic evidence is
map-time `identifier-tfidf` neighbor evidence persisted on Feature Slices, not
provider review output.

When run against the repository root, `pnpm eval:map` also runs deterministic
fixtures under `evals/map-quality/`. These fixtures declare expected semantic
neighbors and forbidden false-neighbor pairs so mapper experiments can be kept
or discarded against an auditable quality surface, following the
Karpathy/autoresearch pattern of fixed metric plus bounded experiment surface.
The JSON result includes a `decision.status` of `keep` or `discard`, based on
Feature Slice stability, idempotence, safe ownership, and fixture pass/fail
checks.
Fixtures should include rejective cases, not only positive examples. For
example, abbreviation fixtures should prove that `cfg` can match `config` while
generic `context` or `environment` vocabulary does not create unrelated
semantic-neighbor links. Implementation-noise fixtures should prove that
repeated generic code-body words such as `read`, `key`, `cache`, `writer`, and
`handler` do not outrank stronger path and Feature metadata vocabulary.

For opt-in model-backed prompt comparisons, run:

```bash
pnpm eval:model
```

Model evals default to `codex`, `gpt-5.5`, and `medium` reasoning effort, write
`evals/results/model-latest.json`, and use record-only expectations so they do
not become mandatory CI gates. They also write
`evals/results/model-comparison.json` and
`evals/results/model-comparison.md` against `evals/results/latest.json`.
Override with `CODENUKE_EVAL_PROVIDER`, `CODENUKE_EVAL_MODEL`,
`CODENUKE_EVAL_REASONING_EFFORT`, `CODENUKE_EVAL_EXPECTATIONS`,
`CODENUKE_EVAL_RESULTS`, and `CODENUKE_EVAL_BASELINE`. Interpret model evals by
comparing prompt/model/reasoning settings, selected resources, reported
findings, false positives on clean fixtures, missed representative Refactoring
Signals, output validity, and patch/revalidation behavior. Keep deterministic
`pnpm eval` as the package verification gate.

The fixture loop is intentionally local and deterministic. Historical OSS
benchmarks should build on this result format later rather than replacing it.
