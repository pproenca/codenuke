---
title: Initialization
description: "Project initialization and detection"
---

# Initialization

`clawnuke init` creates project-local state.

```bash
clawnuke init
clawnuke init --force
```

It detects:

- git remote, branch, and head
- project name
- languages
- known frameworks
- package managers
- likely validation commands

It writes:

- `.clawnuke/project.json`
- `.clawnuke/config.json`

`--force` allows replacing the existing project/config detection output. It does
not run review, fix code, commit, or contact any provider.
