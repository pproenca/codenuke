---
name: security-triage
description: "Triage codenuke security advisories, GHSA reports, trusted-repo boundary questions, command execution risks, dependency alerts, and secret-handling issues."
---

# Security Triage

Use when reviewing codenuke security reports, dependency alerts, or GHSA drafts.

## Close Bar

Close only if the report is a duplicate, invalid against shipped behavior, out of scope under `apps/cli/SECURITY.md`, or fixed before any affected release.

Do not close only because the current branch is fixed if the latest shipped npm package is affected.

## Required Reads

1. Read `apps/cli/SECURITY.md`.
2. Inspect implicated code paths.
3. Verify shipped state with tags and npm package version when relevant.
4. Check whether the behavior is inside codenuke's documented trusted-repo model.

Useful commands:

```bash
git tag --sort=-creatordate | head -n 20
npm view codenuke version --userconfig "$(mktemp)"
git tag --contains <commit>
git show <tag>:<path>
```

## Review Method

Decide one of:

- `close`
- `keep open`
- `keep open but narrow`

Separate vulnerability status from hardening. Same-user trusted repository command execution is usually a documented trust-boundary issue, not a vulnerability, unless a codenuke-owned argv-vector path crosses that boundary unexpectedly.

## Output

Give the advisory/report URL when available, verdict, code refs, shipped-version facts, and a maintainer-ready response. Never print secrets.
