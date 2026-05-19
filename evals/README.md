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

Run:

```bash
pnpm eval
```

For opt-in model-backed prompt comparisons, run:

```bash
pnpm eval:model
```

Model evals default to `codex`, `gpt-5.5`, and `medium` reasoning effort, write
`evals/results/model-latest.json`, and use record-only expectations so they do
not become mandatory CI gates. Override with `CODENUKE_EVAL_PROVIDER`,
`CODENUKE_EVAL_MODEL`, `CODENUKE_EVAL_REASONING_EFFORT`,
`CODENUKE_EVAL_EXPECTATIONS`, and `CODENUKE_EVAL_RESULTS`. Interpret model evals
by comparing prompt/model/reasoning settings, selected resources, reported
findings, false positives on clean fixtures, missed representative Refactoring
Signals, output validity, and patch/revalidation behavior. Keep deterministic
`pnpm eval` as the package verification gate.

The fixture loop is intentionally local and deterministic. Historical OSS
benchmarks should build on this result format later rather than replacing it.
