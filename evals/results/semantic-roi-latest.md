# Semantic ROI Autoresearch Audit

decision: keep
reason: treatment beat control by 150.0 point(s) with no hard constraint failures
score delta: 150.0

## Proven Behavior
- The deterministic harness runs the same fixture with semantic evidence disabled and enabled.
- The control run exposes no semantic-neighbor links and produces no finding.
- The treatment run exposes semantic-neighbor links and produces a traced Refactoring Finding.
- Treatment fixtures can run fix and revalidate through the normal CLI while rejecting test mutation.
- The run records hard constraint failures separately from quality metrics.

## Proxy Evidence
- none

## Unproven Model-backed ROI
- Live model-backed ROI remains out of scope for this deterministic command.

## Blockers
- none

## Next Inputs
- Add optional model-backed repeated samples before claiming live-provider ROI.

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
- score delta: 150.0

### semantic-false-positive-trap
- control findings: 0
- treatment findings: 0
- control semantic links: 0
- treatment semantic links: 2
- control fix: none
- treatment fix: none
- control revalidation: none
- treatment revalidation: none
- score delta: 0.0
