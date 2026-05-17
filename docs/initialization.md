---
title: Initialization
description: "Project initialization and detection"
---

# Initialization

`codenuke init` creates project-local state.

```bash
codenuke init
codenuke init --force
```

It detects:

- git remote, branch, and head
- project name
- languages
- known frameworks
- package managers
- likely validation commands

It writes:

- `.codenuke/project.json`
- `.codenuke/config.json`

`--force` allows replacing the existing project/config detection output. It does
not run review, fix code, commit, or contact any provider.
