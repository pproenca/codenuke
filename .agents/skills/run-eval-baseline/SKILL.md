---
name: run-eval-baseline
description: Run and report the codenuke Agent Quality Baseline. Use when changing mapping, guidance selection, provider prompts, refactoring resources, fix/revalidation behavior, patch-boundary logic, workflow state, or eval expectations; also use when the user asks to measure algorithm improvements or compare codenuke eval quality.
---

# Run Eval Baseline

Use this skill to turn `pnpm eval` into a decision-ready report for algorithm
changes. The goal is not only pass/fail; report whether the Trusted
Refactoring Workflow is using guidance well, avoiding churn, and preserving
validation/revalidation behavior.

## Workflow

1. Check the worktree with `git status --short`.
   - Do not revert unrelated user changes.
   - Note whether `evals/results/latest.json` is already dirty before running.

2. Run the baseline from the repository root:

   ```bash
   pnpm eval
   ```

3. If eval output rewrites `evals/results/latest.json`, run:

   ```bash
   pnpm exec oxfmt --write evals/results/latest.json
   ```

4. Inspect `evals/results/latest.json`.
   - Start with `totals.fixtures`, `totals.passed`, and `totals.failed`.
   - For failures, read each `results[].errors` entry before proposing fixes.
   - For passing runs, still inspect the `baseline` object because quality can
     regress while fixture expectations still pass.

5. Report the Agent Quality Baseline using these headings:
   - `Eval Health`: fixture pass/fail totals and failed fixture names.
   - `Guidance Selection`: audit count, selected resources, prompt proofs, and
     surprising rejected/selected resources.
   - `Guidance Application`: patch attempts with guidance applications,
     applied/adapted/not-used resources, deviations, and risk distribution.
   - `Patch Boundary`: changed files, boundary failures, and unexpected files.
   - `Workflow Outcome`: finding statuses, patch attempt statuses, validation
     command counts, and revalidation outcomes.

6. If the user is changing algorithms, compare the new result to the checked-in
   result or the pre-run dirty result when available.
   - Treat fixture failures as regressions unless expectations intentionally
     changed.
   - Treat new patch-boundary failures or unexpected files as churn regressions.
   - Treat fewer guidance audits, missing prompt proofs, missing guidance
     applications, or unexplained `not-used` primary resources as guidance
     regressions.
   - Treat improved fixed/open/uncertain outcomes as candidate improvements
     only when guidance and patch-boundary signals did not degrade.

## Fixing Clear Issues

When evals fail or baseline signals degrade, fix the smallest clear issue first:

- Fix runner/reporting bugs before changing fixture expectations.
- Update expectations only when the new behavior is intentional and better
  aligned with the Agent Quality Baseline.
- Keep generated result churn out of unrelated changes. Commit
  `evals/results/latest.json` only when setting or intentionally updating the
  baseline.
- After fixes, rerun `pnpm eval` and re-check the relevant report sections.

## Report Format

Keep the final report short and evidence-backed:

```text
Eval Health: 3/3 fixtures passed.
Guidance Selection: 3 audits, 3 prompt proofs; selected workflow.trusted-refactor-regression-coverage.
Guidance Application: 1 patch attempt, 1 guidance application, 0 deviations.
Patch Boundary: 0 unexpected files, 0 boundary failures.
Workflow Outcome: mock-bug ended uncertain after a no-op mock fix; this is the current baseline, not a regression.
Checks: pnpm eval.
```
