---
name: test-cli
description: Guide for testing the codenuke CLI interactively.
---

Build before running local CLI checks:

```bash
pnpm -s build
node dist/cli.js --help
node dist/cli.js doctor --plain
node dist/cli.js status --plain
```

Use a temporary root when exercising commands that write `.codenuke/` state.
Keep the fixture small and inspect the resulting files before deciding the
behavior is correct.

Useful interactive flows:

```bash
node dist/cli.js init --root <tmp-repo>
node dist/cli.js map --root <tmp-repo> --source heuristic
node dist/cli.js review --root <tmp-repo> --provider mock --limit 1
node dist/cli.js report --root <tmp-repo> --plain
node dist/cli.js next --root <tmp-repo> --plain
```

For provider-related debugging, start with `--provider mock` or `mock-fail`
before invoking real external agents. Use `--json` when validating machine
readable output and `--debug` only when the extra detail is needed.
