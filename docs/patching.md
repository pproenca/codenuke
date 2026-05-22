---
title: Patching
description: "Explicit fix workflow for individual findings"
---

# Patching

`codenuke fix` is explicit and finding-scoped.

```bash
codenuke fix --finding <findingId>
```

Current behavior:

- reads the selected finding
- checks the worktree is clean outside `.codenuke/` when configured
- creates a patch attempt record
- asks the provider for a fix plan
- lets the provider edit the worktree during the explicit fix command
- checks that changed files stay inside the finding's patch boundary
- runs configured validation commands in this order:
  - format check
  - typecheck
  - lint
  - test
- records command results
- links the patch attempt to the finding

Status updates:

- validation success marks the finding `uncertain`
- validation failure keeps the finding `open`
- out-of-boundary changes fail the patch attempt and keep the finding `open`

The CLI does not currently mark a finding `fixed` from the patch pass alone.
Use `codenuke revalidate --finding <id>` for a second pass.

Not implemented yet:

- fixing by severity or category
- batching multiple findings
- auto-commit
- PR creation
- rollback snapshots

Patch boundary failures are inspectable. Codenuke records the allowed and
unexpected files on the patch attempt, but it does not auto-restore files.
