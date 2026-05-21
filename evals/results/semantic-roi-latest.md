# Semantic ROI Autoresearch Audit

decision: keep
reason: treatment beat control by 180.0 point(s) with no hard constraint failures
score delta: 180.0

## Proven Behavior
- The deterministic harness runs the same fixture with semantic evidence disabled and enabled.
- The control run exposes no semantic-neighbor links and produces no finding.
- The treatment run exposes semantic-neighbor links and produces a traced Refactoring Finding.
- Treatment fixtures can run fix and revalidate through the normal CLI while rejecting test mutation.
- Constraint fixtures run sealed behavior invariants before measuring future-change cost.
- Future-change probes measure whether treatment reduces touch points versus control.
- The run records hard constraint failures separately from quality metrics.

## Proxy Evidence
- none

## Unproven Model-backed ROI
- Live model-backed ROI remains out of scope for this deterministic command.

## Blockers
- none

## Next Inputs
- Expand the sealed constraint corpus and add optional model-backed repeated samples before claiming live-provider ROI.

## Fixtures

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
- control future-change touch points: 2
- treatment future-change touch points: 1
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
- control future-change touch points: none
- treatment future-change touch points: none
- future-change touch point reduction: none
- score delta: 0.0
