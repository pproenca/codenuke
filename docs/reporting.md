---
title: Reporting
description: "Generate and filter finding reports in Markdown or JSON"
---

# Reporting

`clawnuke report` renders current findings.

```bash
clawnuke report
clawnuke report -o report.md
clawnuke report --json
clawnuke report --status open --severity high
clawnuke report --feature <featureId>
```

Markdown output includes:

- finding ID
- severity, category, confidence, triage, and status
- feature ID and title when available
- evidence file paths and line ranges when available
- reasoning text
- test-contract analysis when available
- suggested regression test and minimum fix scope when available
- recommendation and reproduction text when available
- next inspection command for status-filtered queues

`review` also writes a Markdown report for each run under:

```text
.clawnuke/reports/<runId>.md
```

Filters:

- `--status <status>`
- `--severity <severity>`
- `--feature <featureId>`
- `--category <category>`
- `--triage <triage>`

`--json` returns sorted machine-readable finding items with IDs, status,
severity, category, confidence, triage, feature info, evidence refs,
recommendation, reproduction, test-analysis, suggested-test, minimum-fix-scope,
and next-command fields. It does not require parsing Markdown.
