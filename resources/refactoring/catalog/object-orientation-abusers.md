# Object-Orientation Abusers

## Switch Statements

Type: Refactoring Signal

Use as a lead, not proof. Switch Statements and repeated conditional dispatch matter when changes require editing parallel branches and a smaller behavior-preserving simplification is visible.

### Signs and Symptoms

- Switch or if/else chains dispatch on type, kind, mode, or status.
- Similar conditional branches appear in multiple places.
- Adding a new case would require coordinated edits across functions.

### Treatment

- Use Decompose Conditional when branches are hard to read but the dispatch shape is still appropriate.
- Consolidate duplicate fragments when all branches repeat the same work.
- Larger polymorphic replacements require a stable variation axis and strong evidence.

### Codenuke Evidence Gate

- Show repeated or complex branch structure and the behavior contract for each branch.
- Prefer no finding if a direct conditional is clearer than the abstraction.

### Behavior Risks

- Replacing conditionals with polymorphism can be too large for a finding-scoped fix.
- Reordering branches can change precedence and error behavior.

### References

- techniques.simplifying-conditional-expressions.decompose-conditional
- techniques.simplifying-conditional-expressions.consolidate-duplicate-conditional-fragments
