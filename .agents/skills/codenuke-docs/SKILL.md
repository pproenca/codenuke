---
name: codenuke-docs
description: "Write or review codenuke developer and user docs for CLI behavior, config, trust boundary, packaging, release notes, and maintainer guidance."
---

# codenuke Docs

Use this for docs under root `README.md`, root `CHANGELOG.md`, `docs/*` (`AI_NATIVE_SPEC.md`, `REIMAGINED_ARCHITECTURE.md`, `spec/*`), `MIGRATION_PLAN.md`, and root `CLAUDE.md`.

## Model

- Lead with what the user can do.
- Give one recommended path before alternatives.
- Keep examples runnable and aligned with current CLI output.
- Put trust-boundary warnings where users configure proposer, test, typecheck, or implementer commands (argv-only `CommandSpec`s, not shell strings).
- Keep maintainer-only workflow out of product docs unless it affects users.
- Do not treat the proposer prompt text in `packages/runtime/src/proposer/` as documentation; it is runtime prompt data.

## Page Shapes

- README: quickstart, requirements, commands, common config, trust boundary, package layout.
- Spec: runtime model, package ownership, gates, artifacts, keep/revert semantics.
- Publishing docs: exact release commands, pack/install smoke, approval points.
- Security docs: supported scope, trusted-repo model, reporting path (no `SECURITY.md` wired yet — roadmap in CHANGELOG.md; trust model lives in README + `docs/REIMAGINED_ARCHITECTURE.md`).
- Changelog: user-facing changes and fixes only.

## Verification

Run `git diff --check` for docs-only changes. Run CLI commands or package smoke when docs include commands whose behavior may have changed.
