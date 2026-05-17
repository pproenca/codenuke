---
title: Overview
permalink: /
description: "clawnuke maps repos into semantic feature slices, reviews each with AI providers for trusted simplification and complexity-reduction findings, and can apply explicit fixes."
---

## Try it

After installation and project initialization ([Quickstart](quickstart.md)), everything is a single command:

```bash
# Map repo into reviewable features
clawnuke map

# Review features in parallel
clawnuke review --limit 3 --jobs 3

# Generate findings report
clawnuke report

# Fix a specific finding
clawnuke fix --finding <id>

# Re-validate after manual edits
clawnuke revalidate --finding <id>
```

`--json` produces stable JSON on stdout. Human progress and warnings go to
stderr so pipes stay parseable.

## What clawnuke does

- **Semantic feature mapping.** Detects npm bins, Next.js routes, React Router routes, Python packages and Flask/FastAPI routes, Ruby/Rails slices, Laravel/PHP slices, Java/Kotlin Gradle modules, Go packages, Rust crates, C/C++ build targets, SwiftPM targets, and common config files as reviewable units.
- **Trusted refactoring review.** Reviews features with AI providers (Codex CLI today), persists behavior-preserving simplification and complexity-reduction findings with severity, category, and line locations.
- **Explicit fix workflow.** `clawnuke fix` runs validated patches for one finding at a time, never commits or pushes automatically.
- **Stable state model.** All features, findings, patches live in `.clawnuke/` as JSON, resumable across runs.
- **Safety first.** Review is read-only, fix refuses dirty worktrees, never auto-commits, validates before accepting patches.
- **Multi-language.** JavaScript/TypeScript, Python, Ruby, PHP/Laravel, Java/Kotlin, Go, Rust, C/C++, and Swift today; more mappers planned.

## Pick your path

- **Trying it.** [Install](install.md) → [Quickstart](quickstart.md). Five minutes from `pnpm add` to your first review.
- **Understanding features.** [Feature Mapping](feature-mapping.md) explains how clawnuke slices repos into reviewable units.
- **Running reviews.** [Code Review](code-review.md) covers provider integration, parallel execution, and finding categories.
- **Fixing findings.** [Patching](patching.md) documents the explicit fix workflow and validation steps.
- **Reading reports.** [Reporting](reporting.md) shows how to generate Markdown reports and filter by severity.
- **Configuring providers.** [Providers](providers.md) lists supported backends and future provider integration plans.

## All features

- [Installation](install.md)
- [Quickstart](quickstart.md)
- [Configuration](configuration.md)
- [Feature Mapping](feature-mapping.md)
- [Code Review](code-review.md)
- [Findings](findings.md)
- [Patching](patching.md)
- [Reporting](reporting.md)
- [Validation](validation.md)
- [Providers](providers.md)
- [Safety](safety.md)
- [E2E with Gitcrawl](e2e-gitcrawl.md)
- [Initialization](initialization.md)

## Project

Active development; the [changelog](https://github.com/openclaw/clawnuke/blob/main/CHANGELOG.md) tracks recent releases. Goals and implementation details in [spec.md](spec.md). Released under the [MIT license](https://github.com/openclaw/clawnuke/blob/main/LICENSE).
