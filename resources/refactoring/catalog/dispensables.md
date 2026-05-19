# Dispensables

## Duplicate Code

Type: Refactoring Signal

Use as a lead, not proof. Duplicate Code matters when repeated structure has the same behavior contract and can be removed with a small behavior-preserving repair.

### Signs and Symptoms

- Two code fragments look almost identical.
- Conditional branches repeat the same work.
- Multiple functions contain the same validation, transformation, or reporting sequence.

### Treatment

- If duplicated code appears inside one method, use Extract Method.
- If duplicate conditional fragments appear in all branches, use Consolidate Duplicate Conditional Fragments.
- If duplicated code appears in sibling classes or modules, prefer the smallest shared helper only when the abstraction is stable.

### Codenuke Evidence Gate

- Show all duplicated locations.
- Explain why the fragments are behaviorally the same, not just textually similar.
- Do not report superficial similarity when ordering, mutation, permissions, error behavior, or data shape differs.

### Behavior Risks

- Deduplication can accidentally merge behavior that should vary.
- Shared helpers can create coupling that makes future changes harder.

### References

- techniques.composing-methods.extract-method
- techniques.simplifying-conditional-expressions.consolidate-duplicate-conditional-fragments

## Comments

Type: Refactoring Signal

Use as a lead, not proof. Comments are a signal when they explain code that could instead be made self-explanatory through naming or extraction.

### Signs and Symptoms

- A comment explains what a block does rather than why it must do it.
- A comment separates phases inside a long method.
- A comment compensates for a complex expression or unclear name.

### Treatment

- Use Extract Method when a comment labels a coherent block.
- Use Extract Variable when a comment explains a complex expression.
- Keep comments that explain external constraints, surprising tradeoffs, or domain facts.

### Codenuke Evidence Gate

- Show the comment and the code it explains.
- Report only when the code can be clarified without losing useful context.

### Behavior Risks

- Removing comments can delete important rationale.
- Extraction for a comment can create a weak helper if the block has no stable concept.

### References

- techniques.composing-methods.extract-method
- techniques.composing-methods.extract-variable

## Speculative Generality

Type: Refactoring Signal

Use as a lead, not proof. Speculative Generality appears when code supports imagined future use rather than current behavior.

### Signs and Symptoms

- Unused parameters, hooks, options, or abstractions.
- Methods that delegate without adding behavior.
- Classes or helpers that are empty, nearly empty, or only used once.

### Treatment

- Use Inline Method when a method body is more obvious than the method itself.
- Use Remove Parameter when a parameter is unused.
- Remove unused abstractions only when they are not part of a public contract.

### Codenuke Evidence Gate

- Show that the abstraction is unused or does not carry behavior.
- Check public API, framework hooks, and extension points before reporting.

### Behavior Risks

- Removing an extension point can break external users.
- Inlining can reduce clarity when a name carries important domain meaning.

### References

- techniques.composing-methods.inline-method
- techniques.simplifying-method-calls.remove-parameter
