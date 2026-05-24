# Equivalence + security characterization — `@codenuke/exec`

These tests pin the behavior the NEW safe subprocess substrate (`../main/exec`)
must satisfy when it replaces the vulnerable legacy module
`legacy/codenuke/loop/shell.mjs`. This is the **security-critical** slice: the
CWE-78 (OS command injection) remediation.

## Why this slice exists

The legacy module ran every command via `execSync(commandString)` — a single
string handed to a shell — and "escaped" arguments with
`quoteShellArg = JSON.stringify`. `JSON.stringify` only wraps a value in double
quotes; it does **not** neutralize shell metacharacters. Inside double quotes a
shell still expands `$(...)` and backticks, and a caller can still close the
quote and append `;`, `&&`, `|`, or a newline. That is the Critical
OS-command-injection root cause.

The new substrate runs commands via `execFile` / arg-arrays (`shell: false`).
There is no shell, so arguments are delivered to the child as a literal `argv`
vector and can never be re-interpreted as syntax. The bug class is **eliminated
by construction**, not patched.

## The target API under test

| Export             | Shape                                                        | Mirrors legacy     |
| ------------------ | ------------------------------------------------------------ | ------------------ |
| `run`              | `(file, args, options?) => string` (throws on nonzero)       | `runCommand`       |
| `tryRun`           | `(file, args, options?) => { ok, out, timedOut }` (no throw) | `tryCommand`       |
| `commandAvailable` | `(file, options?) => boolean`                                | `commandAvailable` |

`run` returns stdout as a string and throws like `execFileSync` on a nonzero
exit. `tryRun` never throws, concatenates `stdout + stderr` into `out`, and sets
`timedOut` on `SIGTERM`/`ETIMEDOUT`. `commandAvailable` is implemented
injection-safely (e.g. `sh -c 'command -v "$1"' sh <file>`, so `file` is a
positional argument, never interpolated into the script).

## The legacy is the oracle

Every benign-path expectation here was computed by **running the legacy code**,
not by reading a spec. The test file imports BOTH implementations and compares
them in the same run (dual-execution differential). Where spec and legacy
disagree, the test follows the legacy and the discrepancy is flagged separately.

## How to run

From the package root (`exec`):

```sh
npm test            # or: npx vitest run
npx vitest          # watch mode
```

Or from the workspace root:

```sh
npx vitest run exec
```

`src/main/exec.ts` contains the modern substrate under test.

## What is covered

1. **Functional equivalence (benign)** — plain-string echo === `"hello"` and
   === legacy; `cwd` honored (realpath-aware) and === legacy; `env` passthrough;
   `run` throws on nonzero exit.
2. **Git fixture** — `git init` + an empty commit (identity via `-c` flags
   through the SAME safe API), then `rev-parse HEAD` is a 40-char sha and equals
   the legacy oracle's. Temp repo is created/torn down per suite.
3. **`tryRun`** — failed command → `{ ok:false, out:"outerr", timedOut:false }`
   (mirrors the legacy `tryCommand` test); success → `ok:true`; a 200 ms timeout
   on a long sleep → `timedOut:true` (legacy agrees).
4. **`commandAvailable`** — `node` true, nonsense false, `""` false, all
   matching the legacy oracle; `git` true; the probe is proven injection-safe.
5. **SECURITY (the headline):**
   - **Vuln + fix proof** — the LEGACY path executes `$(touch <sentinelA>)` and
     a real file appears on disk; the NEW path echoes the same `$(touch ...)`
     text back verbatim and `<sentinelB>` is never created.
   - **Injection fuzz** — `; touch`, `&& touch`, `| touch`, backticks,
     `$(touch)`, newline-injected, and `--bad-flag` payloads are each passed as
     one arg, round-trip to the program byte-for-byte, and leave their dedicated
     sentinel ABSENT.
   - **No glob expansion** — `*` arrives as exactly one literal argument
     (`argv.length === 2`), never expanded to filenames.

### Sentinel discipline

Security tests assert a side-effect file is **absent**. Each sentinel is a
unique, currently-non-existent path under `os.tmpdir()` named with a per-process
run id (`pid` + timestamp) and a monotonic counter, registered for `afterAll`
cleanup. The single legacy-vuln test is the only place a sentinel is expected to
appear, and it is removed immediately. Git tests `skipIf` git is unavailable
(codenuke needs git, so they normally run).

## How to add a new case

1. If it is an equivalence case, compute the expected value from the **legacy**
   oracle by running it:

   ```sh
   node --input-type=module -e '
     import { tryCommand } from "./legacy/codenuke/loop/shell.mjs";
     console.log(JSON.stringify(tryCommand("node -e \"process.exit(1)\"")));
   '
   ```

2. Add an `it(...)` inside the matching `describe` block with a behavioral name
   (reads as a specification) and the literal expected value.
3. For a **security/injection** case, reserve a sentinel with
   `reserveSentinel("<tag>")`, embed `touch <sentinel>` in the payload, pass the
   payload as a single arg, then assert the program received it verbatim AND
   `existsSync(sentinel) === false`. Never hard-code a sentinel path.
4. If a behavior is not yet implemented in the target, mark it
   `it.todo(...)` / `it.skip(... "pending RULE-NNN")` rather than deleting it.
