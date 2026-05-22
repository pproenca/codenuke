# Codenuke

Codenuke helps engineers find and apply evidence-backed, behavior-preserving improvements to existing codebases.

## Language

**Autoresearch Refactoring Loop**:
A codenuke workflow where a proposer repeatedly offers behavior-preserving reductions and an independent scorer keeps only admissible improvements.
_Avoid_: trusted refactoring workflow, cleanup sprint, manual review workflow

**Behavior Fence**:
A measured safety boundary that determines whether a code region is trusted for autonomous refactoring.
_Avoid_: test coverage, confidence score, static safety check

**Fence Calibration**:
A periodic measurement of behavior fence strength before or during an autoresearch refactoring loop.
_Avoid_: setup check, test run, one-time initialization

**Core Loop Surface**:
The user-facing command set for preparing, calibrating, running, judging, accepting, rejecting, and clearing an autoresearch refactoring loop.
_Avoid_: hidden scorer API, manual prototype surface, debug-only workflow

**Single Command Path**:
A CLI design rule where each user action has exactly one supported command and no synonym commands.
_Avoid_: aliases, backwards-compatible duplicate verbs, hidden alternate paths

**Scorer Operation**:
A user-facing action that judges, accepts, or rejects a candidate reduction outside the unattended loop.
_Avoid_: hidden command, debug-only command, provider review step

**Kept Reduction**:
A behavior-preserving reduction accepted by the scorer during an autoresearch refactoring loop.
_Avoid_: fix, finding, cleanup commit

**Change-Cost Benchmark**:
A held-out measurement of whether reductions lower the cost of future changes.
_Avoid_: quality score, vibe check, generic benchmark

**Product Contract**:
The canonical specification of codenuke's goals, command surface, state, safety rules, and release criteria.
_Avoid_: README quickstart, implementation notes, marketing copy

**Trusted Refactoring Workflow**:
A codenuke workflow that turns bounded evidence about maintainability risk into a behavior-preserving improvement with validation.
_Avoid_: cleanup workflow, general bug hunt

**Refactoring Signal**:
A symptom in code that may indicate maintainability risk but is not actionable until supported by bounded evidence and a behavior-preserving repair path.
_Avoid_: smell finding, automatic cleanup target

**Refactoring Opportunity Candidate**:
A high-recall, cross-file candidate for a larger behavior-preserving refactor before review proves actionability.
_Avoid_: proven finding, safe finding, guaranteed fix

**Ludicrous Review Mode**:
A high-recall codenuke review mode that surfaces broad **Refactoring Opportunity Candidates** for provider inspection without treating them as findings.
_Avoid_: unsafe autofix mode, guaranteed large refactor, direct finding generation

**Refactoring Campaign**:
A repeated codenuke loop that reviews, fixes, validates, and revalidates bounded refactoring findings until the selected scope is exhausted.
_Avoid_: cleanup sprint, one-off refactor

**Agent Quality Baseline**:
A reference measurement of how well a Trusted Refactoring Workflow performs on agreed examples before changes are made.
_Avoid_: vibe check, one-off run result, generic quality score

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

**Guidance Selection Audit**:
A durable feature-level record of the observable evidence, selected resources, rejected resources, and prompt proof produced by guidance selection before provider review.
_Avoid_: provider self-report, hidden prompt log, finding guidance

**Guidance Trace**:
The durable record of why refactoring resources were selected and how they were applied to a finding or validation decision.
_Avoid_: hidden prompt context, provider-only notes, bare citation list

**Primary Guidance**:
The small set of refactoring resources a patch attempt must apply, adapt, or explicitly reject.
_Avoid_: selected docs, all matched resources, optional reading

**Supporting Guidance**:
Refactoring resources that provide context for judgment but are not mandatory patch obligations.
_Avoid_: weaker findings, ignored guidance, second-class resources

**Trusted Refactor Regression Coverage**:
Primary guidance for adding focused tests that pin behavior before or during a trusted refactoring.
_Avoid_: broad snapshot testing, duplicate parser coverage, generic test cleanup

**Guidance Application**:
A durable patch-level account of how the fix used, adapted, or rejected the finding's guidance trace.
_Avoid_: fix summary, provider prose, after-the-fact justification

**Patch Boundary**:
The finding-scoped set of files a patch attempt may change without human review.
_Avoid_: formatter cleanup, whole-repo edit allowance, provider discretion

## Relationships

- An **Autoresearch Refactoring Loop** depends on a **Behavior Fence** to decide whether autonomous refactoring is admissible.
- **Fence Calibration** measures the **Behavior Fence**.
- The **Core Loop Surface** includes explicit **Fence Calibration**, the **Autoresearch Refactoring Loop**, and public **Scorer Operations**.
- The **Core Loop Surface** follows a **Single Command Path** so agents do not choose between duplicate verbs for the same action.
- A **Scorer Operation** can be run manually or by an **Autoresearch Refactoring Loop**.
- An **Autoresearch Refactoring Loop** produces zero or more **Kept Reductions**.
- A **Kept Reduction** should preserve behavior and lower future-change cost.
- A **Change-Cost Benchmark** validates whether **Kept Reductions** improve the intended long-term objective.
- The **Product Contract** is the source of truth for the **Core Loop Surface**.
- A **Trusted Refactoring Workflow** depends on evidence that the target code can be changed without altering intended behavior.
- A **Refactoring Signal** can support a finding, but is not itself a finding.
- A **Refactoring Opportunity Candidate** can group multiple **Refactoring Signals**, but is not itself a **Refactoring Finding**.
- **Ludicrous Review Mode** can provide **Refactoring Opportunity Candidates** to review, but review must still prove a bounded **Refactoring Finding** before fix.
- A **Refactoring Campaign** runs the **Trusted Refactoring Workflow** repeatedly.
- An **Agent Quality Baseline** measures a **Trusted Refactoring Workflow** before guidance, prompt, provider, or workflow changes are judged.
- A **Change Scope** limits which features or findings a **Refactoring Campaign** considers.
- A **Feature Slice** is the review unit for a **Refactoring Campaign**.
- A **Refactoring Finding** is the fix unit for a **Refactoring Campaign**.
- A **Refactoring Finding** may cite a **Refactoring Signal**, but does not require one.
- A **Refactoring Catalog** helps interpret **Refactoring Signals** without making them automatic findings.
- A **Refactoring Resource** supplies the packaged guidance used by the **Trusted Refactoring Workflow**.
- **Guidance Selection** chooses which **Refactoring Resources** enter each provider prompt.
- A **Guidance Selection Audit** makes pre-provider guidance selection evaluable separately from provider judgment.
- A **Guidance Trace** makes **Guidance Selection** visible in durable workflow state.
- A **Guidance Trace** carries the applicable guidance that later fix and revalidation steps should apply.
- **Primary Guidance** defines the mandatory guidance obligations for a fix.
- **Supporting Guidance** gives context without expanding mandatory fix obligations.
- **Trusted Refactor Regression Coverage** is the preferred **Primary Guidance** for test-gap findings.
- A **Guidance Application** explains how a patch attempt used the **Guidance Trace** during fix.
- A **Patch Boundary** protects the **Trusted Refactoring Workflow** from unrelated worktree churn.

## Example dialogue

> **Dev:** "Can we run the **Autoresearch Refactoring Loop** before calibrating the **Behavior Fence**?"
> **Domain expert:** "No — the loop needs **Fence Calibration** before it can decide whether to raise the fence or attempt reductions."

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
- "whether the agent looked at the right docs" was treated as a finding-level question; resolved: evaluate pre-provider **Guidance Selection** with a **Guidance Selection Audit**, then evaluate provider use with the finding-level **Guidance Trace**.
- "churn" was used broadly; resolved: unrelated fix edits are **Patch Boundary** violations, while formatter rewrites are a validation-command policy problem.
- "baseline" was used broadly; resolved: an **Agent Quality Baseline** is a reference measurement for comparing Trusted Refactoring Workflow changes, not a single ad hoc run.
- "large refactoring opportunity" was treated as a finding; resolved: before review proves actionability, use **Refactoring Opportunity Candidate**.
- "`--ludicrous-mode`" was treated as permission for broad direct fixes; resolved: **Ludicrous Review Mode** only increases recall for review candidates and does not bypass finding evidence, patch boundaries, or validation.
- "canonical workflow" was ambiguous between the older map/review/fix surface and the autoresearch loop; resolved: the **Autoresearch Refactoring Loop** is the primary product workflow, while the older **Trusted Refactoring Workflow** language describes a legacy or secondary review workflow until deliberately re-integrated.
- "`score`", "`accept`", "`revert`", and "`cleanup`" were treated as hidden or internal commands; resolved: `score`, `approve`, `reject`, and `clear` are public **Scorer Operations** in the **Core Loop Surface**.
- "`fence`" was used as the safety-calibration command name; resolved: the product command should be `calibrate`, while **Behavior Fence** remains the domain term being measured.
- "backwards-compatible aliases" were considered for old command names; resolved: the CLI should use a **Single Command Path** with no duplicate commands for the same action.
- "`README.md`" and "`docs/spec.md`" were both treated as product authorities; resolved: `docs/spec.md` is the **Product Contract**, while `README.md` is a quickstart.
