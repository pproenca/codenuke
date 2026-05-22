# Superseded: semantic ROI eval gate

This ADR is superseded. The current default eval gate is the deterministic
fixture loop:

```bash
pnpm eval
```

Semantic evidence can still improve feature slicing, but it is not a default
review/fix provider contract and no longer has a separate ROI gate in
`pnpm eval`.
