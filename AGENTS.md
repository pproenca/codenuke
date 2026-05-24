# codenuke Maintainer Context

This repository is the modernized TypeScript codenuke workspace.

## Layout

- Root package: public package `codenuke`, owns the published CLI bin.
- Top-level package directories are internal development boundaries bundled into the root tarball.
- `config/src/main/program.md` is runtime prompt data, not documentation.
- `test-fixtures/legacy-loop/` is a test-only oracle for characterization tests. It is not runtime code and is not published by any package.
- `docs/` contains product docs only. Modernization analysis lives in `codenuke-modernize`.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
pnpm audit --prod --audit-level high
npm pack --json
```

Packaging smoke:

```bash
rm -rf /tmp/codenuke-pack /tmp/codenuke-cli-install
mkdir -p /tmp/codenuke-pack /tmp/codenuke-cli-install
pnpm build
npm pack --pack-destination /tmp/codenuke-pack
npm install --prefix /tmp/codenuke-cli-install /tmp/codenuke-pack/codenuke-0.4.0.tgz
/tmp/codenuke-cli-install/node_modules/.bin/codenuke --version
```

## Boundaries

- Do not commit `node_modules/`, `dist/`, tarballs, `.codenuke/`, or `*.tsbuildinfo`.
- Preserve the trusted-repo boundary in user docs and implementation.
- Do not reintroduce the old `.mjs` loop engine as runtime code, old local skills, `.scratch`, or modernization trace notes into this product repo.
