---
name: autoreview
description: "Run structured AI review for codenuke pushed branch changes after a successful push, or when explicitly requested for a branch/commit/local WIP review. Use after push for non-trivial closeout, release preparation, or requested second-model review; do not run automatically after every local edit or ordinary code change."
---

# Auto Review

Use this for codenuke code review closeout after the branch has been pushed. This is advisory review, not an approval gate.

## Contract

- Verify every finding by reading the real code path and adjacent tests.
- Reject speculative risks, unrealistic malformed input, broad rewrites, and fixes that over-complicate codenuke.
- Prefer small fixes at the owning package boundary.
- If a review-triggered fix changes code, rerun focused proof and rerun review until no accepted/actionable findings remain.
- Do not push, comment, publish, tag, or create releases just to review.
- Do not run review after every local edit, save, or fix iteration. Push first, then review the pushed diff.

## Targets

Default closeout target, after a successful push:

```bash
.agents/skills/autoreview/scripts/autoreview --mode pushed --base origin/master
```

This reviews the upstream branch, usually `origin/<current-branch>`, against the base. Use this instead of local dirty review for normal work.

Bare `autoreview` also defaults to pushed mode. Use explicit modes for anything else.

Branch work against codenuke's default branch, only when explicitly requested before push:

```bash
.agents/skills/autoreview/scripts/autoreview --mode branch --base origin/master
```

Dirty local work, only when explicitly requested for WIP review:

```bash
.agents/skills/autoreview/scripts/autoreview --mode local
```

Committed single change:

```bash
.agents/skills/autoreview/scripts/autoreview --mode commit --commit HEAD
```

Format first if formatting can move line numbers. It is fine to run proof in parallel:

```bash
.agents/skills/autoreview/scripts/autoreview --parallel-tests "pnpm test"
```

## Output

Report the review command, proof command, accepted/rejected findings, and the clean final review result or remaining conscious risk.
