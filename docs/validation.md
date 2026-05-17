---
title: Validation and Revalidation
description: "Validation commands during fix workflow and revalidation process"
---

# Validation and Revalidation

Validation happens during `clawnuke fix`.

Configured commands run in order:

- format
- typecheck
- lint
- test

Commands are detected during `clawnuke init` or configured in
`.clawnuke/config.json`.

Example:

```json
{
  "commands": {
    "format": "pnpm format",
    "lint": "pnpm lint",
    "typecheck": "pnpm typecheck",
    "test": "pnpm test"
  }
}
```

`clawnuke revalidate --finding <id>` runs a separate provider pass and updates
the finding status based on that result. `clawnuke revalidate --all` rechecks a
filtered queue and records one history entry per finding.

Current limitations:

- no `--skip-*` validation flags
- no targeted test command generation per finding
- no parallel batch revalidation
