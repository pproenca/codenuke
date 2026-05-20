---
name: codenuke
description: Run codenuke from npm or the skill progress script for automated code review, behavior-preserving refactoring, high-recall ludicrous-mode review candidates, finding triage, one-finding-at-a-time fix/revalidate loops, and optional commit-and-continue auto-fix loops. Use when a user wants terminal-visible codenuke progress, setup, mapping, review, ludicrous mode, reports, next findings, auto-fix loops, triage, revalidation, or codenuke CLI operation without a global install.
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

For user-facing terminal runs, prefer the skill helper script because it prints
each codenuke step before running it:

```bash
scripts/codenuke-progress.sh
```

If the user asks for ludicrous mode, pass it through explicitly:

```bash
scripts/codenuke-progress.sh --ludicrous-mode
```

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
scripts/codenuke-progress.sh --limit 3 --jobs 3
```

Review selects packaged refactoring resources from observable owned-code shapes,
injects them into provider prompts, and persists guidance traces on findings.
When the user asks for broader, high-recall refactoring opportunities, use
Ludicrous Review Mode:

```bash
scripts/codenuke-progress.sh --ludicrous-mode --limit 5 --jobs 3
```

Use `--dry-run` when the user wants to see the candidates and guidance without
writing findings:

```bash
scripts/codenuke-progress.sh --ludicrous-mode --dry-run --limit 5
```

When debugging review quality, inspect both the finding evidence and the
guidance trace:

```bash
npx --yes codenuke@latest review --feature <featureId> --dry-run --json
npx --yes codenuke@latest show --finding <findingId> --json
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

Before starting an auto-fix loop, ask whether the user wants either:

- A bounded loop with no commits. Use the default 3-iteration budget unless the
  user gives another limit.
- A commit-and-continue loop. Commit each validated fix, then continue until
  there are no open actionable findings left.

Only use the commit-and-continue loop after the user explicitly opts in. If the
user already asked for commits or to continue until no fixes remain, treat that
as opt-in.

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

The dry-run output should expose the finding's guidance trace. During a real
fix, codenuke should apply that trace rather than rediscovering guidance from
scratch.

### Commit-And-Continue Loop

Use this mode only when the user opts in. Keep each commit finding-scoped so the
history can be reviewed or reverted cleanly.

For each iteration:

1. Confirm the source worktree is clean, excluding codenuke state directories
   such as `.codenuke/` unless the user asked to commit state.
2. Select and inspect the next open finding.
3. Run `fix` for that finding.
4. Review `git diff --stat` and `git diff`; remove unrelated generated or
   formatting-only changes before continuing.
5. Run the validation commands reported by codenuke and the repository's normal
   checks when practical.
6. Revalidate the same finding.
7. If revalidation says fixed and validation passed, stage only the relevant
   non-state files and create one commit for that finding.
8. Refresh the open report and continue with the next actionable finding.

Stop instead of committing or continuing when the fix touches unrelated files,
validation fails, revalidation is uncertain or still open, the worktree contains
pre-existing user changes, there is no clear next actionable finding, or the
changes need human review.

```bash
git status --short
npx --yes codenuke@latest next
npx --yes codenuke@latest show --finding <findingId>
npx --yes codenuke@latest fix --finding <findingId>
git diff --stat
git diff
npx --yes codenuke@latest revalidate --finding <findingId>
git add <relevant-non-state-files>
git commit -m "fix: address <short finding title>"
npx --yes codenuke@latest report --status open
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

Revalidation should assess both whether the finding is resolved and whether the
applied guidance still fits the final patch. Treat an uncertain revalidation as
a stop point for human review or a tighter follow-up fix.

If stale work locks block progress:

```bash
npx --yes codenuke@latest clean-locks
```

## Safety Rules

- Treat `review`, `report`, `next`, `show`, and `revalidate` as inspection
  commands.
- Treat `fix` as a mutating command. Run it only after selecting a specific
  finding and checking the worktree.
- Do not commit unless the user separately asks or opts in to the
  commit-and-continue loop. Do not push, open PRs, or land changes unless the
  user separately asks. codenuke itself does not do those actions.
- Do not hide validation failures. Report the failing command, whether the
  failure appears related to the patch, and the next concrete command to run.
- Keep `.codenuke/` out of commits unless the user explicitly wants codenuke
  state or reports checked in.

## Prompt And Eval Changes

When changing codenuke prompt, provider, or eval machinery, use the OpenAI Docs
skill and current official Codex/GPT-5.5 guidance first. Keep GPT-5.5 model
comparison evals on `codex`, `gpt-5.5`, and `medium` reasoning effort unless
the user or eval evidence justifies another setting. Do not set
`CODENUKE_CODEX_SKIP_GIT_REPO_CHECK` outside the eval runner; normal codenuke
provider calls should keep Codex trusted-directory checks enabled.

## Handoff

When finished, summarize:

- Commands run.
- Finding IDs fixed, revalidated, triaged, or still open.
- Commit hashes created, if any.
- Files changed outside `.codenuke/`.
- Validation commands and results.
- The next codenuke command the user should run.
