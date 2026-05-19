# Guidance-backed Trusted Refactoring Workflow

Status: ready-for-agent

## Goal

Implement the guidance-backed Trusted Refactoring Workflow as the default review, fix, and revalidation behavior, verified by focused tests and package smoke coverage showing that packaged Refactoring Resources are selected from observable owned-code shapes, injected into provider prompts, persisted as useful Guidance Traces on new Refactoring Findings, applied during fix, assessed during revalidation, and exposed through inspection surfaces, while preserving existing CLI commands, existing finding readability, backward compatibility for stored findings, current next-finding ranking semantics, and the behavior-preserving safety model. Use the accepted ADR, domain glossary, curated resource subset, and existing workflow/provider contracts as boundaries. Between implementation steps, prefer small testable modules, keep selection conservative, and tune from concrete prompt/schema/test evidence. If the resource model, schema compatibility, or package surface cannot be made defensible under these constraints, stop with the attempted design, evidence gathered, blocker, and the next decision needed.

## Problem Statement

Codenuke currently asks providers to find reliable, trusted refactoring opportunities using mostly prompt-level heuristics. The repo now has a richer refactoring mental model in catalog and technique guidance, but that guidance is not part of the runtime workflow. As a result, agents do not consistently receive the right refactoring vocabulary, evidence gates, negative guidance, or repair technique context when reviewing, fixing, or revalidating code.

The user wants codenuke to move away from generic heuristics and give agents better tools for finding, fixing, and ranking behavior-preserving refactoring opportunities, without changing the fundamental workflow or turning review into a broad bug hunt.

## Solution

Add packaged Refactoring Resources under a `resources/` package surface and make Guidance Selection part of the default Trusted Refactoring Workflow.

Codenuke will conservatively detect observable code shapes in owned files, select relevant section-level Refactoring Resources through a manifest, inject compact guidance cards plus fuller text for strongest matches into provider prompts, require new review outputs to explain applied guidance, persist useful Guidance Traces on findings, apply those traces during fix, and assess guidance fit during revalidation.

The first implementation should use a smaller high-value curated subset rather than migrating every existing doc. The resources should preserve canonical smell and technique names, preserve high-value wording, and add codenuke guardrails around evidence, behavior preservation, when-not-to-use constraints, and repair scope.

## User Stories

1. As an engineer running review, I want codenuke to give the provider relevant refactoring guidance, so that findings are grounded in a known refactoring model rather than generic cleanup advice.
2. As an engineer running review, I want selected guidance to come from owned-code evidence, so that irrelevant resource text does not dilute the provider prompt.
3. As an engineer running review, I want guidance to be conservative and section-level, so that the provider gets useful concepts without receiving the whole catalog.
4. As an engineer running review, I want smells to remain Refactoring Signals instead of finding categories, so that durable findings stay evidence-backed and behavior-oriented.
5. As an engineer running review, I want the provider to explain how guidance applies to each finding, so that I can distinguish a real Refactoring Finding from a superficial pattern match.
6. As an engineer inspecting a finding, I want to see the Guidance Trace with why and how guidance was used, so that I can understand the intended repair frame.
7. As an engineer inspecting reports, I want reports to stay concise by default, so that guidance details do not overwhelm summary output.
8. As an engineer using JSON output, I want guidance metadata included in machine-readable finding data, so that downstream tooling can inspect the trace.
9. As an engineer running fix, I want the fix provider to apply the finding’s Guidance Trace, so that patching stays aligned with review.
10. As an engineer running fix, I want the patching provider to explain any smaller or safer deviation from the applied guidance, so that acceptable adaptations are auditable.
11. As an engineer running revalidation, I want codenuke to assess both whether the finding is resolved and whether the guidance fit is acceptable, so that superficial fixes do not get marked fixed.
12. As an engineer maintaining codenuke, I want guidance selection to be inspectable in dry-run output, so that bad provider results can be traced to resource quality, selector quality, or provider judgment.
13. As an engineer maintaining codenuke, I want resources to have explicit stable IDs, so that durable finding traces remain meaningful if headings are later clarified.
14. As an engineer maintaining codenuke, I want a manifest to encode resource IDs, links, tags, and applicability, so that selection is deterministic and testable.
15. As an engineer maintaining codenuke, I want selection tags to describe observable code shapes, so that codenuke selects tools from grounded evidence and leaves higher-level judgment to the agent.
16. As an engineer maintaining codenuke, I want the first resource subset to be small and high quality, so that the prompt helps Codex rather than drowning it in noisy guidance.
17. As an engineer maintaining codenuke, I want old finding records to keep loading, so that existing `.codenuke/` state is not broken by the schema change.
18. As an engineer maintaining codenuke, I want packaging checks to prove resources ship with the npm package, so that installed CLIs behave the same as local source checkouts.
19. As an engineer maintaining codenuke, I want prompt tests to verify guidance placement before file blocks, so that providers read code through the intended refactoring frame.
20. As an engineer maintaining codenuke, I want the current next-finding ranking semantics preserved initially, so that this change improves provider output without adding a second ranking migration.
21. As an engineer maintaining codenuke, I want resource curation to preserve canonical names like Long Method and Extract Method, so that the agent benefits from recognizable refactoring terminology.
22. As an engineer maintaining codenuke, I want negative guidance included, so that the agent does not over-apply large techniques like replacing conditionals with polymorphism.
23. As an engineer maintaining codenuke, I want fix and revalidation schemas to make guidance use explicit, so that provider compliance can be tested instead of inferred from prose.
24. As an engineer using codenuke across languages, I want first-pass detection to be language-agnostic, so that guidance selection works across the project types codenuke already maps.

## Implementation Decisions

- Refactoring Resources become the runtime guidance source. They are packaged under `resources/` and included in the npm package.
- Resources are curated for agent use. They preserve canonical names and high-value wording from the source guidance, but add codenuke guardrails for evidence, behavior preservation, repair scope, negative guidance, and when-not-to-report.
- Resources are selected at named-section granularity, not whole-file or paragraph granularity.
- The first selectable resource subset should cover high-value signals such as Duplicate Code, Long Method, Long Parameter List, Switch Statements, Comments, Speculative Generality, Middle Man, Message Chains, and Data Clumps.
- The first linked technique subset should cover Extract Method, Inline Method, Extract Variable, Decompose Conditional, Consolidate Duplicate Conditional Fragments, Introduce Parameter Object, Preserve Whole Object, Remove Parameter, and Remove Middle Man.
- Resource IDs are explicit and stable in metadata. No resource versioning is required in the first implementation.
- A manifest is maintained as source. It records stable IDs, titles, kinds, paths, stage applicability, selection tags, and links between signals and techniques.
- Guidance Selection uses explicit manifest tags and links. It does not infer relevance from resource body text.
- Selection tags describe observable code shapes such as large-function-like-block, many-branches, nested-conditionals, duplicate-block, long-parameter-list, primitive-type-code, message-chain, delegation-wrapper, unused-parameter, and repeated-switch-like-branches.
- First-pass code shape detection is conservative and language-agnostic. It should prefer false negatives over noisy over-selection.
- Owned files drive primary Guidance Selection. Context files and tests may modify confidence or suppress guidance, but should not normally select Refactoring Signals unless the feature itself is a test-suite feature.
- Prompt guidance appears before repository file blocks.
- Prompts include compact guidance cards for all selected resources and fuller preserved text for the strongest matches.
- Strongest matches are ranked primarily by observable evidence strength, then by likely impact.
- Review selects Refactoring Signals first, then includes linked techniques. A narrow escape hatch may include a directly matching technique when code evidence is obvious.
- New review provider output should include applied guidance for each finding. Stored finding records remain backward-compatible by defaulting missing guidance to an empty trace.
- Guidance Trace distinguishes codenuke-selected resources from provider-applied resources, and records reason/use text rather than bare citations.
- Fix applies the finding’s Guidance Trace instead of rerunning broad Guidance Selection. It may choose a smaller or safer behavior-preserving move when current code proves a listed technique is too broad.
- Fix output includes structured guidance application so the patching provider states how it used or deviated from the trace.
- Revalidation receives the finding’s Guidance Trace and assesses both finding resolution and guidance fit.
- Revalidation output includes structured guidance assessment. If guidance fit is unacceptable, the finding should not be marked fixed.
- Existing CLI commands remain the same. Guidance-backed review, fix, and revalidation become default behavior, not a config-flagged mode.
- Dry-run JSON for review should expose selected guidance, detected shapes, reasons, linked techniques, and budget/cap decisions.
- `show` should display Guidance Trace details for a finding. Default human report output should remain concise, while JSON report output includes the underlying record.
- This design is recorded in ADR-0001 and should be implemented consistently with that decision.

## Testing Decisions

- Test external behavior and durable contracts rather than private selector internals where possible.
- Add unit tests for the manifest/resource loader to prove stable IDs, links, stage applicability, and resource paths resolve.
- Add focused tests for language-agnostic shape detection using small fixtures that exercise high-confidence observable shapes.
- Add selector tests showing owned files drive selection, context/tests only modify selection, caps are respected, signal-first linking works, and strongest-match ordering is evidence-driven.
- Add prompt construction tests for review, fix, and revalidation proving guidance appears before file blocks and that compact cards/full text are included in the intended cases.
- Add provider schema tests requiring applied guidance in new review outputs and guidance application/assessment in fix and revalidation outputs.
- Add finding schema tests proving legacy findings without guidance still parse with an empty default trace.
- Add workflow tests proving new findings persist selected and applied Guidance Trace data.
- Add show/reporting tests proving `show` displays useful guidance reason/use text and default reports remain concise.
- Add dry-run tests proving review dry-run JSON exposes selection diagnostics without invoking the provider.
- Add package smoke coverage proving `resources/` is included in the packed npm artifact and can be loaded from an installed package.
- Run the existing broader verification sequence before handoff: typecheck, lint, test, and build. Add package smoke because this changes the package surface.

## Out of Scope

- Deleting `docs/` as part of the first implementation.
- Migrating every catalog and technique document into selectable resources.
- Adding resource versioning.
- Adding a provider pre-pass for guidance selection.
- Adding a new `codenuke guidance` command.
- Changing current `next` ranking semantics.
- Persisting negative selection traces for features with no findings.
- Adding language-specific AST analyzers in the first pass.
- Making guidance behavior optional behind a config flag.
- Renaming canonical smell or technique names into codenuke-specific substitutes.

## Further Notes

The key product constraint is augmentation, not replacement. Guidance gives the agent better tools for finding, fixing, and ranking patterns, but the existing Trusted Refactoring Workflow remains finding-scoped, evidence-backed, and behavior-preserving.

The highest implementation risk is over-selection. A smaller curated subset with conservative shape detection is preferred over broad coverage that makes provider prompts noisy. Poor guidance should be fixed upstream in resource curation or selection rather than hidden by fix-time rediscovery.
