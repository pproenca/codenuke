# Simplifying Conditional Expressions

## Decompose Conditional

Type: Refactoring Technique

Extract complex conditional logic and branch bodies into named methods or variables.

### Use When

- A conditional mixes policy, calculation, and action.
- Branch names would reveal intent better than nested code.

### Avoid When

- The conditional is already direct and clearer inline.
- Extraction would obscure branch precedence or error behavior.

### Behavior Risks

- Preserve branch order, fallthrough behavior, short-circuiting, and exceptions.

## Consolidate Duplicate Conditional Fragments

Type: Refactoring Technique

Move identical code from conditional branches to a single place before or after the conditional.

### Use When

- Each branch performs the same work before or after branch-specific logic.
- The duplicated fragment has the same behavior in every branch.

### Avoid When

- The duplicated lines only look similar but depend on branch-local state.
- Moving the fragment changes ordering, mutation, or error behavior.

### Behavior Risks

- Preserve side-effect order and branch-specific invariants.
