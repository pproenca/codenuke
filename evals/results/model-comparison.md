# Codex GPT-5.5 Model Eval Comparison

Generated: 2026-05-19T17:10:44.429Z

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
| guidance-middle-man | 0 | 1 | 1 |
