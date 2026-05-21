# Semantic ROI Autoresearch Harness

Status: ready-for-agent

## Goal

Implement a sealed Semantic ROI Autoresearch Harness that proves whether semantic map evidence improves codenuke review/fix quality. Completion is verified by a deterministic A/B eval command, provisionally named `pnpm eval:semantic-roi`, that runs the same sealed fixtures with semantic evidence disabled and enabled, rejects test/eval/scorer mutation, writes an experiment ledger with per-fixture metrics, aggregate delta, hard constraint failures, and a keep/discard decision, and passes the normal verification suite.

Preserve the existing Trusted Refactoring Workflow safety model: review remains read-only, fix remains finding-scoped, normal fix may still add focused tests, and ROI proof runs must reject test, fixture, sealed-evaluator-behavior-check, scorer, generated-output, local-state, lockfile, and agent-skill mutation.

Use production mapping, semantic evidence, workflow, prompt, provider, eval-runner, and reporting code as the mutable implementation surface. Treat ROI fixtures, sealed evaluator behavior checks, expected outputs, scoring rules, and comparison logic as the sealed evaluator.

Between iterations, inspect the failed evidence layer first: evaluator integrity, semantic evidence mode switching, A/B isolation, review candidate quality, fix quality, Patch Boundary health, validation health, and ledger decision. If the harness cannot be made defensible without changing the sealed evaluator or weakening codenuke safety constraints, stop with attempted paths, evidence gathered, blocker, and the next decision needed.

The implementation is done when `pnpm eval:semantic-roi` exists, writes a ledger record with control/treatment/delta/decision evidence, enforces hard constraints, produces a final audit report that separates proven behavior, proxy evidence, unproven model-backed ROI, and blockers, and the following verification passes: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm eval`, `pnpm eval:map`, and `pnpm eval:semantic-roi`.

## Autoresearch Principle

This PRD applies the concept behind Karpathy's `autoresearch`, not just its surface mechanics. The important step-change is that research velocity improves by converting open-ended human tinkering into many small, comparable, mechanically judged experiments. The agent is useful because it can repeatedly propose one focused change, run a fixed evaluator, keep the change only when evidence improves, discard it when evidence regresses, and leave a ledger of the search.

In `karpathy/autoresearch`, that step-change comes from several constraints working together:

- the agent edits one mutable research surface, `train.py`
- the evaluator and metric live outside that surface in fixed preparation/evaluation code
- every run uses a fixed time budget, making experiments comparable on the same hardware
- the goal is a single measurable metric, validation bits per byte
- every experiment is logged with keep, discard, or crash status
- the result ledger is not part of the winning code change
- equal or worse metric results are reset rather than rationalized
- simplicity matters: an equal result with simpler code can be worth keeping, while tiny gains with ugly complexity may not be

The portable lesson is not "let an agent loop forever." The portable lesson is "make progress mechanically auditable." Any domain can use the pattern when it has a sealed evaluator, a bounded mutable surface, a stable metric, a repeatable experiment budget, a result ledger, and a keep/discard rule that is harder to game than the implementation surface.

For codenuke, the equivalent step-change is not more prompts or broader agent autonomy. It is a proof harness where semantic algorithms can only win by improving the Trusted Refactoring Workflow under a sealed evaluator. A semantic change must beat the no-semantic control on candidate quality, fix quality, and safety constraints. It must not win by changing fixtures, expected outputs, tests, scorers, provider configuration, generated state, or Patch Boundary policy.

Sources:

- `karpathy/autoresearch` README: https://raw.githubusercontent.com/karpathy/autoresearch/refs/heads/master/README.md
- `karpathy/autoresearch` program: https://raw.githubusercontent.com/karpathy/autoresearch/refs/heads/master/program.md

## Phase Boundary

This work has two phases that must not be confused.

Phase 1 is harness construction. During this phase, Codex may add or modify tests, ROI fixtures, sealed evaluator behavior checks, expected outputs, scoring code, comparison code, docs, and package scripts needed to create the evaluator. The goal of Phase 1 is to build the sealed evaluator and record the first passing deterministic baseline.

Phase 2 is semantic ROI experimentation. After the first passing deterministic baseline is recorded, the evaluator becomes sealed for ROI experiments. Future autoresearch iterations may change only the declared mutable implementation surface: production mapping, semantic evidence, workflow, prompt, provider, eval-runner integration, and reporting code. A change to sealed evaluator files during Phase 2 invalidates the experiment and must be treated as blocked unless the user explicitly starts a benchmark revision task.

The no-test-mutation rule applies to Phase 2 ROI experiments, not to Phase 1 harness construction and not to normal user-facing `codenuke fix`. Normal fix may still add or update focused tests when Trusted Refactor Regression Coverage requires behavior preservation.

## Hard Constraints

The ROI decision has hard constraints. If any hard constraint fails, the experiment is `discard` or `blocked` even if one quality metric improves.

- no mutation to ROI fixtures, expected outputs, sealed evaluator behavior checks, scoring rules, or comparison logic during Phase 2
- no mutation to ordinary project tests during Phase 2 ROI proof runs
- no mutation to generated output, local state, package lockfiles, agent skills, or the issue tracker during measured experiments
- no dirty-worktree violation or destructive git operation in the user's working tree
- no Patch Boundary violation
- no validation failure
- no malformed provider output accepted as success
- no provider/model/reasoning configuration drift between control and treatment
- no unrecorded keep/discard decision

## Score And Decision Policy

The first deterministic ROI command should use a composite score with hard constraints. Treatment must improve the composite score over control, or tie while reducing implementation complexity without weakening any hard constraint. A treatment that increases recall by flooding weak Refactoring Findings, broadens patch scope, or changes tests must not win.

The ledger decision vocabulary is:

- `keep`: treatment improves the composite score over control and all hard constraints pass, or quality ties while implementation complexity is meaningfully lower
- `discard`: treatment regresses, ties with greater complexity, increases false positives, or trips a hard constraint
- `crash`: the run fails because the implementation or provider crashes before producing comparable observations
- `blocked`: the harness cannot run because required configuration, provider access, clean worktree state, or sealed evaluator integrity is missing

Deterministic ROI proof is the completion target for this PRD. Model-backed ROI is a separate optional strengthening path unless the user explicitly includes it in the active Goal. Model-backed runs should be recorded as proxy evidence until repeated enough to handle provider variance.

## End User Behavior

For an end user running codenuke on an unfamiliar repository, this change should make semantic evidence visible and useful in the normal Trusted Refactoring Workflow without adding unsafe autonomy.

Expected behavior:

1. The user runs `codenuke init` and `codenuke map` as usual.
2. `map` produces stable Feature Slices and persists semantic-neighbor evidence when the mapper finds meaningful domain-vocabulary links between slices.
3. The user runs `codenuke review` as usual.
4. Review uses semantic evidence as supporting context for sibling scope, duplication, and bounded refactoring opportunities, but it still must prove each Refactoring Finding from included files. Semantic evidence alone is not enough to create a finding.
5. If semantic evidence materially shapes a finding, the finding records `mapEvidenceTrace`.
6. The user runs `codenuke report`, `codenuke show`, or JSON report commands and can see whether map evidence shaped a finding.
7. The user runs `codenuke fix --finding <id>` as usual. Fix receives the finding's map evidence trace as context for sibling scope, but it remains finding-scoped and must respect the Patch Boundary.
8. The user runs `codenuke revalidate --finding <id>` as usual. Revalidation uses the same map evidence trace to decide whether the issue is fixed, still open in a linked Feature Slice, false-positive, or uncertain.
9. Normal fix behavior is unchanged where behavior preservation requires focused tests. The stricter no-test-mutation rule applies only to sealed ROI proof runs, not to ordinary user-facing fixes.
10. Users do not get automatic commits, pushes, PRs, or destructive git resets from this feature.

For maintainers improving codenuke itself, this change adds a new eval behavior:

1. The maintainer runs `pnpm eval:semantic-roi`.
2. The command runs sealed control/treatment comparisons with semantic evidence disabled and enabled.
3. The command rejects evaluator/test/scorer mutation during measured ROI experiments.
4. The command writes an experiment ledger with per-fixture metrics, aggregate delta, hard constraint failures, and keep/discard/crash/blocked decision.
5. The command exits non-zero when treatment does not beat control or when any hard constraint fails.

## Integration Outcomes

This PRD must serve two outcomes at the same time. Implementing only one is not enough.

The first outcome is the user-facing codenuke flow: an engineer can start from an unfamiliar codebase and move through a systematic Trusted Refactoring Workflow that makes the codebase leaner, more maintainable, and more robust. Semantic algorithms should improve that flow by creating stable Feature Slices, durable semantic evidence, better Refactoring Opportunity Candidates, better bounded Refactoring Findings, safer Patch Boundaries, and more informed fix/revalidation prompts. The flow should connect naturally across `init`, `map`, `review`, `report`/`show`, `fix`, `revalidate`, and repeated Refactoring Campaigns.

The second outcome is the codenuke-improvement loop: codenuke itself can be improved by an autoresearch-style evaluator that measures whether changes to mapping, semantic evidence, Guidance Selection, prompts, workflow wiring, or provider contracts produce higher-quality Trusted Refactoring Workflow outcomes. This loop should not merely test one fixture. It should compare control versus treatment, preserve a sealed evaluator, write a ledger, and keep or discard implementation changes based on evidence.

The two outcomes are coupled but distinct:

- Product flow integration answers: "Does codenuke help users go from not knowing the codebase to delivering safer, smaller, behavior-preserving refactors?"
- Autoresearch integration answers: "Can codenuke improve itself at producing those outcomes without gaming its evaluator?"

The Semantic ROI Autoresearch Harness is successful only when it validates both. A semantic algorithm must improve the user-facing Trusted Refactoring Workflow, and the measurement loop must be strong enough to guide future codenuke changes. If the harness proves eval plumbing but does not affect `map -> review -> fix -> revalidate`, it is incomplete. If semantic evidence improves one manual workflow but cannot be measured and improved through the sealed loop, it is also incomplete.

Required integration points:

- `map`: persist stable Feature Slices and semantic evidence that review, fix, and revalidation can consume without rediscovering codebase structure from scratch.
- `review`: use semantic evidence as a lead for sibling scope, duplication, and bounded refactoring opportunities while still requiring local evidence before creating a Refactoring Finding.
- `report` and `show`: expose whether map evidence shaped a finding through durable `mapEvidenceTrace` so users and evals can audit the path from map evidence to finding.
- `fix`: use the finding's map evidence trace as sibling-scope context without expanding beyond the Patch Boundary unless the finding explicitly justifies it.
- `revalidate`: use map evidence trace to decide whether the original finding was truly resolved or remains open in a linked Feature Slice.
- `eval`: run sealed control/treatment comparisons that measure candidate quality, fix quality, false positives, Patch Boundary health, validation health, and evaluator integrity.
- result ledger: preserve the codenuke-improvement search history separately from product code changes, including keep, discard, crash, and blocked decisions.

User-facing outcome metrics should include fewer weak findings, higher-quality bounded findings, clearer evidence, smaller safer patches, fewer Patch Boundary failures, fewer validation failures, stronger behavior preservation, and more useful revalidation decisions.

Codenuke-improvement outcome metrics should include control/treatment delta, candidate recall at review scope, false positive rate, map evidence trace correctness, fix success against sealed behavior checks, patch size, changed-file count, validation results, evaluator mutation failures, and keep/discard status.

## Problem Statement

Codenuke has started to persist semantic-neighbor evidence on Feature Slices and pass that evidence into review, fix, revalidation, and reports. The current deterministic fixture proves the plumbing works: map evidence can reach review and a finding can carry a map evidence trace. That is not enough to prove the product claim the user cares about.

The user wants to prove that linguistic and semantic algorithms actually make the Trusted Refactoring Workflow better at finding and fixing behavior-preserving Refactoring Findings. The proof must be robust enough to avoid a common agentic failure mode: the agent changes implementation and tests or expectations together, then the loop calls the result an improvement. In Karpathy's autoresearch terms, codenuke needs a fixed evaluator equivalent to the data prep and evaluation harness, a narrow mutable research surface equivalent to the training file, a stable metric equivalent to the validation metric, and a mechanical keep/discard decision.

The concern is that codenuke may have copied the surface shape of autoresearch without fully integrating the underlying discipline. A shallow loop can run evals and record results, but it cannot prove ROI if the evaluation surface, fixture expectations, tests, scoring logic, and implementation all move together.

## Solution

Build a sealed Semantic ROI Autoresearch Harness for codenuke's Trusted Refactoring Workflow.

The harness will run controlled A/B experiments over the same fixtures, same provider, same model settings, and same Change Scope. The control run disables semantic map evidence. The treatment run enables semantic map evidence. The harness then scores whether semantic evidence improves review/fix quality without increasing false positives, Patch Boundary failures, validation failures, or test/evaluator mutation.

The evaluator must be sealed during experiments. Fixtures, fixture expectations, sealed evaluator behavior checks, scoring logic, comparison logic, and no-mutation policies are part of the fixed harness. The mutable research surface is limited to production code and prompt/resource surfaces that can plausibly improve semantic evidence, Guidance Selection, review prompting, fix prompting, or revalidation behavior.

The harness should produce a durable experiment ledger with baseline, control, treatment, metrics, constraint failures, keep/discard decision, and short rationale. A change is kept only when treatment improves the agreed composite score and all safety constraints pass. A change is discarded when it improves one visible fixture by weakening evaluator integrity, changing tests, broadening patch scope, or increasing false positives.

This PRD extends the existing map-quality autoresearch ADR. The map-quality loop proves semantic evidence can be produced stably. This PRD proves whether that evidence produces better review/fix outcomes.

## User Stories

1. As a codenuke maintainer, I want a sealed evaluator for semantic ROI, so that agentic experiments cannot improve the score by editing fixtures, tests, or scoring rules.
2. As a codenuke maintainer, I want a clear mutable research surface, so that agents know which production modules they may change during semantic ROI experiments.
3. As a codenuke maintainer, I want a control run with semantic evidence disabled, so that absolute model behavior is not mistaken for semantic algorithm impact.
4. As a codenuke maintainer, I want a treatment run with semantic evidence enabled, so that I can measure the delta caused by map-time semantic evidence.
5. As a codenuke maintainer, I want the same provider and model settings used for control and treatment, so that the comparison isolates semantic evidence as the variable.
6. As a codenuke maintainer, I want deterministic fixtures for candidate discovery, so that the harness can fail quickly when semantic evidence no longer reaches review.
7. As a codenuke maintainer, I want model-backed fixtures for candidate quality, so that ROI is measured against real provider judgment rather than mock-only behavior.
8. As a codenuke maintainer, I want sealed evaluator behavior checks, so that fixes cannot pass by changing visible expectations only.
9. As a codenuke maintainer, I want the harness to reject changed test files during ROI experiments, so that the agent cannot win by rewriting tests to match its patch.
10. As a codenuke maintainer, I want the harness to reject changed eval fixtures, so that the agent cannot move the benchmark while claiming improvement.
11. As a codenuke maintainer, I want the harness to reject changed scoring code during a measured experiment, so that the keep/discard decision stays trustworthy.
12. As a codenuke maintainer, I want fixture checksums recorded before each run, so that evaluator mutation is caught even when files are changed and restored during the loop.
13. As a codenuke maintainer, I want a no-test-mutation policy distinct from normal fix behavior, so that production codenuke can still add tests while ROI proof remains sealed.
14. As a codenuke user, I want codenuke to find better Refactoring Findings because of semantic algorithms, so that the tool discovers useful sibling-scope opportunities I would otherwise miss.
15. As a codenuke user, I want semantic evidence to improve review recall without noisy broad findings, so that high recall does not degrade trust.
16. As a codenuke user, I want fix scope to remain bounded even when semantic neighbors are present, so that semantic evidence does not become permission for broad rewrites.
17. As a codenuke user, I want semantic evidence to help revalidation reason about sibling risk, so that a fix is not marked successful while the same bounded issue remains in a linked Feature Slice.
18. As a codenuke user, I want reports to show when map evidence shaped a finding, so that I can audit why a sibling refactoring opportunity was suggested.
19. As a codenuke maintainer, I want candidate recall at a small k, so that the metric rewards semantic evidence that moves the right opportunity into review scope.
20. As a codenuke maintainer, I want false positive rate measured, so that semantic algorithms do not win by flooding review with weak Refactoring Signals.
21. As a codenuke maintainer, I want map evidence trace correctness measured, so that findings only get credit when they cite the relevant semantic neighbor.
22. As a codenuke maintainer, I want fix success measured against sealed behavior tests, so that the treatment must preserve behavior instead of only producing plausible patches.
23. As a codenuke maintainer, I want Patch Boundary failures measured, so that semantic evidence does not degrade the safety model.
24. As a codenuke maintainer, I want changed-file count and patch size measured, so that semantic evidence does not produce larger patches without better outcomes.
25. As a codenuke maintainer, I want Guidance Selection impact separated from semantic map impact, so that improvements can be attributed to the right subsystem.
26. As a codenuke maintainer, I want review quality separated from fix quality, so that a semantic improvement in discovery is not hidden by a weak patching provider.
27. As a codenuke maintainer, I want fix quality separated from revalidation quality, so that revalidation failures do not obscure whether the patch was actually good.
28. As a codenuke maintainer, I want deterministic and model-backed metrics reported separately, so that CI-friendly checks are not confused with live model ROI.
29. As a codenuke maintainer, I want per-fixture deltas, so that a composite score can be debugged when one fixture improves and another regresses.
30. As a codenuke maintainer, I want aggregate deltas, so that a semantic change can be judged by the whole benchmark rather than one cherry-picked fixture.
31. As a codenuke maintainer, I want an experiment ledger, so that overnight or repeated runs leave an auditable trail of kept, discarded, and crashed experiments.
32. As a codenuke maintainer, I want a baseline-first run, so that every experiment has an explicit starting point before changes are judged.
33. As a codenuke maintainer, I want a mechanical keep/discard decision, so that agents cannot hand-wave an inconclusive result as progress.
34. As a codenuke maintainer, I want a crash status, so that failed runs are logged without being confused with quality regressions.
35. As a codenuke maintainer, I want a timeout policy for model-backed runs, so that an experiment cannot hang indefinitely.
36. As a codenuke maintainer, I want a fixed provider/model/reasoning configuration in each comparison, so that model drift and parameter changes are visible.
37. As a codenuke maintainer, I want model variance recorded, so that a single lucky model run is not overclaimed as durable ROI.
38. As a codenuke maintainer, I want repeated model-backed samples to be optional, so that expensive provider comparisons can be run deliberately.
39. As a codenuke maintainer, I want local deterministic checks to remain fast, so that the sealed harness can still run during ordinary development.
40. As a codenuke maintainer, I want ROI experiments to run in isolated worktrees or isolated state, so that .codenuke state and generated results do not pollute the user's repository.
41. As a codenuke maintainer, I want generated result files kept out of winning commits unless explicitly requested, so that experiment artifacts do not churn the repo.
42. As a codenuke maintainer, I want the harness to preserve dirty-worktree safeguards, so that autoresearch-style experiments do not silently overwrite user work.
43. As a codenuke maintainer, I want experiment branches or checkpoints to be explicit, so that keep/discard does not run destructive git operations on unrelated user changes.
44. As a codenuke maintainer, I want an experiment to fail if it edits package lockfiles, generated output, local state, or agent skills, so that ROI proof stays focused on product code.
45. As a codenuke maintainer, I want the semantic evidence switch to be explicit, so that control and treatment runs are easy to inspect and reproduce.
46. As a codenuke maintainer, I want semantic evidence disabled without deleting mapper code, so that the control path uses the same mapper except for evidence injection.
47. As a codenuke maintainer, I want review prompts to record whether semantic evidence was enabled, so that stored runs can be interpreted later.
48. As a codenuke maintainer, I want fix and revalidation prompts to carry the same map evidence trace when applicable, so that downstream stages can use the evidence consistently.
49. As a codenuke maintainer, I want failure messages to identify the failed layer, so that an AFK agent can distinguish evaluator mutation, mapping regression, review miss, fix failure, or revalidation failure.
50. As an AFK agent, I want the PRD to name deep modules and stable interfaces, so that I can implement this without rediscovering the architecture.
51. As an AFK agent, I want tests for no-mutation guards, so that I do not accidentally create a harness that can be gamed.
52. As an AFK agent, I want tests for A/B scoring, so that the treatment only wins when it beats the control under the agreed metrics.
53. As an AFK agent, I want tests for semantic evidence disabling, so that the control condition is real and not just another treatment run.
54. As an AFK agent, I want tests for result ledger decisions, so that keep, discard, crash, and blocked statuses are stable external behavior.
55. As an AFK agent, I want docs for adding new ROI fixtures, so that future benchmark expansion preserves evaluator integrity.
56. As an AFK agent, I want docs that explain why normal fix may change tests but ROI proof may not, so that contributors do not collapse the two policies.
57. As an AFK agent, I want docs that explicitly map the harness to Karpathy's autoresearch concepts, so that the project integrates the principles instead of imitating the surface loop.

## Implementation Decisions

- Implement the Semantic ROI Autoresearch Harness as a first-class eval surface for the Trusted Refactoring Workflow, not as an ad hoc script around existing eval output.
- Treat the sealed evaluator as codenuke's equivalent of Karpathy's fixed evaluation harness. It owns fixtures, sealed evaluator behavior checks, expected opportunities, scoring logic, comparison logic, no-mutation policies, and keep/discard criteria.
- Treat the mutable research surface as codenuke's equivalent of the experimental training surface. It may include semantic evidence production, mapping integration, provider prompt construction, Guidance Selection interactions, review/fix/revalidation prompt behavior, and workflow wiring.
- Do not include fixture files, fixture expectations, sealed evaluator behavior checks, scoring logic, comparison logic, local issue tracker files, generated results, package lockfiles, local state, generated build output, or agent skills in the mutable research surface.
- Add a deep module for evaluator integrity. Its interface should accept a root, a sealed evaluator definition, and a before/after snapshot, then return mutation violations with paths, categories, and reasons.
- Add a deep module for semantic ROI comparison. Its interface should accept control observations and treatment observations, then return per-fixture scores, aggregate scores, deltas, constraint failures, and a keep/discard/crash decision.
- Add a deep module for semantic evidence mode. Its interface should make semantic evidence explicitly enabled or disabled during map/review/fix/revalidation runs without requiring fixture rewrites.
- Add a deep module for experiment execution. Its interface should run baseline, control, and treatment in isolated workspaces or isolated state directories and return structured observations without leaking local state into the user's repo.
- Add a deep module for result ledger writing. Its interface should append untracked experiment results with commit/checkpoint identity, provider configuration, metric values, status, and description.
- Keep deterministic and model-backed ROI modes separate. Deterministic mode proves contracts and mutation guards. Model-backed mode proves live-provider quality deltas.
- The deterministic mode should be suitable for local verification and package smoke checks. It should not depend on provider credentials.
- The model-backed mode should be opt-in and should record provider, model, reasoning effort, run count, timeout, and raw result references.
- The first ROI metric should be a composite score over candidate recall at review scope, false positives, map evidence trace correctness, fix success, Patch Boundary health, validation health, changed-file count, and patch size.
- The composite score should also carry hard constraints. Evaluator mutation, test mutation, unexpected Patch Boundary changes, validation failures, malformed provider output, or dirty-worktree violations can force discard even when some quality metric improves.
- The keep/discard policy should be mechanical. Keep only if treatment improves the composite score over control and all hard constraints pass. Discard if treatment regresses, is equal with greater complexity, or trips a hard constraint. Keep equal quality only when implementation complexity is meaningfully reduced without weakening constraints.
- The harness should support a baseline-first workflow. The first run records current control/treatment behavior before a research change is judged.
- The harness should support crash and blocked statuses. Crashes are logged with short failure details. Blocked status is used when the evaluator cannot run or required provider configuration is missing.
- The harness should not automatically commit, push, open PRs, or land changes as part of the production codenuke workflow. If local experiment checkpointing is added, it must be explicit, isolated, and documented as research-only behavior.
- Preserve the existing fix safety model for normal users. Normal fix may add focused tests when Trusted Refactor Regression Coverage calls for it. The ROI harness imposes a stricter no-test-mutation rule only inside measured experiments.
- Preserve the existing Patch Boundary model, but make ROI scoring fail when semantic evidence causes wider edits without explicit benchmark support.
- Store whether semantic evidence was enabled on observed runs or result records, so later analysis can distinguish control and treatment.
- Extend report/eval output only with backward-compatible fields.
- Keep the semantic ROI fixture set small at first, but include at least one sibling duplicate/refactoring-scope fixture, one semantic false-positive trap, one fix-scope fixture, and one revalidation sibling-risk fixture.
- The first model-backed ROI fixture set should include examples where semantic evidence should help, examples where it should be ignored, and examples where it should narrow scope rather than broaden it.
- The harness should produce readable failure messages that identify the failed concept using domain language: Feature Slice, Refactoring Signal, Refactoring Finding, Guidance Selection, Guidance Trace, Patch Boundary, Guidance Application, and Agent Quality Baseline.
- Documentation should explain how this PRD relates to the guidance-backed workflow PRD and map-quality autoresearch ADR. The prior work remains valid; this PRD adds the proof layer for review/fix ROI.

## Testing Decisions

- Good tests should assert external behavior and sealed contracts, not private helper details. The important behaviors are evaluator immutability, A/B isolation, semantic evidence mode switching, score calculation, hard-constraint enforcement, and durable result reporting.
- Test the evaluator integrity module with representative mutations: fixture source change, fixture expected finding change, sealed evaluator behavior check change, scoring code change, generated result change, local state change, package lockfile change, and unrelated production change.
- Test that evaluator mutations are rejected even if the file contents are restored after a run but the snapshot detects a changed checksum during the experiment.
- Test the no-test-mutation rule with changed production code plus changed tests. The ROI harness should reject this even though normal codenuke fix may allow focused test changes.
- Test that production-only changes inside the declared mutable research surface are allowed by the integrity guard.
- Test semantic evidence mode switching by running the same fixture with evidence disabled and enabled, verifying the control observation does not expose semantic-neighbor evidence while the treatment observation does.
- Test the ROI comparison module with control/treatment fixtures where treatment improves, regresses, ties with lower complexity, ties with higher complexity, trips a hard constraint, and crashes.
- Test that candidate recall and false positive scoring are independent. A treatment that finds more candidates but also emits unrelated Refactoring Findings should not automatically win.
- Test map evidence trace scoring. A finding should get credit only when the trace points to the expected semantic neighbor and includes expected signals.
- Test fix scoring against sealed behavior checks. A patch should not receive fix-success credit only because visible tests pass.
- Test Patch Boundary scoring. A treatment that edits outside the allowed finding scope should fail the hard constraint even if the output is otherwise plausible.
- Test result ledger writing. It should append records with provider configuration, semantic evidence mode, score summary, decision, status, and short description without requiring generated result files to be committed.
- Test dry-run or preview output for the harness so agents can inspect what would run before spending model-backed eval budget.
- Test error messages for missing provider configuration in model-backed mode. Missing credentials should produce blocked, not a misleading discard.
- Test timeout handling in model-backed mode with a controlled command or provider stub.
- Test fixture authoring docs by adding at least one new fixture through the documented shape during implementation.
- Reuse existing eval runner tests, workflow tests, reporting tests, provider tests, patch boundary tests, and map-quality eval patterns as prior art.
- Run the normal broad verification sequence before handoff: typecheck, lint, test, build, deterministic eval, map-quality eval, and package smoke when the package surface changes.
- Model-backed ROI evals should not become mandatory CI until the project has an accepted variance policy and stable provider credentials.

## Out of Scope

- Proving that every future semantic algorithm is valuable.
- Replacing the existing map-quality autoresearch loop.
- Replacing the guidance-backed workflow PRD.
- Turning codenuke into a general bug finder, security scanner, or product-risk reviewer.
- Letting ROI experiments weaken the normal review, fix, revalidation, dirty-worktree, or Patch Boundary safety model.
- Making model-backed ROI evals mandatory for every local development run.
- Allowing the experiment loop to edit eval fixtures, sealed evaluator behavior checks, expected outputs, scoring logic, generated build output, local state, package lockfiles, or agent skills.
- Adding automatic production commits, pushes, PR creation, or landing behavior.
- Requiring normal user-facing fix to stop adding tests. The no-test-mutation policy applies to sealed ROI proof runs, not ordinary Trusted Refactoring Workflow use.
- Building a large benchmark suite before the first sealed harness exists.
- Adding language-specific AST analyzers unless they are needed by a focused semantic ROI fixture and covered by the sealed evaluator.

## Further Notes

Karpathy's autoresearch is useful here because of its boundaries, not because codenuke should run indefinite autonomous loops. The relevant principles are fixed evaluator, narrow mutable surface, baseline first, stable metric, explicit ledger, and mechanical keep/discard.

Codenuke's equivalent proof should be stricter than the current deterministic semantic fixture. The current fixture proves that map evidence can be surfaced and traced. This PRD asks for proof that semantic evidence improves the Trusted Refactoring Workflow under a sealed evaluator.

The key product distinction is that normal codenuke fix is allowed to add or update focused tests when behavior preservation requires it. A semantic ROI experiment is different: it is a proof harness. Inside that harness, changing tests or evaluator expectations invalidates the experiment.

This PRD should be implemented after or alongside the current semantic-evidence fixture work. It should not require reverting that work; it turns that plumbing proof into one part of a larger ROI proof system.
