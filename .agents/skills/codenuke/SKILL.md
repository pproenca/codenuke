---
name: codenuke
description: Run codenuke from npm for automated code review, behavior-preserving refactoring, complexity reduction, finding triage, and one-finding-at-a-time fix/revalidate loops. Use when a user wants to set up codenuke in a repository, review code with codenuke, run an auto-fix loop over actionable findings, inspect reports, triage false positives, revalidate fixes, or operate the codenuke CLI without needing it installed globally.
---

# codenuke

## Overview

codenuke maps a repository into feature slices, asks an AI provider for safe
refactoring findings, stores state under `.codenuke/`, and can patch one finding
at a time with validation.

Prefer the npm runner so users do not need a global install:

```bash
npx --yes codenuke@latest <command>
```

If the user is working on codenuke itself from source, use the repo's documented
local build flow instead of `npx` only when that is clearly the intent.

## Setup

Work from the repository root unless the user supplies `--root`.

```bash
node --version
git status --short
npx --yes codenuke@latest doctor
npx --yes codenuke@latest init --no-input
npx --yes codenuke@latest map
```

- Require Node 22 or newer.
- Use the default `codex` provider unless the user asks for another provider.
- For provider choices, pass `--provider`, `--model`, and
  `--reasoning-effort` on review, fix, revalidate, or doctor commands.
- Do not hand-edit `.codenuke/` state. Let codenuke create and update it.

## Review Flow

Start small and make the report visible before fixing anything:

```bash
npx --yes codenuke@latest status
npx --yes codenuke@latest review --limit 3 --jobs 3
npx --yes codenuke@latest report
npx --yes codenuke@latest next
```

Use focused filters when the repo is large:

```bash
npx --yes codenuke@latest review --project <name-or-root> --limit 3
npx --yes codenuke@latest review --feature <featureId>
npx --yes codenuke@latest report --status open --severity high
```

## Auto-Fix Loop

Keep fixes finding-scoped. Default to at most 3 iterations unless the user gives
a larger budget.

For each iteration:

1. Confirm the source worktree is clean, or stop and ask before continuing.
2. Select the next finding.
3. Inspect the finding before patching.
4. Run the codenuke fix command.
5. Review the diff and validation output.
6. Revalidate the same finding.
7. Stop if there is no clear next finding, validation is blocked, or changes
   need human review.

```bash
git status --short
npx --yes codenuke@latest next
npx --yes codenuke@latest show --finding <findingId>
npx --yes codenuke@latest fix --finding <findingId>
git diff --stat
git diff
npx --yes codenuke@latest revalidate --finding <findingId>
npx --yes codenuke@latest report --status open
```

Use `--dry-run` first when the user wants a plan without edits:

```bash
npx --yes codenuke@latest fix --finding <findingId> --dry-run
```

## Triage And Recovery

Mark non-actionable findings explicitly:

```bash
npx --yes codenuke@latest triage --finding <findingId> --status false-positive --note "<why>"
npx --yes codenuke@latest triage --finding <findingId> --status wont-fix --note "<why>"
```

Re-check findings after manual edits or codenuke fixes:

```bash
npx --yes codenuke@latest revalidate --finding <findingId>
npx --yes codenuke@latest revalidate --all --status open --limit 10
```

If stale work locks block progress:

```bash
npx --yes codenuke@latest clean-locks
```

## Safety Rules

- Treat `review`, `report`, `next`, `show`, and `revalidate` as inspection
  commands.
- Treat `fix` as a mutating command. Run it only after selecting a specific
  finding and checking the worktree.
- Do not commit, push, open PRs, or land changes unless the user separately
  asks. codenuke itself does not do those actions.
- Do not hide validation failures. Report the failing command, whether the
  failure appears related to the patch, and the next concrete command to run.
- Keep `.codenuke/` out of commits unless the user explicitly wants codenuke
  state or reports checked in.

## Handoff

When finished, summarize:

- Commands run.
- Finding IDs fixed, revalidated, triaged, or still open.
- Files changed outside `.codenuke/`.
- Validation commands and results.
- The next codenuke command the user should run.
