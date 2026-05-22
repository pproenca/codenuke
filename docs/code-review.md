---
title: Code Review
description: "How codenuke reviews features with AI providers and persists findings"
---

# Code Review

`codenuke review` reviews feature records created by `codenuke map`.

```bash
codenuke review --limit 3
codenuke review --limit 12 --jobs 4
codenuke review --feature <featureId>
codenuke review --since origin/main
codenuke review --provider codex --model <model>
```

Current behavior:

- selects pending features unless `--feature` is set
- claims each feature with an atomic lock file plus the feature run lock
- reviews with a bounded worker pool; default `--jobs` is `10`
- emits progress to stderr unless `--quiet` is set
- builds bounded prompt context from owned files, context files, and tests
- calls the configured provider
- requires strict JSON output
- writes findings under `.codenuke/findings/`
- appends analysis history to the feature record
- releases the feature lock

## Flags

### --since <ref>

Restrict review to features whose owned or context files have changed in
`git diff --name-only --relative <ref>...HEAD`. Paths are compared relative to
the selected project root, so `--root` may point at a subdirectory inside a
larger Git repository. Useful for CI:

```bash
codenuke review --since origin/main   # review what this branch changed
codenuke review --since HEAD~5        # review the last 5 commits
```

If no features are touched by the diff, `review` exits cleanly with no findings.
The same flag is available on `revalidate`; revalidation scopes open findings to
features whose owned files changed.

Progress uses stderr so `--json` stdout remains machine-readable. The worker
pool is per-process, and lock files under `.codenuke/locks/` prevent
overlapping review processes from claiming the same feature. Interrupted runs
can leave recoverable lock files; clear them with `codenuke clean-locks` after
confirming no review process is still active. `codenuke status` includes both
feature-record locks and lock files in `activeLocks`, and reports the lock-file
count as `lockFiles`.

There is no multi-provider panel yet.

Codenuke's review mission is code reduction through behavior-preserving
refactoring. Providers should not hunt for bugs. They should look for
evidence-backed opportunities to delete, merge, or localize code while preserving
behavior.

The provider should emit `maintainability` findings for code-reduction
opportunities. Cosmetic cleanup, style preferences, renames, formatting, and
abstraction churn are not enough.

For each finding, codenuke asks the provider to define a measurable change
scenario:

- future change: the class of change that should become easier
- current cost: what that change requires today
- target cost: what it should require after the refactor
- behavior invariant: what must remain unchanged
- evidence: included code proving both the current cost and target

This keeps "future change is easier" grounded in cost, risk, delay, locality, or
blast radius instead of subjective cleanliness.

For larger refactors, use this loop: name systemic friction, map the current
shape, choose a smaller target shape, protect behavior at boundaries, migrate in
slices, delete the old shape, rebalance, and repeat only if another measured
code-reduction scenario remains.

Review does not edit files. Use `codenuke fix --finding <id>` for the explicit
patch loop.
