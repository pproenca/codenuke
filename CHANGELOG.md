# Changelog

## 0.5.0 — Effect-TS reimagining

Ground-up rebuild of codenuke from the legacy system's extracted intent (61
behavior rules), on Effect-TS. Not a port — a spec-first reconstruction.

### Capabilities (P0: C1–C11)

- **Scoring & value model (C1) + safety gates (C2)** — pure `decide()`: gates
  G1/G1′/G3/G4 then `loss = risk − gain`; keep iff admissible ∧ loss<0. `Verdict`
  surfaces **all** failing gates (RULE-063 fix).
- **Behavior fence (C3)** — AST-aware mutation audit, deterministic seeded
  sampling, Wilson intervals, survivor classification; **concurrency-invariant**
  (1 vs N → byte-identical artifact). Anti-tamper re-derivation (RULE-022).
- **Measurement (C5)** — AST node count / cyclomatic complexity / dup-window mass
  via the TypeScript compiler API.
- **Loop orchestration (C4)** — fail-closed startup gate (RULE-030/031), reduce
  autoloop (one worktree per run, propose→score→keep/revert), edit-surface guard,
  non-destructive result ref.
- **Worktree & proposer substrate (C6)** — isolated git worktrees; the real
  `@openai/codex-sdk` proposer (streamed turns → progress events, abort/timeout).
- **Config (C7)** — env → `codenuke.loop.json` → autodetect; argv-only commands.
- **Security guards (C8)** — one path-traversal/symlink guard (RULE-050 fix),
  subprocess env allowlist, `shell:false` everywhere.
- **Calibration (C9)** — per-repo value scales from git history.
- **Value-proxy (C10)** — Spearman ρ + exact/sampled permutation validation.
- **Change-cost (C11)** — held-out **real codex implementer** benchmark →
  `editTokens + β·verifyFrac` → 𝒱̂; implementer-surface guard (RULE-055).
- **Manual lifecycle (RULE-044)** — `init`/`score`/`accept`/`revert`/`status`/
  `cleanup` over a managed worktree; cumulative reduction % (RULE-062).
- **Results journal (RULE-041)** — `.codenuke/results.tsv` per run.

### The 5 legacy defects — fixed (not ported)

- RULE-054 changecost wired into the startup gate · RULE-063 all failing gates
  surfaced · RULE-053 one Schema-validated state reader · RULE-050 one path guard ·
  RULE-002/013 fence-gap min(scoring) vs mean(cost) made explicit.

### Architecture

Pure kernel + effectful `Layer` shell; tagged errors → POSIX exit codes; typed
progress `Stream`. Three packages (`@codenuke/core`, `@codenuke/fence`,
`@codenuke/runtime`) behind one `codenuke` CLI. `@openai/codex-sdk` is a runtime
dependency (external to the bundle).

### Tests

226 acceptance tests (179 pass / 39 skip / 8 todo), keyed to the behavior
contract; determinism property test; fence/loop/periodic verified end-to-end on
real git repos (the codex implementer ran live).

## Roadmap (post-0.5)

- **Raise-fence loop (RULE-040)** — when a region is inadmissible, raise its fence
  (proposer adds tests) + monotonic replay, instead of only reducing admissible
  regions. Mode-selection helpers (`chooseRegion`/`selectMode`) are already present.
- **Proposer thread continuity (RULE-057)** persistence; **budget enforcement**
  (RULE-058); **typecheck G3** wired into the loop (currently stubbed to 0).
- **Value-proxy/changecost anti-tamper** re-derivation; **calibration staleness**.
- **Fence**: node_modules linking in worktrees (RULE-045) + a bounded worktree pool.
- **Cross-repo differential harness** (legacy vs reimagined on fixture repos).
