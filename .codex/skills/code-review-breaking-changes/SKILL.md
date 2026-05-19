---
name: code-review-breaking-changes
description: Breaking changes
---

Search for breaking changes in external integration surfaces:

- CLI commands, flags, exit codes, and default output
- `.codenuke/config.json`
- `.codenuke/features/*.json`, `.codenuke/findings/*.json`,
  `.codenuke/patches/*.json`, and generated reports
- provider command construction and provider schema contracts
- mapper feature IDs and project naming
- npm package contents, bin entrypoint, and install workflow
- documentation promises in `README.md` and `docs/`
- resuming review, fix, and revalidation runs from existing state

Do not stop after finding one issue; analyze all possible ways breaking changes can happen.
