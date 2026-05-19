---
name: evals-and-smoke
description: Run codenuke evals and package smoke checks when mapping, provider contracts, refactoring resources, or npm packaging changes.
---

Use this skill when a change affects feature mapping, provider output contracts,
packaged refactoring resources, guidance traces, the CLI package contents, npm
install behavior, or the end-to-end user workflow.

## Evals

Run the local eval fixtures from the repository root:

```bash
pnpm eval
```

The eval command builds first and then runs `evals/scripts/run-all.mjs`. Treat
failures as product-level regressions unless the fixture expectation is
intentionally being updated. Inspect `evals/results/latest.json` for the current
run, but do not commit result churn unless the change explicitly updates eval
expectations.

## Package smoke

Run the package smoke check when the change touches `package.json`, `README.md`
install guidance, `src/cli.ts`, build output shape, published files,
`resources/refactoring/`, guidance loading, or any path used by the package
entrypoint:

```bash
pnpm pack:smoke
```

If a local substitute is used instead of the full smoke command, say exactly
what was skipped and why.
