# Semantic ROI Autoresearch Audit

decision: keep
reason: treatment beat control by 360.0 point(s) with no hard constraint failures
score delta: 360.0
production ready: yes
positive future-change fixtures: 2
semantic false-positive traps: 1

## Proven Behavior
- The deterministic harness runs the same fixture with semantic evidence disabled and enabled.
- The control run exposes no semantic-neighbor links and produces no finding.
- The treatment run exposes semantic-neighbor links and produces a traced Refactoring Finding.
- Treatment fixtures can run fix and revalidate through the normal CLI while rejecting test mutation.
- Constraint fixtures run sealed behavior invariants before measuring future-change cost.
- Fixture definitions must declare a change scenario, current cost, target cost, and validation command before a positive ROI score can count.
- Fixture evaluator files are hash-checked inside copied worktrees, so fix and future-change steps cannot mutate tests, behavior scripts, or project test config.
- Future-change probes measure whether treatment reduces touch points versus control.
- Future-change probes define the change scenario, current cost, target cost, and cost dimensions before scoring easier change.
- Production readiness requires multiple positive future-change scenarios plus a semantic false-positive trap.
- The run records hard constraint failures separately from quality metrics.

## Proxy Evidence
- none

## Unproven Model-backed ROI
- Live model-backed ROI remains out of scope for this deterministic command.

## Blockers
- none

## Next Inputs
- Use this deterministic gate for production mapper/refactoring ROI changes; add new sealed scenarios as new refactoring classes become supported.

## Fixtures

### pricing-rule-locality
- control findings: 0
- treatment findings: 1
- control semantic links: 0
- treatment semantic links: 2
- control fix: none
- treatment fix: applied
- control revalidation: none
- treatment revalidation: fixed
- constraint: constraint.member-discount-duplication (duplicated-domain-rule)
- control constraint identified: false
- treatment constraint identified: true
- control behavior invariants: 1/1
- treatment behavior invariants: 1/1
- control protected evaluator files: 5
- treatment protected evaluator files: 5
- control protected mutations: 0
- treatment protected mutations: 0
- future-change scenario: Change the member discount rate used by checkout and subscription pricing.
- future-change dimensions: change-amplification, blast-radius, verification-cost, reversibility
- control future-change touch points: 2
- treatment future-change touch points: 1
- control future-change patch-size lines: 2
- treatment future-change patch-size lines: 1
- future-change touch point reduction: 1
- score delta: 180.0

### semantic-evidence-review
- control findings: 0
- treatment findings: 1
- control semantic links: 0
- treatment semantic links: 2
- control fix: none
- treatment fix: applied
- control revalidation: none
- treatment revalidation: fixed
- constraint: constraint.format-money-duplication (duplicated-domain-rule)
- control constraint identified: false
- treatment constraint identified: true
- control behavior invariants: 1/1
- treatment behavior invariants: 1/1
- control protected evaluator files: 4
- treatment protected evaluator files: 4
- control protected mutations: 0
- treatment protected mutations: 0
- future-change scenario: Change the money display prefix for every formatter that renders invoice totals.
- future-change dimensions: change-amplification, blast-radius, verification-cost, reversibility
- control future-change touch points: 2
- treatment future-change touch points: 1
- control future-change patch-size lines: 2
- treatment future-change patch-size lines: 1
- future-change touch point reduction: 1
- score delta: 180.0

### semantic-false-positive-trap
- control findings: 0
- treatment findings: 0
- control semantic links: 0
- treatment semantic links: 2
- control fix: none
- treatment fix: none
- control revalidation: none
- treatment revalidation: none
- constraint: none
- control constraint identified: n/a
- treatment constraint identified: n/a
- control behavior invariants: 0/0
- treatment behavior invariants: 0/0
- control protected evaluator files: 2
- treatment protected evaluator files: 2
- control protected mutations: 0
- treatment protected mutations: 0
- future-change scenario: none
- future-change dimensions: none
- control future-change touch points: none
- treatment future-change touch points: none
- control future-change patch-size lines: none
- treatment future-change patch-size lines: none
- future-change touch point reduction: none
- score delta: 0.0
