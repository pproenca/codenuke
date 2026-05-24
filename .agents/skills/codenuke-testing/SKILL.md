---
name: codenuke-testing
description: "Choose, run, rerun, or debug codenuke typecheck, build, Vitest, packaging smoke, and the cheapest safe verification proof."
---

# codenuke Testing

Use this when deciding what to test, debugging failures, or validating a codenuke change.

## Default Rule

Prove the touched surface first.

- Type/API/package contract changes: `pnpm typecheck`.
- Runtime/package source changes: targeted package tests if obvious, then `pnpm test`.
- Bundling, published files, package data, or CLI entry changes: `pnpm build` plus packaging smoke.
- Dependency changes: `pnpm install --frozen-lockfile` and full typecheck/test/build proof (dependency audit not yet wired — roadmap in CHANGELOG.md).
- Docs/workflow/config-only: `git diff --check` plus YAML/config syntax and relevant workflow sanity.
- Release work: typecheck, build, test, packaging smoke (lint/audit not yet wired — roadmap in CHANGELOG.md).

## Commands

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
```

(lint/format/dependency-audit not yet wired — roadmap in CHANGELOG.md.)

Packaging smoke:

```bash
rm -rf /tmp/codenuke-pack /tmp/codenuke-cli-install
mkdir -p /tmp/codenuke-pack /tmp/codenuke-cli-install
pnpm build
npm pack ./apps/cli --pack-destination /tmp/codenuke-pack
npm install --prefix /tmp/codenuke-cli-install /tmp/codenuke-pack/codenuke-0.5.0.tgz
/tmp/codenuke-cli-install/node_modules/.bin/codenuke --version
```

## Guardrails

- Do not edit `dist/`, `.codenuke/`, `.clawpatch/`, tarballs, or `*.tsbuildinfo` to make proof pass.
- Do not replace repo scripts with raw `tsc` or `vitest` unless debugging the wrapper.
- If proof is blocked, report the exact command and first actionable error.
