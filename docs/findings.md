---
title: Findings
description: "Understanding finding records, statuses, and inspection commands"
---

# Findings

Findings are stored in `.codenuke/findings/<findingId>.json`.

Each finding records:

- feature ID
- title
- category
- severity
- confidence
- triage
- evidence
- reasoning
- reproduction notes
- recommendation
- change scenario for maintainability findings
- status
- linked patch attempts
- triage/revalidation history

Statuses:

- `open`
- `false-positive`
- `fixed`
- `wont-fix`
- `uncertain`

Current ways to inspect findings:

```bash
codenuke status
codenuke next
codenuke show --finding <findingId>
codenuke report
codenuke report -o report.md
codenuke report --json
codenuke report --status open --severity high
codenuke report --feature <featureId>
```

Current ways to act on a finding:

```bash
codenuke triage --finding <findingId> --status false-positive --note "covered by contract test"
codenuke fix --finding <findingId>
codenuke revalidate --finding <findingId>
codenuke revalidate --all --status open --limit 10
```

`next` prioritizes open high/medium-confidence findings first, then lower
confidence and low severity findings.

`triage` keeps existing finding IDs stable and appends a history entry instead
of replacing previous reasoning.

For maintainability findings, `changeScenario` records the future-change claim:
the scenario, current cost, target cost, behavior invariant, evidence, and cost
dimensions such as change amplification, coupling, verification cost, blast
radius, coordination, reversibility, cycle time, or rework risk.
