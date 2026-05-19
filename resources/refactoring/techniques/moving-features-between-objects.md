# Moving Features between Objects

## Remove Middle Man

Type: Refactoring Technique

Remove a delegating layer when clients can safely use the delegated object directly.

### Use When

- The wrapper mostly forwards calls and no longer protects a boundary.
- Removing the wrapper reduces code without changing behavior.

### Avoid When

- The wrapper enforces validation, permissions, logging, compatibility, or a stable public API.
- Direct access would expose an implementation detail that should remain hidden.

### Behavior Risks

- Preserve dependency boundaries and compatibility contracts.
