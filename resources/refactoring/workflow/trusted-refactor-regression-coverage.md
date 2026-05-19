# Trusted Refactor Regression Coverage

Use this workflow when a behavior-preserving simplification, complexity reduction, or code-volume
reduction cannot be trusted because the feature has no focused regression coverage.

## Signal

Report a trusted-refactor test gap when all of these are true:

- The code has a concrete simplification or complexity-reduction opportunity.
- The intended behavior can be inferred from owned files, context files, command surfaces, or nearby
  callers.
- The feature has no linked test that would fail if the behavior changed.
- A small regression test can describe the current behavior without broad fixture setup.

Do not report a test gap when the only concern is style preference, naming, formatting, or a broad
"more tests would be nice" claim.

## Fix Use

Before changing production code, add or update the smallest focused test that captures the behavior
the refactor must preserve. Then make the minimal production change and run validation.

## Revalidation Use

Mark the finding fixed only when the patch adds or updates behavior coverage and the simplification
still preserves the behavior described by that coverage.
