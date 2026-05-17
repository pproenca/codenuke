---
title: Configuration
description: "Configure clawnuke behavior, providers, and validation commands"
---

# Configuration

Config is loaded from:

- `--config <path>`
- `$CLAWNUKE_CONFIG`
- `$CLAWNUKE_STATE_DIR/config.json`
- `clawnuke.config.json`
- `.clawnuke/config.json`
- built-in defaults

Default shape:

```json
{
  "schemaVersion": 1,
  "stateDir": ".clawnuke",
  "include": ["**/*"],
  "exclude": [
    "node_modules/**",
    "dist/**",
    "build/**",
    "target/**",
    ".build/**",
    ".git/**",
    ".clawnuke/**"
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

- `CLAWNUKE_STATE_DIR`
- `CLAWNUKE_PROVIDER`
- `CLAWNUKE_MODEL`
- `CLAWNUKE_REASONING_EFFORT`

`git.commit` and `git.openPr` are reserved config fields. The current CLI does
not commit or open PRs.
