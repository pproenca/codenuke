# Codex GPT-5.5 Model Eval Comparison

Generated: 2026-05-19T17:28:07.779Z

## Runs

- Baseline: 12/12 fixtures passed (strict)
- Model: 11/12 fixtures passed (codex/gpt-5.5, medium, record)

## Guidance Coverage

- Baseline unowned selectable resources: 0
- Model unowned selectable resources: 0
- Baseline unowned resources: 0
- Model unowned resources: 0

## Patch Boundary

- Baseline unexpected files: 0
- Model unexpected files: 0
- Baseline boundary failures: 0
- Model boundary failures: 0

## Performance

- Baseline total duration: 12151ms
- Model total duration: 227725ms
- Baseline median / p95 fixture duration: 1008ms / 1932ms
- Model median / p95 fixture duration: 19322ms / 28372ms
- Token usage: unavailable (Codex CLI eval output does not expose token usage in codenuke result records yet.)

## Workflow

- Baseline patch attempts: 1
- Model patch attempts: 0
- Baseline validation commands: 0
- Model validation commands: 0

## Model Failures

- mock-refactor

## Finding Deltas

| Fixture | Baseline findings | Model findings | Delta |
| --- | ---: | ---: | ---: |
| guidance-comments | 0 | 1 | 1 |
| guidance-conditional | 0 | 1 | 1 |
| guidance-duplicate | 0 | 1 | 1 |
| guidance-long-method | 0 | 1 | 1 |
| guidance-long-parameters | 0 | 1 | 1 |
| guidance-message-chain | 0 | 1 | 1 |
| guidance-middle-man | 0 | 1 | 1 |
| mock-clean | 0 | 1 | 1 |
