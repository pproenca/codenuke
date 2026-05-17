---
title: Patching
description: "Explicit fix workflow for individual findings"
---

# Patching

`clawnuke fix` is explicit and finding-scoped.

```bash
clawnuke fix --finding <findingId>
```

Current behavior:

- reads the selected finding
- checks the worktree is clean outside `.clawnuke/` when configured
- creates a patch attempt record
- asks the provider for a fix plan
- lets the provider edit the worktree during the explicit fix command
- runs configured validation commands in this order:
  - format
  - typecheck
  - lint
  - test
- records command results
- links the patch attempt to the finding

Status updates:

- validation success marks the finding `uncertain`
- validation failure keeps the finding `open`

The CLI does not currently mark a finding `fixed` from the patch pass alone.
Use `clawnuke revalidate --finding <id>` for a second pass.

Not implemented yet:

- fixing by severity or category
- batching multiple findings
- auto-commit
- PR creation
- rollback snapshots
