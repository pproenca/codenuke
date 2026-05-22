# codenuke

**Autonomous, behavior-preserving code reduction.** An agent proposes a refactor, an
_immutable metric_ judges it, the change is kept only if it is genuinely smaller **and**
behavior-preserved — otherwise reverted. Repeat, unattended.

It is [Karpathy's `autoresearch`](https://github.com/karpathy/autoresearch) loop applied to
refactoring: there, an agent edits `train.py` and an immutable `val_bpb` keeps-or-discards;
here, an agent edits your source and an immutable scorer keeps-or-reverts. You don't touch
the engine — you point it at your repo and let it run. Everything happens in an isolated
git worktree, so **your working tree is never touched** and a reject is just a `git reset`.

> Why this is hard (and how the metric is built to be trustworthy) is written up in
> [`docs/spec.md`](docs/spec.md). Short version: "less code" is _not_ the
> objective — the objective is **lower future-change cost**, and the two diverge. codenuke
> measures the right thing instead of assuming it.

## How it works

```
            ┌─────────── isolated git worktree @ your baseline ───────────┐
 propose ──▶│  an LLM edits ONLY your source (no shell/git → can't game)   │
            └──────────────────────────────┬──────────────────────────────┘
                                            ▼
   score (immutable judge) ── lexicographic: gates ≻ value ──────────────────────────
     G1  behavior   the test suite stays green                    (was green at baseline)
     G1′ fence      the touched region's behavior-fence is trusted (mutation-score CI ≥ 0.90)
     G3  types      no new type errors                            (skipped if no typecheck)
     G4  size       net source AST nodes strictly decrease        (formatting-invariant)
     value         z-scored reduction (AST + complexity);  keep iff  loss = risk − value < 0
                                            ▼
   keep (commit, advance) ──── or ──── revert (git reset)  ──▶ log to .codenuke/results.tsv
```

Two things make it trustworthy enough to run unattended:

- **The scorer is immutable.** The proposer can only edit source (its toolset has no
  shell/git), so it cannot rewrite the judge — improving the score _requires_ genuinely
  improving the code. This is the property that makes `val_bpb` honest, reproduced here.
- **The behavior fence is measured, not assumed.** Tests are an _approximate_ behavior
  oracle. `codenuke fence` mutation-tests each region to measure how many behavior
  changes its tests actually catch (with a 95% CI). The loop only refactors a region whose
  fence clears the bar — and where it doesn't, it **earns** the right by first writing
  characterization tests until the fence clears (the _fence-raising_ move), then refactors.

## Quickstart

**Requirements:** Node ≥ 22, `git`, a JS/TS repo with a test command, and an LLM proposer —
the [`claude`](https://docs.claude.com/en/docs/claude-code) CLI by default (or any command
via `CN_PROPOSER`).

```bash
npm install -g codenuke          # or: npx codenuke …
cd your-repo                     # run from your repo root

# 1. Measure each source region's behavior-fence fidelity (periodic; minutes–hours).
codenuke fence

# 2. Run the loop: propose → score → keep/revert, unattended.
codenuke run 20
```

`fence` writes `.codenuke/fence-fidelity.json`; `run` works on a fresh `autoresearch/<tag>`
branch and logs every iteration to `.codenuke/results.tsv`. Nothing touches your tree.

## Configuration

Zero-config by default — codenuke auto-detects everything below. Override via a
`codenuke.loop.json` at your repo root or `CN_*` env vars.

| key (json)         | env            | default (auto-detected)                              |
| ------------------ | -------------- | ---------------------------------------------------- |
| `repo`             | `CN_REPO`      | current directory                                    |
| `srcDir`           | `CN_SRC`       | `src`                                                |
| `target`           | `CN_TARGET`    | `<srcDir>/` (the region the loop reduces)            |
| `baseline`         | `CN_BASE`      | `HEAD`                                               |
| `testCommand`      | `CN_TEST`      | vitest / jest / `npm test`                           |
| `typeCheckCommand` | `CN_TYPECHECK` | `tsc --noEmit` if a `tsconfig.json` exists, else off |
| `regions`          | `CN_REGIONS`   | subdirectories of `srcDir` with source               |
| `fenceLB`          | `CN_FENCE_LB`  | `0.90` (Wilson CI lower bound a region must clear)   |
| `tag`              | `CN_TAG`       | `run` (→ branch `autoresearch/run`)                  |

The proposer is also pluggable: `CN_PROPOSER="<shell cmd run in the worktree>"` replaces the
default `claude -p`.

## Commands

```
codenuke fence [cap=60] [seed=1337]   measure per-region behavior-fence fidelity (periodic)
codenuke run [iterations=5]           run the loop (propose → score → keep/revert)
codenuke score [--json]               score the current worktree change
codenuke changecost [ref]             evaluate change-cost on your benchmark (periodic; advanced)
codenuke init | accept | revert | status | cleanup
```

**`changecost` (advanced).** The cheap inner-loop value (AST/complexity) is a _proxy_ for
the real objective — future-change cost. `changecost` _measures_ it: it implements a
held-out benchmark of change-requests (`codenuke.benchmark/<id>/{meta.json,accept.test.ts}`)
and reports the realized edit + verification cost. Use it to validate that the cheap proxy
tracks real change cost before trusting long unattended runs. See [`docs/spec.md`](docs/spec.md).

## How honest is it?

codenuke is deliberate about the line between proved and measured (see [`docs/spec.md`](docs/spec.md)):

- **Safety is validated and measured.** The behavior-fence fidelity is mutation-tested with
  a CI; the type and size gates are exact. The fence-raising move is demonstrated to take a
  region from blocked to admissible autonomously.
- **The value signal is a _proxy_ under validation.** "Less code + complexity down" is a
  good but not ground-truth proxy for "cheaper future change." `changecost` is the
  ground-truth measurement; treat large unattended runs as experiments until the proxy is
  validated to track it on your repo. We are honest that this is the open frontier.

## The worked example

The repository no longer carries a legacy target implementation. The shipped code is the
loop CLI itself: `bin/` plus `loop/`. The deterministic eval and package smoke create
temporary target repositories so the metric, calibration, and readiness gates are tested
without mixing old review/fix workflow code into the package.

## License

MIT.
