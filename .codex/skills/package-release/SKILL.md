---
name: package-release
description: Prepare or validate a codenuke npm package release, including version, docs, build, tests, evals, and smoke checks.
---

# Package Release

## Core Workflow

1. Inspect the requested release scope and confirm whether this is a validation
   pass, a version bump, or a publish-prep change. Do not publish unless the user
   explicitly asks.
2. Check the concrete package surfaces:
   - `package.json`
   - `pnpm-lock.yaml`
   - `README.md`
   - `docs/install.md`
   - `src/cli.ts`
   - files included through the package `files` list
   - `scripts/package-smoke.mjs`
3. Run the standard checks:

   ```bash
   pnpm typecheck
   pnpm lint
   pnpm test
   pnpm build
   pnpm pack:smoke
   ```

4. Add `pnpm eval` when mapper behavior, provider schema contracts, review
   output, or fix/revalidation flows changed.
5. If the user asked for a version bump, update only the version-bearing files
   required by the package manager. Keep changelog or release notes concise and
   tied to user-visible behavior.

## Failure Path

Enter this path when build, tests, evals, or smoke validation fails.

1. Capture the failing command and the first actionable error.
2. Determine whether the failure is caused by package contents, CLI startup,
   TypeScript output, provider setup, fixture expectations, or environment.
3. Fix the smallest package or code surface that restores the release contract.
4. Re-run the focused failing command first, then the broader release checks if
   the fix changed shared behavior.

## Reporting

- Distinguish "release validation passed" from "package published".
- Mention exactly which commands ran.
- If blocked, report the failing release surface and the next concrete fix.
