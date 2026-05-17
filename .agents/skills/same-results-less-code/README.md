# Same Results, Less Code

A code-review and refactoring skill focused on the parts of code volume that come from **judgment and modelling gaps** — the things a senior reviewer notices that linters can't. Contains 40 rules across 8 categories.

## Overview

This skill targets the _second-pass_ refactoring work: what remains after `knip`, `eslint`, `ruff`, `tsc --noUnusedLocals`, and formatters have done their job. It is deliberately **not** a clone of those tools — every rule here requires _judgment_ about intent, modelling, or framing.

Core principles:

- **Preserve behaviour.** Every transformation must produce identical observable behaviour.
- **Earlier mistakes cascade.** Wrong frame multiplies into wrong shapes, which multiply into duplicate logic.
- **Explain why, not just what.** Each rule explains the cost of the anti-pattern so the model can transfer the judgment to novel cases.
- **Don't over-refactor.** Rule of three: extract abstractions when duplication has actually appeared three times, not in anticipation.

## Structure

```
same-results-less-code/
├── SKILL.md                    # Entry point with quick reference
├── README.md                   # This file
├── AGENTS.md                   # Auto-built TOC navigation
├── metadata.json               # Version, organization, references
├── references/
│   ├── _sections.md            # Category definitions and ordering
│   ├── reinvent-*.md           # Reinvention rules (5, CRITICAL)
│   ├── frame-*.md              # Wrong Frame rules (5, CRITICAL)
│   ├── dup-*.md                # Hidden Duplication rules (5, HIGH)
│   ├── derive-*.md             # Derived State Stored rules (5, HIGH)
│   ├── proc-*.md               # Procedural Rebuilds rules (5, MEDIUM-HIGH)
│   ├── spec-*.md               # Speculative Generality rules (5, MEDIUM)
│   ├── defense-*.md            # Defensive Excess rules (4, MEDIUM)
│   └── types-*.md              # Type System Underuse rules (6, LOW-MEDIUM)
└── assets/
    └── templates/
        └── _template.md        # Template for new rules
```

## Getting Started

```bash
# No installation required — this is a documentation-only skill.
# For development/validation:
pnpm install   # Install validation dependencies (optional)
pnpm build     # Build/compile AGENTS.md from source rules
pnpm validate  # Validate skill structure and content
```

1. Read `SKILL.md` for an overview and quick reference.
2. Check `references/_sections.md` to understand category priorities.
3. Reference individual rules as needed during code review or refactoring.

## Creating a New Rule

1. Confirm the rule **isn't** something a linter already catches (`knip`, `eslint`, `ruff`, `tsc`). If a linter handles it, the rule belongs in a different skill (e.g. `code-simplifier`).
2. Confirm the fix requires _judgment_ about intent, modelling, or framing — not just pattern matching.
3. Copy `assets/templates/_template.md` to `references/{prefix}-{slug}.md`.
4. Fill in frontmatter: `title`, `impact`, `impactDescription`, `tags`.
5. Write the WHY explanation (1-3 sentences explaining the cost of the anti-pattern).
6. Add `Incorrect` and `Correct` code examples (production-realistic, minimal-diff).
7. Add a `When NOT to use this pattern` section — every rule has a legitimate exception.
8. Update `SKILL.md`'s quick reference section.
9. Rebuild `AGENTS.md`: `node .../build-agents-md.js .`

## Rule File Structure

Each rule file follows this format:

```markdown
---
title: Rule Title
impact: CRITICAL|HIGH|MEDIUM-HIGH|MEDIUM|LOW-MEDIUM|LOW
impactDescription: Quantified impact (e.g., "reduces 50-200 lines of branches to a small table")
tags: prefix, technique, related-concepts
---

## Rule Title

WHY this matters (1-3 sentences explaining the cost of the anti-pattern).

**Incorrect (what's wrong):**
\`\`\`typescript
Bad example
\`\`\`

**Correct (what's right):**
\`\`\`typescript
Good example - minimal diff from incorrect
\`\`\`

**When NOT to use this pattern:**

- Exception 1 with reason
- Exception 2 with reason

Reference: [Source](https://example.com)
```

## File Naming Convention

- Prefix must match category: `reinvent-`, `frame-`, `dup-`, `derive-`, `proc-`, `spec-`, `defense-`, `types-`
- Slug should be descriptive: `function-not-class`, `parallel-types-same-shape`, `dont-store-computed`
- Examples: `frame-function-not-class.md`, `dup-near-twin-functions.md`, `defense-let-it-throw.md`

## Impact Levels

| Level       | Description                                                       | Used For                                 |
| ----------- | ----------------------------------------------------------------- | ---------------------------------------- |
| CRITICAL    | Cascades into many downstream costs; large maintenance impact     | Reinvention, Wrong Frame                 |
| HIGH        | Affects significant parts of the codebase; common refactor target | Hidden Duplication, Derived State        |
| MEDIUM-HIGH | Localised but high frequency; clear refactor wins                 | Procedural Rebuilds                      |
| MEDIUM      | Common but contained; judgment-dependent                          | Speculative Generality, Defensive Excess |
| LOW-MEDIUM  | Specific to type-system-aware languages; ergonomics-focused       | Type System Underuse                     |
| LOW         | Edge cases, expert patterns                                       | (none in this skill)                     |

## Scripts

Validate the skill structure and content:

```bash
node ~/.claude/plugins/cache/dot-claude/dev-skill/*/scripts/validate-skill.js ./same-results-less-code
```

Rebuild AGENTS.md after adding or modifying rules (never edit AGENTS.md manually):

```bash
node ~/.claude/plugins/cache/dot-claude/dev-skill/*/scripts/build-agents-md.js ./same-results-less-code
```

## Contributing

1. Follow the rule template exactly.
2. Ensure the first tag matches the file prefix.
3. Use production-realistic code examples (no `foo`/`bar`/`baz`).
4. Make the `Incorrect` → `Correct` diff minimal — preserve variable names and structure where possible.
5. Quantify impact: prefer "eliminates N lines / prevents X bug class" over "cleaner."
6. Include a `When NOT to use this pattern` section. Every rule has a legitimate exception, and naming it is what turns a rigid rule into transferable judgment.
7. Run validation before submitting.

## Related skills

| Skill                                              | Operates on      | What it catches                                                            |
| -------------------------------------------------- | ---------------- | -------------------------------------------------------------------------- |
| `eslint` / `knip` / `ruff` / `tsc`                 | Syntax / types   | Unused code, style, type errors                                            |
| [`code-simplifier`](../code-simplifier/)           | Mechanical form  | Naming, nesting, dead code, idioms                                         |
| [`complexity-optimizer`](../complexity-optimizer/) | Algorithms       | O(n²) → O(n log n), N+1 queries                                            |
| **`same-results-less-code`**                       | **Mental model** | **Wrong frame, hidden duplication, derived state, speculative generality** |
