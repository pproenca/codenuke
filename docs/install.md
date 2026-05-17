---
title: Installation
description: "How to install codenuke from npm or source"
---

# Installation

## npm/pnpm

```bash
pnpm add -g codenuke
```

Or with npm:

```bash
npm install -g codenuke
```

Verify:

```bash
codenuke --version
```

## From source

Clone and build:

```bash
git clone https://github.com/pproenca/codenuke.git
cd codenuke
pnpm install
pnpm build
pnpm link --global
```

Verify:

```bash
codenuke --version
codenuke doctor
```

## Provider setup

codenuke requires an AI provider for code review. The default is the local Codex CLI.

### Codex CLI

Install the Codex CLI so `codex --version` works locally. If available in your
environment:

```bash
brew install codex
```

Verify:

```bash
codex --version
codenuke doctor
```

`codenuke doctor` checks that the configured provider is available and can execute test queries.

## Next steps

- [Quickstart](quickstart.md) - Run your first review
- [Configuration](configuration.md) - Customize behavior
- [Providers](providers.md) - Other provider options
