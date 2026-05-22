---
title: E2E Verification with Gitcrawl
description: "Real-world end-to-end test results using codenuke on gitcrawl"
---

# gitcrawl e2e verification

Date: 2026-05-15

Target:

- repo: `/path/to/gitcrawl`
- branch: `main`
- base sha: `469d89bc1a7af89a09e0d485a3aaec468695cc28`
- state dir: `/tmp/codenuke-gitcrawl-state.<tmp>`
- provider: `codex`

Commands:

```bash
node dist/cli.js --root /path/to/gitcrawl --state-dir /tmp/codenuke-gitcrawl-state.<tmp> init
node dist/cli.js --root /path/to/gitcrawl --state-dir /tmp/codenuke-gitcrawl-state.<tmp> map
node dist/cli.js --root /path/to/gitcrawl --state-dir /tmp/codenuke-gitcrawl-state.<tmp> review --feature feat_library_4e7327377d --provider codex
node dist/cli.js --root /path/to/gitcrawl --state-dir /tmp/codenuke-gitcrawl-state.<tmp> fix --finding fnd_sig-feat-library-4e7327377d-d508_36498c6bfc --provider codex
node dist/cli.js --root /path/to/gitcrawl --state-dir /tmp/codenuke-gitcrawl-state.<tmp> revalidate --finding fnd_sig-feat-library-4e7327377d-d508_36498c6bfc --provider codex
GOCACHE=/tmp/gitcrawl-go-cache GOWORK=off go test ./internal/vector
```

Results:

- `map`: 12 features found.
- `review`: 1 real finding in `internal/vector/exact.go`.
- finding: `Query can return NaN/Inf scores for non-finite vector values`
- reason: `score <= 0` does not filter `NaN`; JSON marshalling rejects `NaN`/`Inf` scores.
- `fix`: changed `internal/vector/exact.go` and `internal/vector/exact_test.go`.
- targeted validation: `go test ./internal/vector` passed.
- `revalidate`: outcome `fixed`.

Patch produced in gitcrawl:

```diff
-		if score <= 0 {
+		if math.IsNaN(score) || math.IsInf(score, 0) || score <= 0 {
```

Regression test added in gitcrawl:

```go
func TestQueryFiltersNonFiniteScores(t *testing.T)
```

Known validation note:

- codenuke marked the patch attempt `failed` because Codex also ran broad `go test ./...`, which failed in unrelated `internal/cli` tests.
- Focused package validation passed and Codex revalidation marked the reviewed finding fixed.
