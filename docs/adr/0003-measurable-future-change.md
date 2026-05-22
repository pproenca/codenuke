# Measurable Future-Change Value

Codenuke treats maintainability/refactor findings as measurable future-change
claims, not style preferences.

"Future change is easier" means a defined class of future changes has lower
cost, lower risk, lower delay, smaller blast radius, or better locality after
the repair than before. The finding must name that class of change.

For every maintainability finding, codenuke records:

- future change: the class of change that should become easier
- current cost: what that change requires today
- target cost: what it should require after the repair
- behavior invariant: what must remain unchanged
- evidence: included code proving the claim
- cost dimensions: change amplification, cognitive load, coupling,
  verification cost, blast radius, coordination, reversibility, cycle time, or
  rework risk

This combines three lenses:

- Theory of Constraints: the repair is valuable only if it relaxes a constraint
  on safe, valuable change throughput.
- Graph view: the same conceptual change should require a smaller, more local,
  lower-risk graph transformation.
- Pattern view: an abstraction is justified only when it isolates a real source
  of variation and its consequences are better than the extra indirection.

Consequences:

- "Make it cleaner" is not a finding.
- Mechanical DRY evidence is only a lead.
- Providers can report direct defects with `changeScenario: null`.
- Maintainer-facing reports show the change scenario so humans can reject weak
  architecture claims quickly.
