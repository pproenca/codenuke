---
name: autoreview
description: "Run structured AI review for codenuke local changes, branch diffs, or commits; use before non-trivial closeout, commit, release, or requested second-model review."
---

# Auto Review

Use this for codenuke code review closeout. This is advisory review, not an approval gate.

## Contract

- Verify every finding by reading the real code path and adjacent tests.
- Reject speculative risks, unrealistic malformed input, broad rewrites, and fixes that over-complicate codenuke.
- Prefer small fixes at the owning package boundary.
- If a review-triggered fix changes code, rerun focused proof and rerun review until no accepted/actionable findings remain.
- Do not push, comment, publish, tag, or create releases just to review.

## Targets

Dirty local work:

```bash
.agents/skills/autoreview/scripts/autoreview --mode local
```

Branch work against codenuke's default branch:

```bash
.agents/skills/autoreview/scripts/autoreview --mode branch --base origin/master
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
