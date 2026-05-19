# Guidance-backed refactoring workflow

Codenuke will make packaged refactoring resources part of the default Trusted Refactoring Workflow for review, fix, and revalidation. The resources live under `resources/`, are selected conservatively from observable code shapes, and leave durable guidance traces on findings so later fix and revalidation steps can apply and assess the same refactoring frame.

**Considered Options**

- Keep guidance as human-facing docs only: rejected because the workflow would still depend mostly on generic provider heuristics.
- Inject all guidance into every prompt: rejected because it would dilute the model with irrelevant concepts and make prompt behavior harder to debug.
- Use a provider pre-pass for guidance selection: rejected for the first implementation because static, high-precision selection gives the agent useful tools without extra latency, cost, or another provider contract.
- Hide selected guidance inside prompts only: rejected because durable guidance traces are needed to debug selection quality and keep fix/revalidation aligned with review.
- Track only provider-applied guidance on findings: rejected because it cannot distinguish weak pre-provider selection from a provider ignoring or misusing good guidance.

**Consequences**

New review outputs should include applied guidance, stored findings must remain backward-compatible, and revalidation should assess both whether the finding is resolved and whether the guidance fit is acceptable. Review runs should also persist feature-level Guidance Selection Audits with observable evidence, selected resources, rejected resources, and prompt/resource hashes so selection quality can be evaluated independently from provider judgment. The first resource set should be smaller and carefully curated rather than a full migration of the existing docs.
