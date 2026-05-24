---
name: codenuke-small-bugfix-sweep
description: "Triage and fix only small, high-certainty codenuke bugs from pasted issue or PR refs, with focused local proof and no publishing actions before approval."
---

# codenuke Small Bugfix Sweep

Use for pasted codenuke issue/PR refs where the goal is a focused local fix or classification.

## Review Gate

Default flow:

1. Read each issue or PR deeply enough to prove current behavior and root cause.
2. Fix only easy, high-confidence bugs with narrow ownership and focused proof.
3. Stop with dirty diff summary, touched files, and test/gate output for review.
4. Commit, push, comment, close, tag, publish, or merge only after explicit approval.

## Loop

For each ref:

1. Read live target with `gh` when available.
2. Read body, comments, linked refs, changed files, current code, adjacent tests, and dependency contracts when relevant.
3. Trace the real runtime path.
4. Fix locally only when root cause is clear and the patch is smaller than a broad refactor.
5. Add focused regression proof when practical.
6. Run the smallest meaningful gate.
7. Classify as `fixed-local`, `needs-fixup`, `skipped`, or `needs-human`.

## Skip If

- Not a bug.
- Repro or root cause is uncertain.
- The clean fix is a larger design or ownership change.
- Already fixed on current `master`.
- Dependency behavior is guessed.
- No focused proof is feasible.

## Output

Return a compact ledger, touched files, proof commands, and skip reasons.
