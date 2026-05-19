# Guidance-backed refactoring workflow

Codenuke will make packaged refactoring resources part of the default Trusted Refactoring Workflow for review, fix, and revalidation. The resources live under `resources/`, are selected conservatively from observable code shapes, and leave durable guidance traces on findings so later fix and revalidation steps can apply and assess the same refactoring frame.

Guidance selection will distinguish Primary Guidance from Supporting Guidance. Primary Guidance is the small set of resources a fix must apply, adapt, or explicitly reject; Supporting Guidance is context for judgment without becoming a mandatory patch obligation. Test-gap findings should prefer Trusted Refactor Regression Coverage as Primary Guidance when the real task is to pin behavior before or during a refactor.

Patch attempts will persist a Guidance Application describing how the fix used the finding's Guidance Trace. Fix success should depend on that application being coherent with the Primary Guidance, and revalidation should assess both the code outcome and the recorded guidance use.

Fixes will also enforce a Patch Boundary. Validation during `fix` should prefer non-mutating checks, especially formatter checks, and out-of-boundary changes should fail the patch attempt while leaving the worktree inspectable rather than silently reverting provider edits.

**Considered Options**

- Keep guidance as human-facing docs only: rejected because the workflow would still depend mostly on generic provider heuristics.
- Inject all guidance into every prompt: rejected because it would dilute the model with irrelevant concepts and make prompt behavior harder to debug.
- Use a provider pre-pass for guidance selection: rejected for the first implementation because static, high-precision selection gives the agent useful tools without extra latency, cost, or another provider contract.
- Hide selected guidance inside prompts only: rejected because durable guidance traces are needed to debug selection quality and keep fix/revalidation aligned with review.
- Track only provider-applied guidance on findings: rejected because it cannot distinguish weak pre-provider selection from a provider ignoring or misusing good guidance.
- Treat every selected resource as mandatory during fix: rejected because broad resource sets dilute the patch objective; Primary Guidance should carry obligations while Supporting Guidance remains contextual.
- Trust provider planned files as the whole patch boundary: rejected because provider plans are useful intent signals, not authorization to edit arbitrary repository paths.
- Auto-revert out-of-boundary files: rejected for the first implementation because preserving the worktree makes provider mistakes inspectable and avoids silently discarding edits in ambiguous states.

**Consequences**

New review outputs should include applied guidance, stored findings must remain backward-compatible, and revalidation should assess both whether the finding is resolved and whether the guidance fit is acceptable. Review runs should also persist feature-level Guidance Selection Audits with observable evidence, selected resources, rejected resources, and prompt/resource hashes so selection quality can be evaluated independently from provider judgment. Patch attempts should persist Guidance Application and Patch Boundary results so fix quality can be evaluated separately from final revalidation. The first resource set should be smaller and carefully curated rather than a full migration of the existing docs.
