# Composing Methods

## Extract Method

Type: Refactoring Technique

Move a coherent code fragment to a separate new method or function and replace the old code with a call to it.

### Use When

- A block has a clear purpose that can be named.
- A long method mixes phases or abstraction levels.
- Duplicate code can be replaced by one behavior-preserving helper.

### Avoid When

- Extraction would hide important local control flow.
- The helper needs many mutable parameters.
- The helper is used only once and does not name a real concept or isolate a risky operation.

### Behavior Risks

- Preserve ordering, mutation, error behavior, and short-circuiting.
- Check local variables that are assigned before or after the extracted block.

## Inline Method

Type: Refactoring Technique

Replace calls to a method with the method content and delete the method when the body is more obvious than the method itself.

### Use When

- A method only delegates without adding behavior.
- A speculative helper no longer earns its name.

### Avoid When

- The method is part of a public interface.
- The name carries important domain meaning.
- The method is overridden or used as an extension point.

### Behavior Risks

- Inlining can duplicate behavior if there are many call sites.
- Removing a method can break framework or public API contracts.

## Extract Variable

Type: Refactoring Technique

Place the result of a complex expression, or parts of it, in a self-explanatory variable.

### Use When

- A condition or expression is hard to understand.
- A name would expose the concept better than a comment.

### Avoid When

- Extracting changes short-circuit evaluation or eagerly calls expensive work.
- The variable name would merely restate the expression.

### Behavior Risks

- Preserve lazy evaluation and side-effect order.
