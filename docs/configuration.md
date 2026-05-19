---
title: Configuration
description: "Configure codenuke behavior, providers, and validation commands"
---

# Configuration

Config is loaded from:

- `--config <path>`
- `$CODENUKE_CONFIG`
- `$CODENUKE_STATE_DIR/config.json`
- `codenuke.config.json`
- `.codenuke/config.json`
- built-in defaults

Default shape:

```json
{
  "schemaVersion": 1,
  "stateDir": ".codenuke",
  "include": ["**/*"],
  "exclude": [
    "node_modules/**",
    "dist/**",
    "build/**",
    "target/**",
    ".build/**",
    ".git/**",
    ".codenuke/**"
  ],
  "provider": {
    "name": "codex",
    "model": null,
    "reasoningEffort": null
  },
  "commands": {
    "typecheck": null,
    "lint": null,
    "format": null,
    "formatCheck": null,
    "test": null
  },
  "review": {
    "maxContextFiles": 24,
    "maxOwnedFiles": 12,
    "maxFindingsPerFeature": 10,
    "minConfidenceToFix": "medium"
  },
  "git": {
    "requireCleanWorktreeForFix": true,
    "commit": false,
    "openPr": false
  }
}
```

Environment overrides:

- `CODENUKE_STATE_DIR`
- `CODENUKE_PROVIDER`
- `CODENUKE_MODEL`
- `CODENUKE_REASONING_EFFORT`

`git.commit` and `git.openPr` are reserved config fields. The current CLI does
not commit or open PRs.

`formatCheck` is the non-mutating formatter validation command used during
`codenuke fix`. Keep `format` for commands that rewrite files; `fix` skips
mutating formatter commands unless a check-like formatter command is available.
