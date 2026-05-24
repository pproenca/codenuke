# codenuke Maintainer Context

Telegraph style. Root rules only. Skills own detailed workflows.

## Start

- Repo: `git@github.com:pproenca/codenuke.git`.
- Default branch: `master`. Keep CI branch filters aligned with `master` unless the repo is intentionally migrated.
- Runtime: Node >= 22, pnpm 11.1.2.
- Package manager: pnpm only. Do not swap package managers or introduce npm/yarn lockfiles.
- Replies: use repo-relative refs such as `packages/config/src/main/config.ts:20`.
- Missing deps: run `pnpm install --frozen-lockfile`, retry once after a clear install fix, then report the first actionable error.
- Before touching a subtree, read nearby docs/tests and package scripts. There are no scoped `AGENTS.md` files today.

## Map

- Root package: private workspace orchestrator only.
- Public CLI package: `apps/cli/`, package name `codenuke`, published bin `codenuke`.
- Internal implementation: `packages/*`, bundled into the CLI tarball.
- Runtime prompt data: `packages/config/src/main/program.md`. It is not product documentation.
- Product docs: `apps/cli/docs/` plus `apps/cli/README.md`, `apps/cli/SECURITY.md`, and `apps/cli/CHANGELOG.md`.
- Legacy oracle fixtures: `test-fixtures/legacy-loop/`. These are characterization fixtures only, not runtime code.
- Modernization analysis belongs in `codenuke-modernize`, not this product repo.

## Architecture

- codenuke is an autonomous behavior-preserving code reduction loop.
- Keep proposer and scorer boundaries clear: proposer edits an isolated worktree; scorer/artifact validation stays immutable from the candidate tree.
- The user's working tree must not be edited by the loop.
- Engine-owned subprocess calls should use argv-vector helpers where codenuke owns the command shape.
- Repo/operator-configured commands are trusted shell strings: `CN_PROPOSER`, `CN_IMPLEMENTER`, `CN_TEST`, `CN_TYPECHECK`, and `codenuke.loop.json` command fields.
- Preserve the trusted-repo boundary in docs and implementation. Do not imply codenuke safely executes untrusted repositories without an outer sandbox.
- Do not reintroduce the old `.mjs` loop engine as runtime code. `.mjs` files under `test-fixtures/legacy-loop/` are test-only oracles.
- Keep public CLI behavior and package exports stable unless the change explicitly targets them.
- Avoid compatibility shims unless they protect a documented public interface or shipped upgrade path.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
pnpm lint
pnpm --filter codenuke audit --prod --audit-level high
npm pack ./apps/cli --json
```

Packaging smoke:

```bash
rm -rf /tmp/codenuke-pack /tmp/codenuke-cli-install
mkdir -p /tmp/codenuke-pack /tmp/codenuke-cli-install
pnpm build
npm pack ./apps/cli --pack-destination /tmp/codenuke-pack
npm install --prefix /tmp/codenuke-cli-install /tmp/codenuke-pack/codenuke-0.4.0.tgz
/tmp/codenuke-cli-install/node_modules/.bin/codenuke --version
```

Use the repo scripts instead of raw `tsc`, `vitest`, or package-manager substitutions unless debugging a wrapper itself.

## Validation

- Use `$codenuke-testing` to choose proof.
- Prove the touched surface first: narrow tests for package-local logic, full `pnpm test` for shared behavior, and packaging smoke for bundled CLI/package surface.
- Run `pnpm typecheck` when TypeScript contracts change.
- Run `pnpm build` when exports, bundling, package data, dynamic imports, or published files can change.
- Run audit for dependency or release work.
- Docs/config/workflow-only changes need `git diff --check` plus the relevant syntax/tooling checks.
- If proof is blocked, report exactly which command was blocked and why.

## Code

- TypeScript ESM, strict. Avoid `any`; prefer real types, `unknown`, and narrow adapters.
- No `@ts-nocheck`. Suppressions require a short reason and should stay local.
- Prefer early returns and named domain intermediates over nested condition pyramids.
- Keep logic in the owning package. Avoid cross-package shortcuts that bypass package exports or tests.
- Use existing helpers for git, shell, JSON, config, guards, and artifact validation.
- Comments should explain non-obvious invariants, not narrate obvious assignments.
- Do not edit generated `dist/` output by hand.

## Tests

- Vitest tests live near package source under `packages/*/src/test`.
- Preserve characterization tests against `test-fixtures/legacy-loop/` when changing migrated behavior.
- Add behavior tests for user-facing or scoring changes. Prefer focused regression tests over broad string greps.
- Clean temp dirs, environment overrides, git test repos, and process state in tests.
- Do not edit snapshots/baselines/fixtures merely to silence failures without proving the behavior is intended.

## Docs

- Use `$codenuke-docs` for docs writing or review.
- Keep docs aligned with CLI behavior, config keys, trust boundary, release process, and package layout.
- Product docs live in `apps/cli/docs/` and `apps/cli/README.md`.
- `packages/config/src/main/program.md` is runtime proposer prompt data; edit it only when changing proposer behavior.
- Docs should say `trusted repositories` clearly when command execution or proposer/test commands are involved.

## GitHub / CI

- Existing workflows: CI, CodeQL, Dependency Review, and OpenGrep.
- CI should target `master`.
- For CI debugging, inspect exact SHA and relevant job logs only:

```bash
gh run list --branch master --limit 10
gh run view <run-id> --json status,conclusion,headSha,url,jobs
gh run view <run-id> --job <job-id> --log
```

- Do not comment, close, label, merge, publish, tag, or create releases without explicit approval.

## Git

- Preserve user changes. Do not reset, checkout, delete, or rename unexpected files.
- Commit only your intended files when asked to commit.
- Keep commits focused and conventional-ish.
- No manual stash/autostash unless explicitly requested.
- Do not touch `.clawpatch/**` unless the task is specifically about Clawpatch state.

## Release

- Use `$codenuke-release-maintainer` for release and publish work.
- Version bumps, git tags, GitHub releases, npm publish, and dist-tag changes require explicit approval.
- Release proof must include typecheck, build, tests, audit, and package install smoke.
- Changelog entries should be user-facing and concise.

## Boundaries

- Do not commit `node_modules/`, `dist/`, tarballs, `.codenuke/`, `.scratch/`, modernization trace notes, or `*.tsbuildinfo`.
- Do not add top-level personal `skills/` or OpenClaw channel/plugin/live-provider harnesses.
- Do not port OpenClaw runtime `src/agents` code into codenuke unless explicitly requested.
