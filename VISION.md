# codenuke Vision

codenuke is an autonomous, behavior-preserving code reduction tool.

It applies an autoresearch loop to refactoring: a proposer makes one focused reduction in an isolated git worktree, immutable scoring decides whether the change is smaller and behavior-preserving, and only passing candidates are kept.

The goal is not to make code look different. The goal is to remove real logical code while preserving behavior users and tests rely on.

## Priorities

- Safety gates before value: tests, type errors, behavior-fence fidelity, and strict AST reduction.
- A clear proposer/scorer split, so candidate edits cannot weaken the judge.
- Trusted-repo clarity in docs, prompts, and implementation.
- Reliable packaging and install smoke for the public `codenuke` CLI.
- High-quality calibration, fence, value-proxy, and change-cost artifacts.
- Small, reviewable trajectories with enough data to explain why a candidate was kept or rejected.
- Documentation that accurately describes command trust, isolated worktrees, package layout, and release steps.

## Direction

codenuke should be easy to try on a trusted JavaScript or TypeScript repository, strict when safety artifacts are stale or weak, and boring to package. The loop should become more useful by improving the scorer, artifact quality, proposer prompt, and diagnostics, not by hiding risk behind broad fallbacks.

The project is intentionally smaller than a general agent platform. Optional integrations should not blur the core contract: propose, score, keep or revert, repeat.

## Non-Goals

- A general-purpose agent runtime or chat platform.
- OpenClaw's plugin, channel, provider, or live messaging architecture.
- Treating untrusted repositories as safe without an outer sandbox.
- Reintroducing the old `.mjs` loop engine as runtime code.
- Shipping local maintainer harness files in the published CLI package.
- Adding large compatibility layers that obscure the current TypeScript implementation.

## Contribution Shape

Prefer one focused topic at a time. Behavior changes should include tests near the affected package. Public CLI or package changes should update docs and release notes. Security-sensitive changes should preserve the trusted-repo boundary and make dangerous paths explicit.
