---
title: Quickstart
description: "Get started with codenuke in five minutes"
---

# Quickstart

This guide walks through a complete review workflow from initialization to fixing findings.

## Prerequisites

- [Install codenuke](install.md)
- Install Codex CLI (`brew install codex`) for the default provider, or install
  the Grok Build CLI (`curl -fsSL https://x.ai/cli/install.sh | bash`) and pass
  `--provider grok` when reviewing
- Have a project with code to review

## 1. Initialize

```bash
cd your-project
codenuke init
```

This creates `.codenuke/` with:

- `config.json` - project configuration
- `project.json` - detected project metadata
- `features/` - feature records (created by `map`)
- `findings/` - review findings (created by `review`)
- `patches/` - patch attempts (created by `fix`)

Check project detection:

```bash
codenuke status
```

## 2. Map features

```bash
codenuke map
```

This discovers reviewable features:

- npm package bins and root/workspace scripts
- Next.js routes
- Go packages and commands
- Java/Kotlin Gradle modules
- Python packages, console scripts, Flask/FastAPI routes, and pytest suites
- JVM semantic role groups
- Ruby packages, Rails apps, executables, and tests
- Rust crates and binaries
- C/C++ standalone binaries and CMake/autotools targets
- SwiftPM targets and tests
- Laravel controllers, requests, jobs, commands, services, models, migrations, and tests
- Config files

Preview mapping without writing:

```bash
codenuke map --dry-run
```

Check mapped features:

```bash
codenuke status --json | jq '.features'
```

## 3. Review

Review a few features in parallel:

```bash
codenuke review --limit 3 --jobs 3
```

Using Grok instead of the default Codex provider:

```bash
codenuke review --provider grok --limit 3 --jobs 3
```

This:

- Selects 3 pending features
- Reviews them in parallel with 3 workers
- Calls the selected provider (Codex or Grok CLI) for each
- Persists findings under `.codenuke/findings/`
- Updates feature status

Progress goes to stderr, so you can pipe stdout:

```bash
codenuke review --limit 5 --json | jq '.findings'
```

## 4. Generate report

```bash
codenuke report
```

Filter by severity:

```bash
codenuke report --severity high
```

Save to file:

```bash
codenuke report -o report.md
```

## 5. Fix a finding

List findings:

```bash
codenuke report --status open
```

Fix one:

```bash
codenuke fix --finding <findingId>
```

This:

- Validates worktree is clean
- Calls provider with patch instructions
- Runs validation commands
- Records patch attempt
- Shows diff

Review the changes and commit manually if satisfied.

## 6. Revalidate

After manual edits or to re-check a finding:

```bash
codenuke revalidate --finding <findingId>
```

## Common workflows

### Review entire project

```bash
codenuke review --limit 999 --jobs 4
```

### Review specific feature

```bash
codenuke review --feature <featureId>
```

### Review with different model

```bash
codenuke review --model claude-opus-4-20250514 --limit 5
```

### Review with explicit Codex reasoning effort

```bash
codenuke review --model gpt-5.5 --reasoning-effort xhigh --limit 5
```

### Filter report by category

```bash
codenuke report --category security
```

### Check provider status

```bash
codenuke doctor
```

### Clean stale locks

If a review run was interrupted:

```bash
codenuke clean-locks
```

## Output formats

All commands support `--json` for machine-readable output:

```bash
codenuke map --json
codenuke review --json
codenuke status --json
```

## Next steps

- [Feature Mapping](feature-mapping.md) - How features are discovered
- [Code Review](code-review.md) - Review process details
- [Patching](patching.md) - Fix workflow explained
- [Configuration](configuration.md) - Customize behavior
- [Providers](providers.md) - Provider options
