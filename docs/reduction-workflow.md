# Code Reduction Workflow

This workflow is for reducing codenuke's runtime code while preserving CLI
behavior, artifact schemas, and safety guarantees. It is designed to be repeated
across many small sessions without relying on conversation memory.

## Goal

Reduce runtime code only in behavior-preserving vertical slices. A slice is done
when it has mapped the behavior it touches, locked that behavior with tests or
recorded the test gap, made one scoped change, run the relevant checks, and
recorded before/after metrics.

Do not change:

- CLI commands, flags, defaults, exit codes, or documented workflows.
- `.codenuke/` artifact schemas.
- Worktree isolation, dirty-worktree safeguards, or proposer/scorer separation.
- Package contents, npm bin entrypoint, or published surface.
- Fail-closed behavior for missing, stale, or invalid safety artifacts.

## Operating Rules

1. Work in one responsibility boundary per slice.
2. Prefer characterization tests before extraction or deletion.
3. Preserve observable behavior unless a deliberate behavior change is explicitly
   approved and documented elsewhere.
4. Track AST, complexity, duplication, and behavior risk; do not use LOC alone as
   the success metric.
5. If a slice reveals a larger design problem, record it as a future slice and
   finish or revert the current slice.
6. Keep generated output, `.codenuke/` state, and unrelated churn out of commits.

## Behavior Surface Checklist

Before editing, identify which of these surfaces the slice can affect:

- Commands: `doctor`, `fence`, `calibrate`, `run`, `changecost`,
  `validate-proxy`, scorer subcommands, evals, and package smoke.
- Inputs: CLI args, `codenuke.loop.json`, `CN_*` environment variables, git
  state, benchmark fixtures, source/test layout.
- Outputs: stdout/stderr messages, exit codes, commits in isolated worktrees,
  `.codenuke/*.json`, `.codenuke/results.tsv`.
- Safety: baseline green checks, fail-closed artifact validation, allowed edit
  surfaces, hidden benchmark handling, node_modules worktree helper handling.
- Packaging: `package.json` `files`, bin entrypoint, installability, smoke test.

## Slice Workflow

### 1. Choose A Slice

Pick one small target such as:

- Extract repeated shell helpers.
- Extract repeated worktree cleanup/setup.
- Consolidate artifact status validation.
- Move a top-level CLI block into a named command function.
- Reduce duplicate dirty-path filtering.

Write the slice title in the progress log before editing.

### 2. Map Current Behavior

Record:

- Files and functions involved.
- Commands that observe the behavior.
- Artifact files read or written.
- Safety guarantee being protected.
- Existing tests that cover it.
- Missing coverage that would make the change risky.

Use AST-assisted inspection where useful:

```bash
node --input-type=module <<'NODE'
import ts from "typescript";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync(
  "git",
  ["ls-files", "bin/*.mjs", "loop/*.mjs", "evals/scripts/*.mjs", "scripts/*.mjs"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(Boolean)
  .filter((file) => !file.endsWith(".test.mjs"));

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let functions = 0;
  let branches = 0;
  let calls = 0;

  function visit(node) {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node)
    ) {
      functions += 1;
    }
    if (
      ts.isIfStatement(node) ||
      ts.isSwitchStatement(node) ||
      ts.isConditionalExpression(node)
    ) {
      branches += 1;
    }
    if (ts.isCallExpression(node)) calls += 1;
    ts.forEachChild(node, visit);
  }

  visit(sf);
  console.log(`${file}\tfunctions=${functions}\tbranches=${branches}\tcalls=${calls}`);
}
NODE
```

### 3. Lock Behavior

Before reducing code, add or confirm focused coverage. Prefer temp-repo CLI tests
for command behavior and focused unit tests for pure helpers.

If coverage is intentionally not added, record why in the progress log. Do not
use "seems safe" as the reason; name the existing behavior lock or the explicit
risk accepted.

### 4. Make One Scoped Reduction

Make the smallest behavior-preserving change that completes the slice. Good
changes usually:

- Remove repeated implementation while keeping call-site intent readable.
- Move executable top-level code into named command functions.
- Centralize parsing or validation that already follows the same schema.
- Preserve output construction at the boundary closest to the command.

Avoid broad rewrites, generic utility modules without a clear repeated concept,
or changing output text while extracting logic.

### 5. Verify

Run focused checks first, then broader checks for non-trivial changes:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Also run these when affected:

```bash
pnpm eval
pnpm pack:smoke
```

Run direct CLI checks when the slice touches command routing, output, worktrees,
or artifact handling:

```bash
node bin/codenuke.mjs doctor
node bin/codenuke.mjs --help
```

Record every check run and whether it passed.

### 6. Measure

Capture before/after metrics. At minimum:

```bash
git ls-files 'bin/*.mjs' 'loop/*.mjs' 'evals/scripts/*.mjs' 'scripts/*.mjs' \
  | rg -v '\.test\.mjs$' \
  | xargs wc -l
```

Use `loop/measure.mjs` for AST-oriented metrics:

```bash
node --input-type=module <<'NODE'
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { measure } from "./loop/measure.mjs";

const files = execFileSync(
  "git",
  ["ls-files", "bin/*.mjs", "loop/*.mjs", "evals/scripts/*.mjs", "scripts/*.mjs"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(Boolean)
  .filter((file) => !file.endsWith(".test.mjs"));

const source = Object.fromEntries(files.map((file) => [file, readFileSync(file, "utf8")]));
const result = measure(source);

console.log({
  files: files.length,
  astNodes: result.L,
  complexity: result.complexity,
  dupMass: result.dupMass,
  dupRate: result.dupRate,
  cloneSites: result.cloneSites,
});
NODE
```

## Progress Log

Append a row after each completed or abandoned slice.

| Date       | Slice                        | Behavior Surface                                                                                      | Tests Added/Confirmed                                                                            | Checks Run                                                                                                                                                                                                  | LOC Delta | AST Delta | Complexity Delta | Dup Delta | Status | Notes                                                                                                                                                          |
| ---------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------: | --------: | ---------------: | --------: | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-23 | Extract shell helpers        | `calibrate`, `config`, `fence`, `run`, `scorer`, `changecost`; subprocess execution and shell quoting | Added `loop/shell.test.mjs`; confirmed touched command tests                                     | `pnpm typecheck`; focused Vitest; `pnpm lint`; `pnpm test`; `pnpm build`; `pnpm eval`; `pnpm pack:smoke`; `pnpm format:check`; `node bin/codenuke.mjs --help` prints usage and exits 2 as existing behavior |       -28 |      -113 |               -4 |       -18 | done   | After: LOC 3301, AST 21338, complexity 726, dupMass 205. Risk: low; preserves exec defaults, captured failure output, timeout markers, and JSON shell quoting. |
| 2026-05-23 | Extract worktree helpers     | `scorer`, `fence`, `changecost`; worktree helper exclusion and cleanup                                | Added `loop/worktree.test.mjs`; confirmed scorer/fence/changecost cleanup tests                  | `pnpm typecheck`; focused Vitest; `pnpm lint`; `pnpm test`; `pnpm build`; `pnpm eval`; `pnpm pack:smoke`; `pnpm format:check`; `git diff --check`                                                           |       -31 |       -79 |               -8 |        -8 | done   | After: LOC 3270, AST 21259, complexity 718, dupMass 197. Risk: low; preserves best-effort cleanup, exclude idempotence, and worktree prune behavior.           |
| 2026-05-23 | Extract dirty path parsing   | `run`, `changecost`; proposer/implementer dirty path, cleanup, and allowed surface filtering          | Added `loop/worktree.test.mjs` parser/cleanup cases; confirmed autoloop/changecost surface tests | `pnpm typecheck`; focused Vitest; `pnpm lint`; `pnpm test`; `pnpm build`; `pnpm eval`; `pnpm pack:smoke`; `pnpm format:check`; `git diff --check`                                                           |         0 |       -51 |               -3 |       -27 | done   | After: LOC 3270, AST 21208, complexity 715, dupMass 170. Risk: low; caller-specific hidden benchmark and node_modules policies remain explicit.                |
| 2026-05-23 | Reuse rank primitive         | `stats`, `validate-proxy`; average-tie rank calculation for Mann-Whitney and Spearman                 | Added focused `ranks` test; confirmed value-proxy Spearman/CLI validation tests                  | `pnpm typecheck`; focused Vitest; `pnpm lint`; `pnpm test`; `pnpm build`; `pnpm eval`; `pnpm pack:smoke`; `pnpm format:check`; `git diff --check`                                                           |       -13 |      -144 |               -4 |         0 | done   | After: LOC 3257, AST 21064, complexity 711, dupMass 170. Risk: low; same average-tie rank algorithm now shared from `stats`.                                   |
| 2026-05-23 | Extract command availability | `config`, `doctor`; `command -v` checks for Bun and Codex availability                                | Added shell-helper command availability tests; confirmed config/doctor tests                     | `pnpm typecheck`; focused Vitest; `pnpm lint`; `pnpm test`; `pnpm build`; `pnpm eval`; `pnpm pack:smoke`; `pnpm format:check`; `git diff --check`                                                           |        -7 |        -5 |               -1 |         0 | done   | After: LOC 3250, AST 21059, complexity 710, dupMass 170. Risk: low; same `command -v` shell check now shared from `shell`.                                     |
| 2026-05-23 | Extract JSON reader          | `config`, `artifacts`; fail-soft JSON file parsing                                                    | Added focused JSON helper tests; confirmed config/artifact tests                                 | `pnpm typecheck`; focused Vitest; `pnpm lint`; `pnpm test`; `pnpm build`; `pnpm eval`; `pnpm pack:smoke`; `pnpm format:check`; `git diff --check`                                                           |        -6 |        -8 |                0 |         0 | done   | After: LOC 3244, AST 21051, complexity 710, dupMass 170. Risk: low; same parse-or-null behavior now shared from `json`.                                        |
| 2026-05-23 | Reuse doctor helpers         | `doctor`; subprocess checks and isolated readiness worktree cleanup                                   | Existing doctor readiness/cleanup tests                                                        | pending                                                                                                                                                                                                     |   pending |   pending |          pending |   pending | in progress | Before: LOC 3244, AST 21051, complexity 710, dupMass 170.                                                                                                      |

## Slice Template

Copy this block into a working note or issue for each slice:

```markdown
## Slice: <short title>

Behavior surface:

Files/functions:

Existing coverage:

Coverage added or gap accepted:

Before metrics:

Change:

Checks:

After metrics:

Result:

Follow-up slices:
```

## Stop Conditions

Stop the current slice and record the reason if:

- The required behavior is not understood.
- The change needs two or more unrelated responsibility boundaries.
- A characterization test cannot be written and no existing check observes the
  behavior.
- Verification fails and the failure is not obviously caused by the intended
  change.
- The slice starts changing CLI semantics, artifact schemas, or safety guarantees.

## Common Pitfalls

- Reducing LOC by hiding command behavior in generic helpers.
- Collapsing output strings in a way that changes user-facing diagnostics.
- Extracting helpers before proving repeated behavior is actually the same.
- Treating safety checks as ceremony.
- Leaving progress only in conversation instead of the progress log.
- Running broad checks only after a large batch of edits.
- Forgetting package smoke checks when the published surface changes.
