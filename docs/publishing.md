# Publishing

This repository publishes one public CLI package: `codenuke`.

The internal workspace packages are development boundaries only. They are bundled into `dist/cli.js` before packing, so the npm artifact is one tarball.

## Preflight

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
pnpm audit --prod --audit-level high
git diff --check
```

## Pack Smoke

```bash
rm -rf /tmp/codenuke-pack /tmp/codenuke-cli-install
mkdir -p /tmp/codenuke-pack /tmp/codenuke-cli-install
pnpm build
npm pack --pack-destination /tmp/codenuke-pack
npm install --prefix /tmp/codenuke-cli-install /tmp/codenuke-pack/codenuke-0.4.0.tgz
/tmp/codenuke-cli-install/node_modules/.bin/codenuke --version
/tmp/codenuke-cli-install/node_modules/.bin/codenuke
```

Expected version: `0.4.0`.

## Publish

Create and inspect the single tarball:

```bash
npm pack --json
tar -tf codenuke-0.4.0.tgz | sed -n '1,80p'
```

Publish the root package:

```bash
npm publish --access public
```

Finally verify from the registry:

```bash
npx codenuke --version
npx codenuke
```

The internal `@codenuke/*` package names are not published in this packaging model.
