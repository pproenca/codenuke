# codenuke

Autonomous, behavior-preserving code reduction. An agent proposes a refactor in an isolated git worktree, an immutable scorer judges it, and the change is kept only if it is smaller and behavior-preserving.

`codenuke` applies Karpathy's autoresearch loop to refactoring: propose, score, keep or revert, repeat. The user's working tree is not edited by the loop.

## Quickstart

Requirements:

- Node >= 22
- git
- a JavaScript or TypeScript target repo with a test command
- the `codex` CLI by default, or another proposer command via `CN_PROPOSER`

After publishing:

```bash
npx codenuke doctor
npx codenuke fence
npx codenuke calibrate
npx codenuke run 5
```

Local development from this repo:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
pnpm --filter codenuke codenuke --version
```

## Commands

```text
codenuke fence [cap=60] [seed=1337]   measure per-region behavior-fence fidelity
codenuke run [iterations=5]           run the propose -> score -> keep/revert loop
codenuke score [--json]               score the current worktree change
codenuke changecost [ref]             measure held-out change cost
codenuke validate-proxy [json]        validate proxy-vs-changecost rank correlation
codenuke calibrate                    derive per-repo value scales
codenuke doctor                       report readiness or precise gaps
codenuke init | accept | revert | status | cleanup
```

## Configuration

Configuration is resolved from `CN_*` environment variables, then `codenuke.loop.json`, then auto-detection.

Common settings:

| JSON key            | Environment    | Default                            |
| ------------------- | -------------- | ---------------------------------- |
| `repo`              | `CN_REPO`      | current directory                  |
| `srcDir`            | `CN_SRC`       | detected source directory          |
| `target`            | `CN_TARGET`    | all detected source regions        |
| `baseline`          | `CN_BASE`      | `HEAD`                             |
| `testCommand`       | `CN_TEST`      | detected test runner               |
| `typeCheckCommand`  | `CN_TYPECHECK` | detected `tsc`, otherwise disabled |
| `tag`               | `CN_TAG`       | `run`                              |
| `fenceLB`           | `CN_FENCE_LB`  | `0.90`                             |
| `proposerTimeoutMs` | `CN_TIMEOUT`   | `900000`                           |
| `proposerBudgetUsd` | `CN_BUDGET`    | `8`                                |

`CN_PROPOSER` replaces the default Codex proposer with a trusted shell command run in the isolated worktree.

## Trust Boundary

codenuke is intended for trusted repositories. Engine-owned git and process calls use argv-vector execution through the typed substrate, but repo/operator commands such as `CN_PROPOSER`, `CN_TEST`, `CN_TYPECHECK`, and commands from `codenuke.loop.json` remain trusted shell strings. Do not point codenuke at untrusted repositories without an outer sandbox.

## Package Layout

This repository is a pnpm workspace:

- Root package: private workspace orchestrator only.
- `apps/cli/`: public package `codenuke@0.4.0`, owns the published `codenuke` CLI bin.
- `packages/*`: private internal `@codenuke/*` modules bundled into the CLI tarball.

See [docs/spec.md](docs/spec.md) for the product architecture and [docs/publishing.md](docs/publishing.md) for release steps.
