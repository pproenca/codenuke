# Bloaters

## Long Method

Type: Refactoring Signal

Use as a lead, not proof. Report only when a long function or method makes a behavior-preserving repair path visible in the included files. Prefer the smallest move that clarifies behavior without hiding important control flow.

### Signs and Symptoms

- A method contains too many lines of code. Generally, any method longer than ten lines should make you start asking questions.
- Conditional operators and loops are a good clue that code can be moved to a separate method.
- Long methods often hide duplicate code or mixed abstraction levels.

### Treatment

- To reduce the length of a method body, use Extract Method.
- If local variables and parameters interfere with extracting a method, use Replace Temp with Query, Introduce Parameter Object, or Preserve Whole Object.
- For conditionals, use Decompose Conditional.

### Codenuke Evidence Gate

- Show the exact function or block and why its current shape creates maintainability risk.
- Identify the visible behavior contract from nearby code or tests.
- Do not report if the only evidence is line count.

### Behavior Risks

- Extraction can hide local mutation, ordering, short-circuiting, or error behavior.
- A helper used only once should still name a real concept or isolate a risky operation.

### References

- techniques.composing-methods.extract-method
- techniques.composing-methods.extract-variable
- techniques.simplifying-conditional-expressions.decompose-conditional
- techniques.simplifying-method-calls.introduce-parameter-object
- techniques.simplifying-method-calls.preserve-whole-object

## Long Parameter List

Type: Refactoring Signal

Use as a lead, not proof. Long parameter lists matter when they make calls hard to understand, duplicate a stable data group, or force callers to rebuild information that already belongs together.

### Signs and Symptoms

- More than three or four parameters for a method.
- Parameters form a repeated group across multiple calls.
- Parameters are results of method calls from another object.

### Treatment

- Use Preserve Whole Object when callers pass many values from the same object.
- Use Introduce Parameter Object when parameters form a stable data group.
- Use Replace Parameter with Method Call when the callee can obtain the value from an object it already knows.

### Codenuke Evidence Gate

- Show the call surface and at least one reason the parameter group is meaningful.
- Do not report if removing parameters would create unwanted dependency between classes or modules.

### Behavior Risks

- Parameter objects can create premature abstractions.
- Preserving whole objects can widen dependencies.
- Removing parameters can break public interfaces.

### References

- techniques.simplifying-method-calls.introduce-parameter-object
- techniques.simplifying-method-calls.preserve-whole-object
- techniques.simplifying-method-calls.remove-parameter

## Data Clumps

Type: Refactoring Signal

Use as a lead, not proof. Data Clumps are repeated groups of values that only make sense together and can often become a named object or be passed as a whole.

### Signs and Symptoms

- Different parts of the code contain identical groups of variables.
- Removing one value from the group makes the remaining values less meaningful.
- The same data group appears as fields, parameters, or forwarded arguments.

### Treatment

- If repeating data comprises fields of a class, use Extract Class.
- If the same data clumps are passed in parameters, use Introduce Parameter Object.
- If some of the data is passed to other methods, consider Preserve Whole Object.

### Codenuke Evidence Gate

- Show repeated groups, not just one long call.
- Explain why the grouped values represent one concept.
- Prefer no finding if the group is incidental or only appears once.

### Behavior Risks

- Introducing a new object can add indirection without reducing risk.
- Passing a whole object can create an undesirable dependency.

### References

- techniques.simplifying-method-calls.introduce-parameter-object
- techniques.simplifying-method-calls.preserve-whole-object
