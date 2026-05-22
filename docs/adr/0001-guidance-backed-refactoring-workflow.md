# Superseded: guidance-backed refactoring workflow

This ADR is superseded. The current workflow does not select packaged guidance,
inject refactoring catalogs into prompts, require Guidance Application records,
or treat mechanical refactoring shapes as findings.

The simpler contract is:

- `review` reports concrete, evidence-backed findings with real impact.
- scanner-style signals and high-recall candidates are leads, not obligations.
- `fix` is explicit, finding-scoped, patch-boundary checked, and validation-driven.
- persisted legacy guidance fields remain readable only for backward compatibility.

This keeps the patch loop close to the finding record and removes the prompt
ceremony that made low-value refactors look mandatory.
