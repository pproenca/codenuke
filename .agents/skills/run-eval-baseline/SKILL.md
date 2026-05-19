---
name: run-eval-baseline
description: Run and report the codenuke Agent Quality Baseline. Use when changing mapping, guidance selection, provider prompts, refactoring resources, fix/revalidation behavior, patch-boundary logic, workflow state, or eval expectations; also use when the user asks to measure algorithm improvements or compare codenuke eval quality.
---

# Run Eval Baseline

Use this skill to turn `pnpm eval` into a decision-ready report for algorithm
changes. The goal is not only pass/fail; report whether the Trusted
Refactoring Workflow is selecting the right Refactoring Resources, keeping
mandatory guidance narrow, avoiding churn, and preserving validation/
revalidation behavior.

`pnpm eval` is the deterministic package gate. `pnpm eval:model` is an opt-in
model-backed comparison path for provider prompt, model, and reasoning-effort
changes. Do not run model evals unless the user asks for model-backed evidence
or the change explicitly needs it.

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
   - Check `mode.expectations`; deterministic baseline runs should normally be
     `strict`.
   - For failures, read each `results[].errors` entry before proposing fixes.
   - For passing runs, still inspect the `baseline` object because quality can
     regress while fixture expectations still pass.
   - For guidance-focused fixtures, inspect:
     - `baseline.guidanceSelection.detectedShapeNames`
     - `baseline.guidanceSelection.selectedResources`
     - `baseline.guidanceSelection.primaryResources`
     - `baseline.guidanceSelection.supportingResources`
     - `baseline.guidanceSelection.rejectedResources`

5. Report the Agent Quality Baseline using these headings:
   - `Eval Health`: fixture pass/fail totals and failed fixture names.
   - `Guidance Selection`: audit count, detected shapes, selected resources,
     primary/supporting roles, prompt proofs, and surprising rejected/selected
     resources. Call out whether concrete Refactoring Signals are primary and
     `workflow.trusted-refactor-regression-coverage` is supporting except in
     missing-tests-only fixtures.
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
   - Treat missing representative Refactoring Signal coverage, missing primary
     signal resources, unexpected primary workflow guidance, or newly selected
     noisy resources as guidance-quality regressions.
   - Treat improved fixed/open/uncertain outcomes as candidate improvements
     only when guidance and patch-boundary signals did not degrade.

## Model-backed Comparison

Run model evals only when the user asks to compare provider/model behavior or
when prompt/provider changes need real model evidence:

```bash
pnpm eval:model
```

Defaults:

- provider: `codex`
- model: `gpt-5.5`
- reasoning effort: `medium`
- expectations: record-only
- output: `evals/results/model-latest.json`

Useful overrides:

```bash
CODENUKE_EVAL_PROVIDER=codex \
CODENUKE_EVAL_MODEL=gpt-5.5 \
CODENUKE_EVAL_REASONING_EFFORT=medium \
CODENUKE_EVAL_RESULTS=model-latest.json \
pnpm eval:model
```

Use model evals to compare prompt variants, provider output validity, false
positives on clean fixtures, missed representative Refactoring Signals,
reasoning-effort changes, patch/revalidation behavior, and token/latency
tradeoffs when available. Keep model results separate from deterministic CI
unless the project later adopts a stable credentialed variance policy.

## Fixing Clear Issues

When evals fail or baseline signals degrade, fix the smallest clear issue first:

- Fix runner/reporting bugs before changing fixture expectations.
- Update expectations only when the new behavior is intentional and better
  aligned with the Agent Quality Baseline.
- Prefer adding or tightening representative guidance fixtures when a selector
  or prompt change is not covered by existing Duplicate Code, Long Method, Long
  Parameter List, Switch Statements, Comments, Middle Man, Message Chains,
  clean, or missing-tests-only cases.
- Keep generated result churn out of unrelated changes. Commit
  `evals/results/latest.json` only when setting or intentionally updating the
  baseline.
- After fixes, rerun `pnpm eval` and re-check the relevant report sections.

## Report Format

Keep the final report short and evidence-backed:

```text
Eval Health: 12/12 fixtures passed.
Guidance Selection: 12 audits, 12 prompt proofs; representative signal fixtures select concrete signals as primary and regression coverage as supporting; missing-tests-only keeps regression coverage primary.
Guidance Application: 1 patch attempt, 1 guidance application, 0 deviations.
Patch Boundary: 0 unexpected files, 0 boundary failures.
Workflow Outcome: mock-refactor ended uncertain after a no-op mock fix; deterministic guidance fixtures report no mock findings.
Checks: pnpm eval.
```
