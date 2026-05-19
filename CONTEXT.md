# Codenuke

Codenuke helps engineers find and apply evidence-backed, behavior-preserving improvements to existing codebases.

## Language

**Trusted Refactoring Workflow**:
A codenuke workflow that turns bounded evidence about maintainability risk into a behavior-preserving improvement with validation.
_Avoid_: cleanup workflow, general bug hunt

**Refactoring Signal**:
A symptom in code that may indicate maintainability risk but is not actionable until supported by bounded evidence and a behavior-preserving repair path.
_Avoid_: smell finding, automatic cleanup target

**Refactoring Campaign**:
A repeated codenuke loop that reviews, fixes, validates, and revalidates bounded refactoring findings until the selected scope is exhausted.
_Avoid_: cleanup sprint, one-off refactor

**Change Scope**:
The subset of repository behavior considered during a refactoring campaign.
_Avoid_: campaign type, separate workflow

**Feature Slice**:
A reviewable unit of repository behavior used to bound evidence, tests, and refactoring opportunities.
_Avoid_: file group, cleanup area

**Refactoring Finding**:
An evidence-backed, behavior-preserving refactoring opportunity selected from a feature slice.
_Avoid_: smell, todo, issue

**Refactoring Catalog**:
A codenuke reference that gives agents a refactoring guidance model for interpreting signals and choosing likely behavior-preserving repair moves.
_Avoid_: rulebook, automatic checklist

**Refactoring Resource**:
A packaged guidance document that an agent consumes during review, fix, or revalidation.
_Avoid_: docs page, copied documentation

**Guidance Selection**:
The workflow step that chooses the smallest relevant set of refactoring resources for a provider prompt.
_Avoid_: full docs injection, keyword dump

**Guidance Trace**:
The durable record of why refactoring resources were selected and how they were applied to a finding or validation decision.
_Avoid_: hidden prompt context, provider-only notes, bare citation list

## Relationships

- A **Trusted Refactoring Workflow** depends on evidence that the target code can be changed without altering intended behavior.
- A **Refactoring Signal** can support a finding, but is not itself a finding.
- A **Refactoring Campaign** runs the **Trusted Refactoring Workflow** repeatedly.
- A **Change Scope** limits which features or findings a **Refactoring Campaign** considers.
- A **Feature Slice** is the review unit for a **Refactoring Campaign**.
- A **Refactoring Finding** is the fix unit for a **Refactoring Campaign**.
- A **Refactoring Finding** may cite a **Refactoring Signal**, but does not require one.
- A **Refactoring Catalog** helps interpret **Refactoring Signals** without making them automatic findings.
- A **Refactoring Resource** supplies the packaged guidance used by the **Trusted Refactoring Workflow**.
- **Guidance Selection** chooses which **Refactoring Resources** enter each provider prompt.
- A **Guidance Trace** makes **Guidance Selection** visible in durable workflow state.
- A **Guidance Trace** carries the applicable guidance that later fix and revalidation steps should apply.

## Example dialogue

> **Dev:** "Should this broad cleanup be part of the **Trusted Refactoring Workflow**?"
> **Domain expert:** "Only if it can be reduced to a bounded, behavior-preserving improvement with validation."

## Flagged ambiguities

- "refactoring workflow" was used broadly; resolved: in codenuke this means the **Trusted Refactoring Workflow**, not feature delivery or general cleanup.
- "code smell" was treated as a possible finding category; resolved: smells are **Refactoring Signals**, not durable finding categories.
- "campaign" and "--since" were treated as alternatives; resolved: a **Refactoring Campaign** is the loop, while `--since` defines a **Change Scope**.
- "file" was considered as a campaign unit; resolved: **Feature Slice** is the review unit because behavior boundaries matter more than file boundaries.
- "smell label" was considered as required finding evidence; resolved: a **Refactoring Finding** can be valid without a named smell when evidence, behavior preservation, and repair scope are clear.
- "heuristic" was treated as the source of refactoring judgment; resolved: heuristics may surface **Refactoring Signals**, but the **Refactoring Catalog** supplies the guidance model for judging and repairing them.
- "`docs/`" was treated as the runtime guidance source; resolved: packaged **Refactoring Resources** are the runtime guidance source, while docs may be removed or kept separately.
- "select guidance" was treated as simple keyword matching; resolved: **Guidance Selection** must preserve the wording and relationships that make the refactoring model valuable.
- "selected guidance" was treated as invisible provider context; resolved: selected guidance should leave a **Guidance Trace** in durable state.
- "guidance trace" was treated as a resource citation list; resolved: a **Guidance Trace** must explain why selected resources matter and how they should be used.
- "fix guidance" was treated as something the fix step can rediscover; resolved: fix should apply the finding's **Guidance Trace**, and poor guidance should be corrected upstream in selection or review.
- "curated resource" was treated as a rewrite of the source guidance; resolved: **Refactoring Resources** should preserve canonical names and high-value wording while adding codenuke guardrails.
- "resource version" was considered part of **Guidance Trace** identity; resolved: stable explicit resource IDs are enough for the first implementation.
- "resource selection" was considered as text inference over resource bodies; resolved: **Guidance Selection** should use explicit manifest tags and links while preserving resource wording for the agent.
- "selection tags" were considered as higher-level refactoring diagnoses; resolved: **Guidance Selection** should match observable code shapes, while agents use **Refactoring Resources** to reason about higher-level risks.
- "code shape detection" was considered as language-specific static analysis; resolved: first-pass **Guidance Selection** should use conservative language-agnostic shapes to give agents relevant guidance without noisy false certainty.
- "guidance selection" was considered an internal-only implementation detail; resolved: selection should be inspectable so poor agent results can be traced to selected guidance, provider judgment, or resource quality.
- "guidance selection" was considered possible from paths alone; resolved: **Guidance Selection** should inspect owned file contents because actual code shapes produce better agent guidance than path metadata alone.
- "prompt placement" of selected guidance was considered flexible; resolved: selected guidance should appear before repository file blocks so agents read code through the intended refactoring frame.
- "selected guidance text" was considered all-or-nothing; resolved: prompts should include compact guidance cards for selected resources and fuller preserved text for the strongest matches.
- "top guidance match" was considered an abstract risk ranking; resolved: strongest matches should be ranked primarily by observable evidence strength, then by likely impact.
- "negative guidance" was considered optional; resolved: **Refactoring Resources** should include when-not-to-use constraints because they keep agents from over-applying large refactorings.
- "examples in resources" were considered expendable prompt budget; resolved: keep short structural examples only when they clarify pattern boundaries.
- "catalog treatment" was considered permission for large structural edits; resolved: agents should prefer the smallest behavior-preserving move and require stronger evidence for larger techniques.
- "fix guidance" was considered strict technique obedience; resolved: fix should start from the **Guidance Trace** but may choose a smaller or safer move when current code proves the applied technique is too broad.
- "revalidation" was considered only a code-outcome check; resolved: revalidation should judge whether the finding is resolved and whether the applied guidance was followed appropriately.
- "guidance assessment" during revalidation was considered free-form reasoning; resolved: revalidation should return a structured guidance assessment so agents must explicitly judge guidance fit.
- "failed guidance assessment" was considered independent from finding outcome; resolved: unacceptable guidance fit should prevent revalidation from marking a finding fixed.
- "guidance application" during fix was considered unnecessary because revalidation assesses guidance; resolved: fix should return a structured guidance application so the patching agent states how it used or deviated from the trace.
- "guidance-backed review" was considered an optional mode; resolved: guidance-backed review, fix, and revalidation should become the default **Trusted Refactoring Workflow** behavior once implemented.
- "resource migration" was considered an all-at-once copy of existing docs; resolved: first implementation should use a smaller guidance-ready subset, then expand coverage without lowering curation quality.
