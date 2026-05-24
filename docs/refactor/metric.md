---
title: Metric Refactor Canvas
summary: Establish codenuke's keep/revert score as a deterministic, guarded metric for unknown codebases.
read_when:
  - Changing scoring, measurement, gates, artifact validation, calibration, value-proxy, or changecost.
  - Adding a new reduction proposer, graph/IR pass, e-graph pass, or large-refactor strategy.
  - Deciding whether codenuke may run on an unfamiliar repository without human pre-calibration.
---

# Metric Refactor Canvas

## Thesis

codenuke currently has a coherent local keep/revert policy:

```text
keep iff gates pass and loss = risk - gain < 0
```

That is not yet an established metric for unknown codebases. To make it one, the
metric must be reframed as a conservative, behavior-constrained optimization target:

```text
maximize observed behavior-constrained reduction value per verification cost
```

The score should choose between candidates only after hard guardrails prove the
candidate is admissible. Guardrails are vetoes, not soft penalties that a large
reduction can buy through.

## Current State

Implemented in the v2 metric refactor:

- The pure kernel computes `gain`, `risk`, `loss`, gates, and `keep` deterministically.
- Measurement is pinned to TypeScript AST node count, cyclomatic complexity, and
  duplicate-window mass over non-test source files.
- Wilson confidence intervals, tie-averaged Spearman ranks, calibration derivation,
  value-proxy validation math, and changecost math have focused unit coverage.
- The startup readiness model includes changecost before value-proxy in the pure
  gap ordering.
- `score --json` and progress `Scored` events emit a versioned v2 envelope with
  metric identity, confidence, formula constants, provenance, artifact hashes,
  guardrails, and the inner `Verdict`.
- Runtime artifact loading reads raw artifact bytes, hashes them, decodes
  schemaVersion `1`, and re-derives fence Wilson values, calibration freshness and
  scales, value-proxy Spearman/permutation statistics, and changecost
  `verifyFrac`, `cost`, and `Vhat`.
- `score`, `accept`, and `run` share the same scorer path with real test,
  fence, calibration-scale, typecheck, diffsize, and guardrail inputs.
- Unknown repositories enter probation unless confidence is `validated`, with caps
  on iterations, changed source files, diff size, public exports, tests, config,
  dependencies, generated/vendor/binary/snapshot files, and import cycles when
  detectable.
- Deterministic JS/TS discovery emits stable `Opportunity` records for duplicate
  subtrees, wrapper chains, unused symbols, similar functions, and local
  simplifications without affecting scorer authority.
- Reference vectors cover metric math, v2 envelope JSON, guardrail failures,
  artifact tamper cases, discovery ordering, and the maintainer evaluation
  harness.

Still missing before this can be called established rather than probation-ready:

- A real held-out multi-repository corpus with human accept/reject or revert labels.
- Published lift numbers showing the weighted metric beats `dL > 0`, LOC-only,
  tests-pass-only, and random acceptance outside the repos used to tune constants.
- Language-plugin equivalents beyond JS/TS.

## Construct

Name the construct narrowly:

```text
Observed behavior-preserving reduction value
```

This explicitly does not claim full semantic equivalence. Full program equivalence
is not decidable in general. The operational relation is:

```text
before ~= after over observation set O
```

where `O` is the configured tests, typecheck, behavior fence, and any additional
public API or characterization observations. The strength of the claim is exactly
the strength of `O`.

## Target Metric

The first established metric should remain close to the current implementation:

```text
gain = dL_weight * (delta_ast / scale_ast)
     + dCx_weight * (delta_complexity / scale_complexity)
     + dDup_weight * (delta_dup_mass / scale_dup_mass)

risk = diffsize_coeff * diffsize
     + fence_weight * (1 - touched_region_fidelity)

loss = risk - gain

accept iff all_guardrails_pass and loss < 0
```

The second-generation north-star can generalize this from AST reduction to graph
compression:

```text
repo -> canonical typed repo graph
score -> behavior-constrained graph description length
accept -> graph_cost(after) + verification_cost < graph_cost(before)
```

Vector embeddings may help propose candidates, cluster duplicate regions, or rank
inspection order. They must not become the judge. The judge must stay deterministic,
versioned, and reproducible from repo SHA, config, artifact hashes, and toolchain.

## Guardrails

Minimum hard vetoes for unknown codebases:

- Tests pass.
- Type errors do not increase.
- Touched regions have valid, fresh behavior-fence evidence.
- No edits outside the allowed source surface.
- No test deletion, test weakening, or test discovery bypass.
- Public API and exports do not change unless explicitly allowed.
- Dependency files, package manager lockfiles, build config, CI config, and release
  config do not change unless explicitly allowed.
- Generated files, vendored files, minified files, binaries, and snapshots are not
  changed by default.
- Diff size, file count, and per-file edit size stay under probation caps.
- No new import cycles or package-boundary violations when the language graph can
  be computed.
- All metric artifacts are fresh and re-derived, not merely present.

For unknown repos, default to probation mode:

```text
probation:
  max_iterations: small
  max_files_per_candidate: 1
  max_diffsize: low
  allow_public_api_changes: false
  allow_dependency_changes: false
  require_fence_for_touched_region: true
  publish_to_result_ref_only: true
```

## Refactor Plan

### 1. Version the metric

Add a `MetricVersion` value and include it in every `Verdict` or `ScoreResult`.
Record:

- metric semantic version
- formula constants
- measurement representation
- TypeScript version
- codenuke package version
- repo baseline SHA
- config hash
- artifact hashes

Acceptance: same input bundle produces byte-identical verdict JSON.

### 2. Make artifacts real guardrails

Replace shallow readiness with a production artifact service that:

- decodes each artifact through `Schema`
- re-derives Wilson values
- re-derives calibration provenance
- re-runs value-proxy validation from rows
- re-derives changecost `verifyFrac`, `cost`, and `Vhat`
- fails closed on stale baselines or mismatched config

Acceptance: hand-edited `passed: true`, `admissible: true`, `cost`, or `Vhat`
fields are rejected even when `schemaVersion` is correct.

### 3. Remove scoring stubs

Wire the live scorer paths so `score`, `run`, and manual lifecycle use the same
gate assembly:

- tests from configured `CommandSpec`
- typecheck count from configured `CommandSpec`
- fence usability and touched-region fidelities from validated artifact status
- calibration scales from validated calibration artifact
- baseline type-error count from baseline measurement

Acceptance: a candidate with new type errors, failed tests, missing fence, or stale
calibration is rejected the same way through `score`, `accept`, and `run`.

### 4. Add unknown-repo probation

Introduce a run mode or policy layer for repositories without prior validation data.
It should reduce blast radius before the metric has local evidence.

Acceptance: a repo without validated historical calibration and proxy evidence can
only run under strict caps, and cannot edit public API, tests, config, dependencies,
generated files, binaries, or more than one source file per candidate.

### 5. Add graph/IR discovery without putting it in the judge

Add deterministic discovery passes that produce candidate opportunities:

- repeated AST subtree fingerprints
- anti-unification of similar functions or modules
- import/export graph simplifications
- unused symbol and wrapper chains
- e-graph simplification for local expressions

These passes propose candidates or prioritize regions. They do not override the
hard gates or metric verdict.

Acceptance: every discovery pass emits stable candidate IDs and deterministic input
hashes, and every accepted candidate still goes through the same scorer.

### 6. Prove validity against baselines

Create an evaluation corpus with held-out repositories and compare against:

- accept every `dL > 0` candidate
- LOC-only reduction
- tests-pass-only reduction
- random candidate acceptance
- current weighted score

Outcomes to track:

- human accept/reject
- post-accept test stability
- revert rate
- later bug or failure reports where available
- reduction retained after package build/typecheck/test
- verification cost per kept reduction

Acceptance: the weighted metric reports lift over trivial baselines, and the lift is
computed on repositories not used to tune constants.

## Audit Checklist

Before calling the metric established, all must be true:

- Metric construct, proxy, and assumed link are documented separately.
- The unit of analysis is fixed: candidate delta over a named repo region at a
  baseline SHA.
- Scale type and units are declared for every term.
- Empty and zero-denominator cases are defined.
- All iteration order and tie-breaks are deterministic.
- Floating-point tolerance is explicit.
- Every stored derived value is re-derived before trust.
- Every guardrail violation is a hard veto.
- The metric beats trivial baselines on held-out repos.
- Thresholds and constants have calibration evidence or are marked bootstrap-only.
- Reference implementation and test vectors exist.
- Verdicts report confidence: `bootstrap`, `calibrated`, or `validated`.

## Verification Commands

Metric math subset:

```sh
pnpm test packages/core/test/scoring.test.ts packages/core/test/measure.test.ts packages/core/test/kernel.test.ts packages/core/test/artifacts.test.ts packages/core/test/metric-vector.test.ts packages/core/test/discovery.test.ts packages/core/test/eval-harness.test.ts packages/fence/test/wilson.test.ts packages/runtime/test/calibrate.test.ts packages/runtime/test/value-proxy.test.ts packages/runtime/test/changecost.test.ts packages/runtime/test/startup-gate.test.ts packages/runtime/test/probation.test.ts packages/runtime/test/progress.test.ts packages/runtime/test/score.test.ts
```

Docs hygiene:

```sh
git diff --check -- docs/refactor/metric.md
```

Full safety pass before landing code changes:

```sh
pnpm typecheck
pnpm test
```
