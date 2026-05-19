# Refactoring Guidance Quality Baseline

Status: ready-for-agent

## Goal

Create an Agent Quality Baseline that proves codenuke's Trusted Refactoring Workflow is good at finding bounded, evidence-backed, behavior-preserving Refactoring Findings without drifting into broad bug hunting, generic cleanup, or prompt-driven overreach. The baseline must exercise Guidance Selection, Refactoring Resources, provider prompts, finding schemas, fix guidance, and revalidation behavior against representative refactoring examples before further GPT-5.5/Codex prompt tuning is treated as successful.

## Success Criteria

- The eval suite contains representative fixtures for the first supported Refactoring Signals, not only mock provider markers.
- Guidance Selection chooses concrete signal guidance before Trusted Refactor Regression Coverage unless the selected task is specifically a test-gap finding.
- Every manifest `selectWhen` shape is either emitted by detection, intentionally marked non-detectable for the first baseline, or removed from selectable criteria.
- Every emitted code shape is either connected to a Refactoring Resource, treated as audit-only by explicit design, or removed from detection.
- Review prompts for Codex/GPT-5.5 are outcome-first, compact, and focused on refactoring plus simplification, with no generic bug-hunting mission.
- Codex/GPT-5.5 provider flows rely on structured output where available instead of duplicating full schema definitions in prompt text.
- The deterministic eval suite can fail when guidance selection is wrong, when the wrong resources dominate, when a clean fixture receives an actionable finding, or when a representative refactoring fixture receives no usable guidance.
- A documented non-deterministic model eval mode exists for GPT-5.5/Codex prompt comparisons, separate from deterministic CI gates.
- The default reasoning guidance remains medium unless baseline results show a measurable quality gain from high or xhigh.
- The implementation preserves existing CLI command shapes, durable state compatibility, and the explicit fix/revalidate safety model.

## Problem Statement

Codenuke has moved toward a refactoring-focused workflow, but the current evals are not strong enough to prove that the tool remains good at its intended job. They mostly verify CLI plumbing, mock provider output, and workflow state. They do not yet prove that the Refactoring Catalog, Guidance Selection, prompt design, or GPT-5.5/Codex usage actually improve the quality of Refactoring Findings.

The user needs confidence that codenuke has not become a generic issue finder, a bug-hunting tool, or a cleanup generator. The tool should identify bounded simplification opportunities from observable evidence, select the smallest useful guidance, and support behavior-preserving fix/revalidation. Prompt changes should be judged by representative examples, not intuition.

## Solution

Build a focused Agent Quality Baseline for refactoring guidance quality. The baseline will add representative deterministic fixtures, align the Refactoring Resource manifest with shape detection, adjust Guidance Selection ranking so concrete refactoring signals lead, and define a separate model-backed comparison workflow for GPT-5.5/Codex prompt tuning.

The implementation should treat evals as the product contract for the refactoring workflow. Deterministic evals should remain stable and CI-friendly. Model-backed evals should be opt-in and used to compare prompts, reasoning effort, and guidance library changes against clear expected outcomes.

The GPT-5.5/Codex prompt contract should follow OpenAI guidance: state the outcome, success criteria, allowed side effects, evidence rules, and output shape; keep stable prompt content first and dynamic repository context last; avoid detailed process instructions unless required; use structured outputs where available; and tune reasoning effort only against representative eval results.

## User Stories

1. As a codenuke maintainer, I want evals that exercise real Refactoring Signals, so that passing evals means the refactoring workflow still works.
2. As a codenuke maintainer, I want duplicate-code fixtures, so that Guidance Selection proves it can select duplicate-code guidance from observable owned-code evidence.
3. As a codenuke maintainer, I want long-method fixtures, so that the baseline catches regressions in bloat-related guidance.
4. As a codenuke maintainer, I want long-parameter-list fixtures, so that parameter simplification guidance is selected only when evidence supports it.
5. As a codenuke maintainer, I want conditional-complexity fixtures, so that conditional simplification guidance is evaluated against realistic code.
6. As a codenuke maintainer, I want message-chain fixtures, so that coupler guidance can be tested without relying on broad provider judgment.
7. As a codenuke maintainer, I want middle-man/delegation fixtures, so that delegation-wrapper guidance remains grounded in observable code.
8. As a codenuke maintainer, I want clean negative fixtures, so that codenuke does not report refactoring work where the evidence is too weak.
9. As a codenuke maintainer, I want missing-test fixtures with no simplification signal, so that Trusted Refactor Regression Coverage does not masquerade as a generic refactoring finding.
10. As a codenuke maintainer, I want missing-test fixtures with a real simplification signal, so that coverage guidance supports the signal instead of replacing it.
11. As a codenuke maintainer, I want fixture expectations for selected resources, so that guidance selection regressions fail evals even when provider output still looks plausible.
12. As a codenuke maintainer, I want fixture expectations for rejected or absent resources, so that noisy over-selection is visible.
13. As a codenuke maintainer, I want fixture expectations for primary versus supporting guidance, so that mandatory patch obligations stay narrow.
14. As a codenuke maintainer, I want fixture expectations for durable Guidance Selection Audits, so that evals distinguish selection quality from provider judgment.
15. As a codenuke maintainer, I want fix/revalidation fixtures that apply selected guidance, so that patch quality is evaluated against the same refactoring frame as review.
16. As a codenuke maintainer, I want patch boundary expectations in evals, so that representative refactoring fixes do not expand into unrelated churn.
17. As a codenuke maintainer, I want the manifest and detector vocabulary aligned, so that every selectable shape has a clear runtime meaning.
18. As a codenuke maintainer, I want audit-only shapes marked explicitly, so that future agents do not confuse them with broken selectors.
19. As a codenuke maintainer, I want unreachable manifest criteria removed or implemented, so that the Refactoring Catalog does not imply coverage codenuke lacks.
20. As a codenuke maintainer, I want prompt tests that prevent bug-hunting language from returning to review prompts, so that provider behavior stays focused on refactoring and simplification.
21. As a codenuke maintainer, I want Codex/GPT-5.5 prompts to be outcome-first, so that the model optimizes for the product contract rather than following brittle step lists.
22. As a codenuke maintainer, I want provider-specific prompt rendering, so that Codex can use structured output without redundant schema prose while providers that need prose still get it.
23. As a codenuke maintainer, I want stable prompt sections before dynamic feature context, so that prompt caching can work better where supported.
24. As a codenuke maintainer, I want model evals that compare reasoning effort, so that high or xhigh is used only when it measurably improves quality.
25. As a codenuke maintainer, I want model evals that compare prompt variants, so that prompt changes are selected by evidence rather than taste.
26. As a codenuke maintainer, I want deterministic evals to remain fast, so that they can run locally and in package verification.
27. As a codenuke maintainer, I want model-backed evals to be opt-in, so that normal development does not depend on external model availability.
28. As a codenuke maintainer, I want eval results to report guidance quality separately from workflow health, so that failures point to the right layer.
29. As a codenuke maintainer, I want eval results to summarize false positives and false negatives, so that prompt and selector changes can be compared consistently.
30. As a codenuke maintainer, I want eval fixtures to be small but realistic, so that they are easy to review and still representative of real code.
31. As a codenuke maintainer, I want fixture names to use domain language, so that future work reinforces the Trusted Refactoring Workflow vocabulary.
32. As a codenuke maintainer, I want the mock provider to remain useful for deterministic plumbing checks, so that evals can separate provider-independent behavior from model judgment.
33. As a codenuke maintainer, I want a clear distinction between Refactoring Signals and Refactoring Findings, so that smells do not become automatic findings.
34. As a codenuke maintainer, I want clean fixtures to prove that signals are leads rather than proof, so that codenuke remains conservative.
35. As a codenuke maintainer, I want documentation explaining what the baseline measures, so that contributors know when a prompt or resource change is acceptable.
36. As a codenuke maintainer, I want documentation explaining what the baseline does not measure, so that deterministic evals are not mistaken for real model quality.
37. As a codenuke user, I want codenuke to suggest small behavior-preserving changes, so that I can trust the fix loop.
38. As a codenuke user, I want findings to avoid broad product-risk language, so that the tool stays aligned with refactoring and simplification.
39. As a codenuke user, I want test-gap recommendations to appear only when they support safe refactoring or are explicitly the selected finding, so that codenuke does not become a test coverage nag.
40. As a codenuke user, I want reports to stay concise, so that stronger guidance and evals do not make normal CLI output noisy.
41. As an AFK agent, I want clear module boundaries and done-when criteria, so that I can implement the baseline without reopening product direction.
42. As an AFK agent, I want focused tests for each module, so that I can change guidance selection without depending on end-to-end provider behavior for every assertion.

## Implementation Decisions

- Build a representative deterministic Agent Quality Baseline for the Trusted Refactoring Workflow before doing more prompt tuning.
- Keep deterministic evals provider-independent by using mock behavior where useful, but make the fixtures themselves representative of real refactoring signals rather than marker-only examples.
- Add or revise fixtures for Duplicate Code, Long Method, Long Parameter List, conditional simplification, Message Chains, Middle Man, clean code, missing tests without a concrete signal, and missing tests with a concrete signal.
- Treat fixture expectations as contracts over selected resources, primary/supporting roles, Guidance Selection Audits, findings, fix attempts, Guidance Applications, revalidation outcomes, and patch boundary health.
- Align the Refactoring Resource manifest and shape detector. A selectable shape must be emitted by detection, and an emitted shape must have an explicit purpose.
- Treat `large-file`-style signals as audit-only unless the product explicitly decides they should select a resource. Large files alone should not produce a Refactoring Finding.
- Treat Trusted Refactor Regression Coverage as supporting guidance when a concrete simplification signal exists. It should be primary when the selected finding is specifically a test-gap/refactoring-safety finding.
- Prefer signal-first ranking in Guidance Selection. Workflow guidance should not crowd out concrete signal guidance in review prompts.
- Preserve the distinction between Refactoring Signal and Refactoring Finding. A signal can guide review, but the provider must still return bounded evidence, repair scope, and validation expectations.
- Introduce or extract a deep module for shape evidence and selection ranking if the current workflow module becomes too broad. The interface should accept feature-owned code evidence and return selected resources, roles, reasons, audit details, and rejected resources.
- Introduce or extract a deep module for eval expectation scoring if the runner begins accumulating guidance-specific assertions. The interface should compare observed eval outcomes against fixture contracts and produce readable failure messages.
- Keep provider prompts outcome-first for GPT-5.5/Codex: expected outcome, success criteria, allowed side effects, evidence rules, and output expectations.
- Avoid generic bug-hunting language in review prompts and prompt tests. The review mission should be refactoring, simplification, and behavior-preserving maintainability improvement.
- Use provider capability awareness for output schema handling. Codex/GPT-5.5 should rely on structured output where available; providers that need prompt-level schema prose may keep it.
- Keep stable prompt content before dynamic feature/file context where the provider surface allows it, so that prompt caching has a stable prefix.
- Keep default reasoning effort at medium for GPT-5.5/Codex. Only recommend high or xhigh when model-backed baseline comparisons show a measurable improvement.
- Add an opt-in model-backed eval mode for GPT-5.5/Codex prompt comparisons. It should be separate from deterministic CI and package smoke checks.
- Model-backed eval results should compare prompt variant, model, reasoning effort, selected resources, finding precision, finding recall against expected refactoring opportunities, and output validity.
- Documentation should explain the baseline's purpose, how to add a fixture, how to interpret failures, and when to run deterministic versus model-backed evals.
- Preserve existing CLI commands and durable schemas unless a schema addition is required for eval reporting. Any schema addition must remain backward-compatible.
- Preserve the explicit fix/revalidate workflow. Review does not edit files, and fix remains finding-scoped.

## Testing Decisions

- Good tests assert external behavior and durable contracts: selected resources, guidance roles, audit records, finding output, fix/revalidation outcomes, eval scoring, prompt invariants, and user-visible CLI behavior.
- Unit-test shape detection with small owned-code fixtures for each supported Refactoring Signal and each explicitly audit-only shape.
- Unit-test Guidance Selection ranking so concrete signal resources outrank workflow guidance unless the feature is specifically a test-gap scenario.
- Unit-test manifest/resource integrity so every selectable shape is detectable or intentionally marked non-detectable, and every emitted shape is connected to a resource or marked audit-only.
- Test prompt construction for the Codex/GPT-5.5 path to prove the prompt is outcome-first, compact, refactoring-focused, and free of generic bug-hunting mission language.
- Test provider-specific prompt/schema behavior so structured-output-capable providers do not need full schema prose duplicated in the prompt.
- Extend deterministic eval tests to fail on wrong selected resources, wrong primary/supporting roles, missing Guidance Selection Audits, unexpected findings in clean fixtures, missing findings in representative refactoring fixtures, and patch boundary violations.
- Add eval scoring tests with intentionally failing fixture snapshots so failure messages are readable enough for AFK agents.
- Add documentation tests only if the repo already has a pattern for them; otherwise rely on focused docs review and package smoke checks.
- Continue running the normal verification sequence for non-trivial changes: typecheck, lint, test, build, eval, and package smoke.
- Keep model-backed evals out of mandatory CI unless the project later adds a stable credentialed environment and accepted variance policy.

## Out of Scope

- Turning codenuke into a general bug finder, security scanner, or product-risk review tool.
- Broadening finding categories beyond the refactoring-focused review contract.
- Rewriting the whole Refactoring Catalog.
- Adding language-specific AST analyzers in this PRD.
- Making model-backed evals mandatory in local development or CI.
- Changing the public CLI command shape unless required for an opt-in model eval flag.
- Changing package publishing behavior beyond ensuring eval and resource changes are represented in smoke checks.
- Adding automatic commits, pushes, PR creation, or landing behavior to fix workflows.
- Replacing the current deterministic mock provider.
- Treating test coverage gaps as automatic findings without a bounded refactoring-safety reason.

## Further Notes

OpenAI's GPT-5.5 guidance says to start from a fresh baseline, use the smallest prompt that preserves the product contract, state outcome and success criteria, rely on structured outputs where possible, keep stable prompt content before dynamic content, and increase reasoning effort only when evals show measurable quality gain.

OpenAI's Codex guidance says effective coding-agent tasks should include goal, context, constraints, and done-when criteria, and that reliability improves when agents are asked to test, run checks, confirm results, and review their work. This PRD turns that guidance into codenuke's implementation contract for refactoring-quality evals.

The existing guidance-backed workflow PRD and ADR remain valid. This PRD is a follow-on quality baseline: it does not replace packaged Refactoring Resources or Guidance Traces; it makes them measurable enough to guide GPT-5.5/Codex prompt and workflow decisions.

Source guidance:

- https://developers.openai.com/api/docs/guides/latest-model.md
- https://developers.openai.com/codex/learn/best-practices
