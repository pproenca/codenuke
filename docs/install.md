---
title: Installation
description: "How to install clawnuke from npm or source"
---

# Installation

## npm/pnpm

```bash
pnpm add -g clawnuke
```

Or with npm:

```bash
npm install -g clawnuke
```

Verify:

```bash
clawnuke --version
```

## From source

Clone and build:

```bash
git clone https://github.com/openclaw/clawnuke.git
cd clawnuke
pnpm install
pnpm build
pnpm link --global
```

Verify:

```bash
clawnuke --version
clawnuke doctor
```

## Provider setup

clawnuke requires an AI provider for code review. The default is the local Codex CLI.

### Codex CLI

Install the Codex CLI so `codex --version` works locally. If available in your
environment:

```bash
brew install codex
```

Verify:

```bash
codex --version
clawnuke doctor
```

`clawnuke doctor` checks that the configured provider is available and can execute test queries.

## Next steps

- [Quickstart](quickstart.md) - Run your first review
- [Configuration](configuration.md) - Customize behavior
- [Providers](providers.md) - Other provider options
