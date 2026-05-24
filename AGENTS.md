# codenuke Maintainer Context

This repository is the modernized TypeScript codenuke workspace.

## Layout

- Root package: private workspace orchestrator only.
- `apps/cli/`: public package `codenuke`, owns the published CLI bin.
- `packages/*`: internal implementation modules bundled into the CLI tarball.
- `packages/config/src/main/program.md` is runtime prompt data, not documentation.
- `test-fixtures/legacy-loop/` is a test-only oracle for characterization tests. It is not runtime code and is not published by any package.
- `apps/cli/docs/` contains product docs only. Modernization analysis lives in `codenuke-modernize`.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
pnpm --filter codenuke audit --prod --audit-level high
npm pack ./apps/cli --json
```

Packaging smoke:

```bash
rm -rf /tmp/codenuke-pack /tmp/codenuke-cli-install
mkdir -p /tmp/codenuke-pack /tmp/codenuke-cli-install
pnpm build
tarball="$(npm pack ./apps/cli --pack-destination /tmp/codenuke-pack)"
npm install --prefix /tmp/codenuke-cli-install "/tmp/codenuke-pack/$tarball"
/tmp/codenuke-cli-install/node_modules/.bin/codenuke --version
```

## Boundaries

- Do not commit `node_modules/`, `dist/`, tarballs, `.codenuke/`, or `*.tsbuildinfo`.
- Preserve the trusted-repo boundary in user docs and implementation.
- Do not reintroduce the old `.mjs` loop engine as runtime code, old local skills, `.scratch`, or modernization trace notes into this product repo.
