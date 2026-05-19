# Simplifying Method Calls

## Introduce Parameter Object

Type: Refactoring Technique

Replace a group of parameters with a single object that names the group.

### Use When

- The same parameter group appears in multiple calls.
- The values form one stable concept.

### Avoid When

- The group appears only once.
- The new object would be a bag of unrelated values.
- A public interface would be broken unnecessarily.

### Behavior Risks

- Avoid speculative abstractions and dependency widening.

## Preserve Whole Object

Type: Refactoring Technique

Pass a whole object instead of extracting several values from it.

### Use When

- A caller passes many values that all come from the same object.
- The callee naturally depends on the whole concept.

### Avoid When

- Passing the whole object creates an unwanted dependency.
- Only one primitive value is truly needed.

### Behavior Risks

- Do not expose mutable state unnecessarily.

## Remove Parameter

Type: Refactoring Technique

Remove a parameter that is not used by the method body.

### Use When

- A parameter is unused in all relevant implementations.
- The parameter is speculative and not part of a public contract.

### Avoid When

- Subclasses, overloads, framework hooks, or public APIs rely on the parameter.

### Behavior Risks

- Update call sites consistently and preserve compatibility requirements.
