# Couplers

## Middle Man

Type: Refactoring Signal

Use as a lead, not proof. Middle Man appears when a class, module, or function mostly delegates to another object without adding behavior.

### Signs and Symptoms

- Many methods do nothing but call another method.
- A wrapper forwards parameters and return values unchanged.
- The delegating layer no longer hides a useful dependency.

### Treatment

- Use Remove Middle Man when clients can safely call the delegated object directly.
- Use Inline Method for one-off delegation methods.

### Codenuke Evidence Gate

- Show repeated delegation and explain why the layer no longer protects a boundary.
- Do not report when the delegating layer enforces permissions, logging, validation, compatibility, or a public API boundary.

### Behavior Risks

- Removing a wrapper can leak dependencies.
- Bypassing a layer can skip validation or compatibility behavior.

### References

- techniques.moving-features-between-objects.remove-middle-man
- techniques.composing-methods.inline-method

## Message Chains

Type: Refactoring Signal

Use as a lead, not proof. Message Chains appear when a client asks one object for another object, then asks that object for another, and so on.

### Signs and Symptoms

- Long chains of property or method access.
- Callers know too much about an object graph.
- The same chain appears in multiple places.

### Treatment

- Hide the chain behind a method that names the needed concept.
- Use Preserve Whole Object when passing the owner object is clearer than extracting many values.

### Codenuke Evidence Gate

- Show the chain and why it exposes structure the caller should not know.
- Do not report when the chain is idiomatic data access, test setup, or framework plumbing.

### Behavior Risks

- Hiding chains can create vague pass-through methods.
- Preserving whole objects can widen coupling.

### References

- techniques.simplifying-method-calls.preserve-whole-object
