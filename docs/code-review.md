---
title: Code Review
description: "How clawnuke reviews features with AI providers and persists findings"
---

# Code Review

`clawnuke review` reviews feature records created by `clawnuke map`.

```bash
clawnuke review --limit 3
clawnuke review --limit 12 --jobs 4
clawnuke review --feature <featureId>
clawnuke review --since origin/main
clawnuke review --provider codex --model <model>
```

Current behavior:

- selects pending features unless `--feature` is set
- claims each feature with an atomic lock file plus the feature run lock
- reviews with a bounded worker pool; default `--jobs` is `10`
- emits progress to stderr unless `--quiet` is set
- builds bounded prompt context from owned files, context files, and tests
- calls the configured provider
- requires strict JSON output
- writes findings under `.clawnuke/findings/`
- appends analysis history to the feature record
- releases the feature lock

## Flags

### --since <ref>

Restrict review to features whose owned or context files have changed in
`git diff --name-only --relative <ref>...HEAD`. Paths are compared relative to
the selected project root, so `--root` may point at a subdirectory inside a
larger Git repository. Useful for CI:

```bash
clawnuke review --since origin/main   # review what this branch changed
clawnuke review --since HEAD~5        # review the last 5 commits
```

If no features are touched by the diff, `review` exits cleanly with no findings.
The same flag is available on `revalidate`; revalidation scopes open findings to
features whose owned files changed.

Progress uses stderr so `--json` stdout remains machine-readable. The worker
pool is per-process, and lock files under `.clawnuke/locks/` prevent
overlapping review processes from claiming the same feature. Interrupted runs
can leave recoverable lock files; clear them with `clawnuke clean-locks` after
confirming no review process is still active. `clawnuke status` includes both
feature-record locks and lock files in `activeLocks`, and reports the lock-file
count as `lockFiles`.

There is no multi-provider panel yet.

Clawnuke's review mission is reliable, trusted refactoring. Providers should
first look for behavior-preserving simplification and complexity-reduction
opportunities, then report material correctness or safety issues only when the
evidence is concrete.

Categories requested from the provider:

- `bug`
- `security`
- `performance`
- `concurrency`
- `api-contract`
- `data-loss`
- `test-gap`
- `docs-gap`
- `build-release`
- `maintainability`

Within those categories, clawnuke prioritizes `performance` findings for
algorithmic/render-path complexity and `maintainability` findings for specific,
behavior-preserving simplifications. The bug and safety categories remain
available for serious evidence-backed issues, but reviews are not intended to
be broad bug hunts.

Review does not edit files. Use `clawnuke fix --finding <id>` for the explicit
patch loop.
