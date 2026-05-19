---
name: code-review-testing
description: Test authoring guidance
---

Prefer behavior-level Vitest coverage over testing implementation details. Unit
tests are fine for pure helpers, but changes to CLI behavior, workflow state, or
provider contracts should be covered at the boundary the user depends on.

Features that change codenuke behavior MUST add or update focused tests:

- Provide a list of major logic changes and user-facing behaviors that need to be tested.

Important surfaces:

- mapper coverage and stable feature IDs
- CLI argument parsing, command validation, and output modes
- provider command construction and JSON schema parsing
- workflow resume, locks, triage, fix attempts, and revalidation
- reporting and package smoke behavior

If a test helper is needed, prefer existing helpers in `src/test-helpers.ts` or a
small local helper in the relevant `*.test.ts` file. Avoid test-only exports in
main implementation files unless the behavior cannot be covered cleanly through
the public module boundary.
