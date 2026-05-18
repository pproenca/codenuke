# codenuke evals

Deterministic eval fixtures for codenuke behavior.

The first loop exercises the local CLI through `init -> map -> review -> report`
using the built-in `mock` provider. Each fixture declares expected findings in
`eval.json`; the runner copies the fixture to a temporary repository, runs
codenuke, scores the JSON report, and writes `evals/results/latest.json`.

Run:

```bash
pnpm eval
```

The fixture loop is intentionally local and deterministic. Historical OSS
benchmarks should build on this result format later rather than replacing it.
