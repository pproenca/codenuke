# Codecharter Proxy Validation Run

Date: 2026-05-22

Purpose: close the release criterion that the calibrated inner-loop value proxy is validated
against held-out change-cost on at least one real repository before recommending long unattended
runs.

## Corpus

- Source repo: `/Users/pedroproenca/Documents/Projects/codecharter`
- Source repo state: detached temporary worktree from `HEAD`; the dirty user checkout was not
  modified.
- Temp worktree: `/var/folders/hs/z6xcqq0j505ff5kyb39z0fb40000gn/T/codenuke-codecharter-proxy-LxU0q1/codecharter`
- Base fixture commit: `763c7ee342db9eb53912275a355e6b231bb73ce1`
- Candidate refs:
  - `small`: `24fc2c45189e5e2cd904ae261e7257eab4b99728`
  - `medium`: `97d44e920c0bef6297b9d34b3d92653b06cc5dae`
  - `tuple`: `32cf8183a102b81b7ebf54974cb04ca0666fd92d`

The corpus added a small role-policy module and baseline test inside the temporary codecharter
worktree, then measured three behavior-equivalent reductions of that module. The held-out
benchmark contained two additive future-change requests:

- `auditor`: add an auditor role that can share maps, cannot create or delete maps, and has a
  project limit of 4.
- `reviewer`: add a reviewer role that can create and share maps, cannot delete maps, and has a
  project limit of 6.

Both deltas used hidden acceptance tests installed by `codenuke changecost`, plus the full
codecharter suite (`pnpm test` from `codenuke.loop.json`).

## Metric Path

1. `codenuke score --json` measured the calibrated inner-loop value proxy for each candidate
   against the same base ref. All candidates passed hard gates first:
   `G1`, `G1prime`, `G3`, and `G4`.
2. `codenuke changecost <candidate-ref>` measured held-out `Vhat` for each candidate with a
   scripted `CN_IMPLEMENTER`. Each candidate completed `done=2/2`.
3. `codenuke validate-proxy` computed Spearman correlation over `{ proxy, Vhat }` rows.

This is the intended spec path: gates first, calibrated proxy second, held-out
`changecost`/Spearman validation before long unattended runs.

## Results

| Candidate | Proxy | Vhat | Changecost deltas           |
| --------- | ----: | ---: | --------------------------- |
| `small`   |  4.20 |   17 | `auditor=15`, `reviewer=19` |
| `medium`  |  4.36 |   17 | `auditor=15`, `reviewer=19` |
| `tuple`   |  5.88 |   14 | `auditor=14`, `reviewer=14` |

Validation artifact:

```json
{
  "passed": true,
  "reason": null,
  "candidates": 3,
  "minimumCandidates": 3,
  "minimumRho": 0.6,
  "rho": 0.8660254037844387
}
```

CLI output:

```text
value proxy validation: PASS rho=0.866 min=0.6 candidates=3/3
```

## Interpretation

This satisfies the local deterministic release criterion for one real repository: higher scorer
proxy rank tracked lower held-out change-cost with `rho >= 0.6`. It does not claim LLM-backed
variance bounds or multi-repo generality; those remain future validation work beyond the v0.1
release bar.
