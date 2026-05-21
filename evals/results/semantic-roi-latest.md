# Semantic ROI Autoresearch Audit

decision: keep
reason: treatment beat control by 90.0 point(s) with no hard constraint failures
score delta: 90.0

## Proven Behavior
- The deterministic harness runs the same fixture with semantic evidence disabled and enabled.
- The control run exposes no semantic-neighbor links and produces no finding.
- The treatment run exposes semantic-neighbor links and produces a traced Refactoring Finding.
- The run records hard constraint failures separately from quality metrics.

## Proxy Evidence
- none

## Unproven Model-backed ROI
- Live model-backed ROI remains out of scope for this deterministic command.

## Blockers
- none

## Next Inputs
- Add fix/revalidation ROI fixtures before claiming full fix-quality coverage.

## Fixtures

### semantic-evidence-review
- control findings: 0
- treatment findings: 1
- control semantic links: 0
- treatment semantic links: 2
- score delta: 90.0
