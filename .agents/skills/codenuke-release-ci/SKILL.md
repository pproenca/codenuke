---
name: codenuke-release-ci
description: "Run, watch, debug, and summarize codenuke GitHub Actions once CI is wired (typecheck/test/build, security scanning, release proof) and triage branch-filter issues."
---

# codenuke Release CI

Use this with `$codenuke-release-maintainer` and `$codenuke-testing` for release validation or CI recovery.

GitHub Actions workflows (CI, security scanning, release proof) are not yet wired — roadmap in CHANGELOG.md. Until then, run the local proof (`pnpm typecheck` / `pnpm test` / `pnpm build`) per `$codenuke-testing`. The `gh` mechanics below apply once workflows land.

## Guardrails

- No version bump, tag, release, publish, workflow dispatch, or rerun storm without explicit approval when it has external side effects.
- Check exact SHA before reading logs or drawing conclusions.
- Fetch logs only for failed or relevant jobs.
- Default branch is `master`.

## Commands

```bash
gh run list --branch master --limit 10
gh run view <run-id> --json status,conclusion,headSha,url,jobs
gh run view <run-id> --job <job-id> --log
```

For workflow syntax/config changes, prefer local YAML checks plus `git diff --check` before pushing.

## Failure Triage

1. Confirm workflow, SHA, branch, and trigger.
2. List failed jobs only.
3. Fetch one relevant failed log.
4. Decide whether the failure is code, dependency, branch filter, tool availability, or unrelated flake.
5. Fix narrowly and rerun the smallest proof.

## Evidence

Record run URL, SHA, failed job names, local proof commands, and any proof gaps.
