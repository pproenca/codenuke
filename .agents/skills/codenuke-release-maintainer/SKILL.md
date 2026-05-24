---
name: codenuke-release-maintainer
description: "Prepare or verify codenuke releases, changelog entries, version changes, npm pack/install smoke, audit, tags, and publish guardrails."
---

# codenuke Release Maintainer

Use this for release and publish-time workflow. Ordinary development fixes use `$codenuke-testing`.

## Guardrails

- No version bump, tag, GitHub release, npm publish, or dist-tag mutation without explicit operator approval.
- Keep release work on a branch unless the operator explicitly says otherwise.
- Changelog entries should be user-facing and concise.
- Do not publish from dirty or unverified state.
- Do not commit tarballs, `dist/`, `.codenuke/`, `.clawpatch/`, or `*.tsbuildinfo`.

## Version Surfaces

- `apps/cli/package.json` is the public package version.
- Root `package.json` is the private workspace orchestrator.
- README and packaging smoke examples must match the public package version when changed.
- `apps/cli/CHANGELOG.md` is the release note source.

## Preflight

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
pnpm lint
pnpm --filter codenuke audit --prod --audit-level high
```

Then run the packaging smoke from root `AGENTS.md` and record the tarball name, installed CLI path, and `codenuke --version` output.

## Publish Shape

Use `npm pack ./apps/cli --json` before any publish. Publish only after approval and after verifying the packed tarball contents do not include maintainer harness files unless intentionally added to the public package.
