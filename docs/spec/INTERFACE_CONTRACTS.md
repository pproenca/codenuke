# codenuke — Interface Contracts (rewrite-ready)

> Every external interface of the `codenuke` CLI, captured precisely enough for a
> greenfield Effect-TS (`@effect/cli`, `@effect/platform`) rebuild to match or
> deliberately improve. codenuke is a CLI tool: no HTTP server, no DB. "Interfaces"
> = CLI commands/flags/exit-codes/streams, `CN_*` env vars, `codenuke.loop.json`,
> filesystem artifacts, git operations, child-process calls, and the Codex SDK call.
>
> Source read 2026-05-24 (READ-ONLY symlink `legacy/codenuke`). Every claim cites
> `path:line`. "appears to / inferred" is flagged where structure is interpreted.
> Citations are repo-relative to `legacy/codenuke/`.

---

## INBOUND

### A. CLI commands

Entry point: `apps/cli/package.json bin.codenuke` → esbuild bundle of
`apps/cli/src/main/cli.ts` → `dist/cli.cjs`. Dispatch table:
`packages/orchestrator/src/main/orchestrator.ts:139 commandTarget()`; argv handling
in `cli.ts:82 main()`. Invocation: `process.argv.slice(2)`; `argv[0]` = command,
rest = args/flags. There is **no global flag parser** — flags are positional or
substring-matched (`rest.includes("--json")`).

| Command | Args (type, default) | Routes to | Purpose | Exit codes |
|---|---|---|---|---|
| `fence [cap=60] [seed=1337] [regions]` | `cap:number=60`, `seed:number=1337`, `regions:csv` (3rd positional, undocumented) | `fence/runtime.ts:616 runFenceCommand`→`auditFence` | Measure per-region behavior-fence fidelity via AST mutation testing; write `fence-fidelity.json` | `0` ok; `1` no regions / baseline RED / worktree cleanup fail / thrown error (`fence/runtime.ts:267,314,474,493`) |
| `fence replay <region> [worktree]` | `region:string` (req), `worktree:string=config.worktree` | `fence/runtime.ts:622`→`replayFence` | Monotonic replay of survivors; keep only a strictly-higher lower-bound | `0` ok; `1` missing region arg / artifact not usable / no such region / baseline not green (`fence/runtime.ts:512,519,524,558`) |
| `run [iterations=5]` / `loop [iterations=5]` | `iterations:int≥0=5` (`cli.ts:24 parseIterations`) | `orchestrator/runtime.ts:648 runAutoloop` | The propose→score→keep/revert autoloop | `0` ok; `1` startup-gate fail / state invalid / baseline missing / worktree init fail / program.md missing (`runtime.ts:666,673,714,721,1007`); `2` invalid iterations arg (`cli.ts:158`) |
| `score [--json]` | `--json` flag (substring match `cli.ts:138`) | `scorer/scorer.ts:420 runScorerCommand` | Score the current worktree change; print gates/verdict | `0` always for a scored/clean candidate; `1` only if no state (`run init first`) (`scorer.ts:416`) |
| `init` | none | `scorer.ts:420` | Create isolated worktree at baseline, verify green, write state | `0` ok; `1` baseline tests RED (`scorer.ts:452`) |
| `accept` | none | `scorer.ts:519` | Commit the current candidate iff it would `keep` | `0` ok/nothing-to-accept; `1` no state / verdict not keep (`scorer.ts:416,534`) |
| `revert` | none | `scorer.ts:568` | `git checkout -- srcDir` + clean source | `0` ok; `1` no state |
| `status` | none | `scorer.ts:579` | Print iterations, accepted SHAs, cumulative AST reduction | `0` ok; `1` no state |
| `cleanup` | none | `scorer.ts:598` | Remove state file + worktree | `0` always |
| `changecost [ref]` | `ref:string` (1st positional) else `CN_BASE` else `config.baseline` (`changecost.ts:221`) | `changecost/changecost.ts:439 runChangeCostCommand` | Held-out change-cost ground truth (𝒱̂); write `changecost.json` | `0` ok; `1` config/β error / no benchmark / baseline RED / cleanup fail / thrown (`changecost.ts:461,475,525,627,633`) |
| `validate-proxy [input]` | `input:path` (1st positional) else `${repo}/.codenuke/value-proxy.json` (`value-proxy.ts:285`) | `value-proxy/value-proxy.ts:277 runValidateProxyCommand` | Validate proxy↔𝒱̂ Spearman rank correlation; write `value-proxy-validation.json` | `0` PASS; `1` FAIL / missing input / invalid-config / malformed-input (`value-proxy.ts:296,309,339,364`) |
| `calibrate` | none (args ignored, `calibrate.ts:233 _args`) | `calibrate/calibrate.ts:232 runCalibrateCommand` | Derive per-repo value scales from git history; write `calibration.json` | `0` ok; `1` thrown error (`calibrate.ts:300`) |
| `doctor` | none | `orchestrator/runtime.ts:269 runDoctor` | Report readiness or precise gaps | `0` ready; `2` not ready (`runtime.ts:307`) |
| `--version` / `-v` | none | `cli.ts:17 packageVersion` | Print package version from `../package.json` | `0` |
| (no command) | — | `orchestrator.ts:174 cliHelpText` | Print help to **stdout** | `0` (`cli.ts:180`) |
| (unknown command) | — | — | Print help to stdout + `error: unknown command: <cmd>` to stderr | `2` (`cli.ts:177`) |
| (recognized-but-unimplemented) | — | — | "modernized runtime adapter is not implemented yet" to stderr | `2` (`cli.ts:170`) — currently unreachable; all `commandTarget` modules are wired |

Notes / inconsistencies vs docs:
- `validate-proxy [json]` in README (`apps/cli/README.md:42`) and help
  (`orchestrator.ts:186`) implies a `json` literal toggle. **The code treats the
  first positional as an input file path, not a `json` flag** (`value-proxy.ts:285`).
  No `--json` machine output exists for this command.
- The 3rd positional of `fence` (comma-separated region filter) is **undocumented**
  (`fence/runtime.ts:261`). It triggers a filtered/merged refresh of an existing
  artifact (`fence/runtime.ts:362,464`).
- `score --json` is the **only** machine-readable flag in the whole CLI
  (`scorer.ts:497`), and it emits a non-standard `@@JSON@@`-prefixed line (see
  OUTBOUND / CONTRACT FRAGMENTS).

### B. Standard streams (stdin / stdout / stderr) — current behavior

- **stdin**: never read by the CLI. (Subprocesses receive stdin: the Codex CLI
  rollback adapter pipes the prompt on the child's stdin, `substrate/agent.ts:117`.)
- **stdout**: human-readable progress + final buffered result. Commands stream
  reporter lines live, then `writeBufferedResult` writes any not-already-streamed
  stdout (`cli.ts:70`). For `score --json`, reporter lines are redirected to
  **stderr** and only the structured stdout (`@@JSON@@…`) goes to stdout
  (`cli.ts:144,146`).
- **stderr**: errors, the `score --json` progress stream, and cleanup-failure
  messages from fence/changecost (`fence/runtime.ts:474,496`, `changecost.ts:627`).
- **Exit code** is set via `process.exitCode = code` after `main()` resolves
  (`cli.ts:183`); the process is never hard-`exit()`-ed.

POSIX gaps the rewrite should fix: help goes to **stdout** even on the
unknown-command error path (`cli.ts:175`); there is no `--help`/`-h` flag (only the
no-arg path prints help); no `--quiet`/`--verbose`; the JSON channel uses an inline
sentinel rather than clean stdout.

### C. Environment variables (`CN_*`)

Resolution precedence (`config.ts:433 loadConfig`): **env → `codenuke.loop.json` →
auto-detection**. All numeric/JSON env vars are validated and **throw** on bad
input (config load fails → command exits non-zero).

| Env var | Type / default | Config field | Where read |
|---|---|---|---|
| `CN_REPO` | path = cwd | `repo` (also selects which `codenuke.loop.json`) | `config.ts:441,450` |
| `CN_SRC` | string = detected src dir | `srcDir` | `config.ts:451` |
| `CN_TARGET` | string = `${srcDir}/` | `target` (also injected per-region into proposer env) | `config.ts:453`; proposer override `proposer.ts:303` |
| `CN_BASE` | string = `HEAD` | `baseline`; also default `changecost` ref | `config.ts:454`; `changecost.ts:222` |
| `CN_TAG` | string = `run` | `tag` (slugged into branch/worktree/state/prompt names) | `config.ts:455` |
| `CN_REGIONS` | CSV → string[] | `regions` (overrides detection) | `config.ts:457` |
| `CN_WORKTREE` | path = `/tmp/codenuke-<tag>-<region>` | `worktree` | `config.ts:463` |
| `CN_STATE` | path = `/tmp/codenuke-<tag>-<region>.state.json` | `state` | `config.ts:497` |
| `CN_FENCE` | path = `${repo}/.codenuke/fence-fidelity.json` | `fenceArtifact` | `config.ts:499` |
| `CN_RESULTS` | path = `${repo}/.codenuke/results.tsv` | `results` | `config.ts:500` |
| `CN_PROGRAM` | path = packaged `program.md` | `program` (proposer program text) | `config.ts:501` |
| `CN_BENCH` | path = `${repo}/codenuke.benchmark` | `benchmarkDir` | `config.ts:506` |
| `CN_FENCE_LB` | number ∈ [0,1] = `0.9` | `thresholds.fenceLB` | `config.ts:464` |
| `CN_TIMEOUT` | number > 0 = `900000` | `proposerTimeoutMs` | `config.ts:468` |
| `CN_BUDGET` | string = `"8"` (substring-matched against agent output) | `proposerBudgetUsd` | `config.ts:519`; matched `orchestrator.ts:401` |
| `CN_WEIGHTS` | JSON object of finite numbers, merged over defaults | `weights[...]` | `config.ts:306,517` |
| `CN_TEST_FILE` + `CN_TEST_ARGS_JSON` | string + JSON string[] | `testCommand` | `config.ts:381,486` |
| `CN_TYPECHECK_FILE` + `CN_TYPECHECK_ARGS_JSON` | string + JSON string[] | `typeCheckCommand` | `config.ts:489` |
| `CN_IMPLEMENTER_FILE` + `CN_IMPLEMENTER_ARGS_JSON` | string + JSON string[] | `implementerCommand` (changecost) | `config.ts:493` |
| `CN_CODEX_PROVIDER` | `"cli"`→CLI adapter; else/`"sdk"`→SDK adapter | proposer selection | `proposer.ts:311` |
| `CN_CODEX_SANDBOX` | `read-only`/`workspace-write`/`danger-full-access` passthrough; `bypass`/`none`→`danger-full-access`; else `workspace-write` | SDK `sandboxMode` / CLI `--sandbox` | `proposer.ts:119`; `agent.ts:132` |
| `CN_CODEX_APPROVAL_POLICY` | `on-request`/`on-failure`/`untrusted`/`never`; else `never` | SDK `approvalPolicy` | `proposer.ts:120` |
| `CN_MODEL` | string (optional) | SDK `model` / CLI `--model` | `proposer.ts:136`; `agent.ts:138` |
| `CN_REASONING_EFFORT` | string (optional) | SDK `modelReasoningEffort` / CLI `-c model_reasoning_effort` | `proposer.ts:137`; `agent.ts:141` |
| `CN_REGION` | — (output) injected into proposer subprocess env = regionKey | `proposer.ts:302` |
| `CN_DELTA` | — (output) injected into changecost implementer env = delta id | `changecost.ts:544` |
| `CN_MIN_RHO` | number ∈ [-1,1] = `0.6` | validate-proxy `minimumRho` | `value-proxy.ts:151` |
| `CN_MIN_CANDIDATES` | int ≥ 2 = `6` | validate-proxy `minimumCandidates` | `value-proxy.ts:152` |
| `CN_ALPHA` | number ∈ (0,1] = `0.05` | validate-proxy `alpha` | `value-proxy.ts:153` |
| `CN_BETA` | number ≥ 0 = `60` | changecost cost weight β | `changecost.ts:213` |

**Rejected (throw with migration error) — legacy shell-string vars:**
`CN_PROPOSER` (`config.ts:434`, `proposer.ts:308`), `CN_IMPLEMENTER`
(`config.ts:437`), `CN_TEST` (`config.ts:387`), `CN_TYPECHECK` (`config.ts:387`).
Setting any aborts config load. (See Docs gap: `AGENTS.md` still calls these
"trusted shell strings" — stale.)

The brief's `CN_CODEX_PROVIDER` is confirmed real (`proposer.ts:311`). Note: there
is **no** `CN_CODEX_PROVIDER` artifact other than adapter choice; the assessment's
mention of `CN_CODEX_SANDBOX` is the security-relevant one.

### D. Config file — `codenuke.loop.json`

Read from `${cwd}/codenuke.loop.json`, and if `CN_REPO` differs, also
`${repo}/codenuke.loop.json`; cwd values are merged over repo values **unless**
`CN_REPO` is set, in which case only the repo file is used (`config.ts:440-446`).
Missing/invalid file → `{}` (safe read, `@codenuke/json`). Keys (all optional):

| Key | Type | Default / notes |
|---|---|---|
| `repo` | string | cwd |
| `srcDir` | string | detected |
| `target` | string | `${srcDir}/` |
| `baseline` | string | `HEAD` |
| `tag` | string | `run` |
| `regions` | string[] | detected (normalized: trimmed, non-empty) |
| `worktree` | string | `/tmp/codenuke-<tag>-<region>` |
| `state` | string | `/tmp/...state.json` |
| `fenceArtifact` | string | `${repo}/.codenuke/fence-fidelity.json` |
| `results` | string | `${repo}/.codenuke/results.tsv` |
| `program` | string | packaged `program.md` |
| `benchmarkDir` | string | `${repo}/codenuke.benchmark` |
| `fenceLB` | number ∈ [0,1] | `0.9` |
| `proposerTimeoutMs` | number > 0 | `900000` |
| `proposerBudgetUsd` | string | `"8"` |
| `weights` | object of finite numbers (`commandSpec`-free) | merged over defaults |
| `testCommand` | `CommandSpec` | detected runner |
| `typeCheckCommand` | `CommandSpec` | detected tsc or `null` |
| `implementerCommand` | `CommandSpec` | `null` |

`CommandSpec` (`exec/exec.ts:16`; validated `config.ts:348 commandSpec`): a
**string value throws** ("no longer accepts shell strings"); must be an object
`{ file: string (non-empty), args?: string[], timeoutMs?: number>0, env?: Record<string,string> }`.

**Auto-detection** (when neither env nor file set a value), defined in `config.ts`:
- `srcDir`: tsconfig `rootDir`/`include` bases by source-file count, then `src`/`lib`/`app`/`source`, then `package.json#source`, else `.` (`config.ts:225`).
- `testCommand`: `node_modules/.bin/{vitest run --reporter=dot|jest|mocha|ava}`, else bun/`pnpm|yarn|npm test` (`config.ts:112`).
- `typeCheckCommand`: `node_modules/.bin/tsc -p tsconfig.json --noEmit` iff tsconfig+tsc present, else `null` (`config.ts:141`).
- `regions`: immediate non-test subdirs of `srcDir`, sorted; else `[srcDir]`; else `[]` (`config.ts:261`).
- `testLayout.roots`: first of `test`/`tests`/`<pkgRoot>/test`/`<pkgRoot>/tests` containing a test file, else `[srcDir]` (`config.ts:178`).

### E. stdin-fed inputs (data files read as "inbound" payloads)

| Source | Shape | Consumer |
|---|---|---|
| `${repo}/.codenuke/value-proxy.json` | `Candidate[]` or `{candidates: Candidate[]}`; each `{id?, proxy:number, Vhat:number, ...}` | `validate-proxy` (`value-proxy.ts:173,315`) |
| `${benchmarkDir}/<id>/meta.json` | `{id?, title?, prompt?, region?, acceptPath?}` | `changecost` (`changecost.ts:301`) |
| `${benchmarkDir}/<id>/accept.test.ts` | raw test source | `changecost` (`changecost.ts:316`) |
| `program.md` | non-empty text (proposer reduce program) | autoloop (`runtime.ts:570 readReducerProgram`) |

---

## OUTBOUND

### A. `.codenuke/*.json` artifacts (all `schemaVersion: 1`)

| Artifact | Path | Producer | Lifecycle | Schema source |
|---|---|---|---|---|
| Fence fidelity | `${repo}/.codenuke/fence-fidelity.json` (or `CN_FENCE`) | `fence audit`/`replay` | Rewritten per-region during audit; replaced on replay; anti-tamper re-derived | `FenceArtifact` `fence/fence.ts:50` |
| Calibration | `${repo}/.codenuke/calibration.json` | `calibrate` | Written once per run | `CalibrationArtifact` `calibrate/calibrate.ts:88` |
| Value-proxy validation | `${repo}/.codenuke/value-proxy-validation.json` | `validate-proxy` | Written every run (incl. failures) | `ValueProxyValidationArtifact` `value-proxy/value-proxy.ts:63` |
| Change cost | `${repo}/.codenuke/changecost.json` | `changecost` | Written once per run | `ChangeCostArtifact` `changecost/changecost.ts:116` |
| Proposer threads | `${repo}/.codenuke/proposer-threads.json` | autoloop (SDK adapter) | Upserted per successful proposer turn, keyed `mode:regionTarget` | `ProposerThreadState` `orchestrator/proposer.ts:72` |

All are written with `JSON.stringify(value, null, 2)` and `mkdir -p` of the parent.
**Anti-tamper:** `artifacts.ts` re-derives Wilson (`validFenceRegions:91`),
Spearman (`valueProxyValidationStatus:225`), and changecost (`changeCostArtifactStatus:338`)
from raw rows, so a forged `admissible:true`/`passed:true` cannot pass.
**Gap:** `changeCostArtifactStatus` is exported + tested but **never wired into the
startup gate** (`runtime.ts:702 runStartupFailure` checks fence/calibration/value-proxy
only). The changecost artifact is the one safety artifact not re-validated at runtime.

### B. `results.tsv` (append log)

Path: `${repo}/.codenuke/results.tsv` (or `CN_RESULTS`). Header written once if
absent (`runtime.ts:723`). One tab-joined row appended per iteration
(`runtime.ts:643 logRow` → `orchestrator.ts:424 formatResultRow`).

Columns (`orchestrator.ts:18 RESULT_COLUMNS`):
`iter \t commit \t dAST \t dCx \t behavior \t mfence \t loss \t status \t description`

- `iter:number` (1-based loop index, **not** the kept-counter)
- `commit:string` (short SHA on keep/raise, else `-`)
- `dAST:number`, `dCx:number`
- `behavior:boolean|string` (`G1` result, or `"-"` / `"true"`)
- `mfence:number|string` (2-dp, or `"-"`)
- `loss:number|string` (3-dp, `"+Inf"`, or `"-"`)
- `status:string` — observed: `keep`, `revert`, `noop`, `raise`, `raise-skip`,
  `raise-noop`, `raise-badtest`, `raise-error`, `raise-nogain`, `crash`,
  `crash-timeout`, `crash-budget` (`runtime.ts` + `orchestrator.ts:397`)
- `description:string` (free text, unescaped — CWE-117 TSV/terminal injection risk)

### C. `/tmp` ephemeral artifacts

| File | Path | Producer | Shape |
|---|---|---|---|
| Worktree dir | `/tmp/codenuke-<tag>-<region>` (+ `-fence`, `-changecost`, `-doctor-<ts>` suffixes) | git worktree add | working copy |
| Engine state | `/tmp/codenuke-<tag>-<region>.state.json` | autoloop/scorer | `EngineState`/`ScorerState` (`runtime.ts:75`/`scorer.ts:88`) |
| Prompt | `/tmp/codenuke-<tag>-<region>.prompt.txt` | proposer | raw prompt text (`proposer.ts:217,242`) |
| CLI rollback last-message | `<promptFile>.last.txt` | CLI adapter only | agent final message (`proposer.ts:222`) |

Security note (CWE-377): predictable, world-readable `/tmp` paths; the rewrite
should `mkdtemp` under `os.tmpdir()` with `0700`/`0600`.

### D. Git operations (all via `@codenuke/exec`, `shell:false`, argv arrays)

Worktree lifecycle (`substrate/worktree.ts`): `worktree add -f <wt> <sha>`,
`worktree remove --force`, `worktree prune`, `reset --hard <ref>`,
`clean -fdq -- <path>`, `rev-parse --git-path info/exclude`. node_modules symlinked
in (`worktree.ts:71`), **unlinked during the proposer phase** so the agent can't
cheat, **relinked for scoring** (`runtime.ts:775,995,508`).

Read/measure (orchestrator/scorer/fence/calibrate/changecost): `rev-parse --verify
--end-of-options <ref>^{commit}`, `ls-tree -r -z --name-only <ref> -- <path>`,
`show <ref>:<path>`, `diff -z --name-only HEAD -- <dir>`, `diff --shortstat HEAD
-- <dir>`, `status --porcelain[=v1] -z [-uall]`, `ls-files -z [--others
--exclude-standard|--cached]`, `rev-list --first-parent --max-count=80`,
`rev-list --parents -n 1 <commit>`.

Commits (`runtime.ts:912,1109`; `scorer.ts:541`):
`git -c user.email=loop@codenuke -c user.name=codenuke -c commit.gpgsign=false
commit -m <msg>`, `add -A -- <paths>`, `rev-parse --short HEAD`,
`checkout -B autoresearch/<tag>`, `restore --staged --worktree -- <path>`.

Git-ref safety: plan builders assert refs/pathspecs (`scorer.ts:165`,
`changecost.ts:230`, `calibrate.ts:112`); `--end-of-options` used on `rev-parse`;
`--` separators used on pathspecs.

### E. Child processes (subprocess contract)

Single substrate `@codenuke/exec` (`exec/exec.ts:79 runProcess`): `spawn(file,
args, { shell:false, detached: !win32, stdio:["ignore","pipe","pipe"],
env: merge(parent, command.env) })`. Timeout default 300000ms (configurable per
`CommandSpec.timeoutMs` or option). Kill group SIGTERM→SIGKILL after 1s
(`exec.ts:104,130`). 16 MiB max output buffer (`exec.ts:48`). 15s heartbeat
progress lines (`exec.ts:142`). `run` throws on nonzero; `tryRun`/`tryRunCommand`
return `TryResult {ok,out,timedOut,elapsedMs,exitCode,signal}`.

External programs spawned:
- **test command** (`config.testCommand`) — twice per iteration (baseline + candidate); fence runs it per mutant with a **hardcoded 45s** timeout (`fence/runtime.ts:104,211`).
- **typecheck command** (`config.typeCheckCommand`, optional) — error count = lines matching `/error TS/` (`runtime.ts:346`, `scorer.ts:266`).
- **implementer command** (`config.implementerCommand`, optional, changecost only) — else Codex SDK implementer.
- **`codex`** — only on the CLI rollback path (`agent.ts:152 runCodexAgent` → `runProcessGroup`), with prompt piped on stdin and args from `codexArgs` (`agent.ts:126`).
- **`sh -c 'command -v -- "$1"' sh <file>`** — PATH probe `commandAvailable` (`exec.ts:226`), used by doctor for `codex`.

Duplicate runner: `substrate/agent.ts:36 runProcessGroup` re-implements the same
group/kill/heartbeat logic as `exec.ts` (Debt #2) — consolidate in the rewrite.

Env exposure (CWE-200): the **full parent `process.env`** is forwarded to the Codex
agent and to the target test/typecheck commands (`proposer.ts:299`, `exec.ts:56`,
`changecost.ts:544`). The rewrite should pass an allowlisted env.

### F. LLM proposer — `@openai/codex-sdk@0.133.0` (sole runtime dep)

Two adapters selected by `CN_CODEX_PROVIDER` (`proposer.ts:307`):
- **SDK (default)** `CodexSdkProposerAdapter` (`proposer.ts:236`): `new Codex({env})`
  → `startThread(opts)` or `resumeThread(threadId, opts)` →
  `thread.runStreamed(prompt, {signal})` → consume `streamed.events`.
- **CLI rollback** `CodexCliProposerAdapter` (`proposer.ts:213`): spawns `codex exec`
  via `runCodexAgent`; returns empty `commandEvents`/`fileChanges`.

`ThreadOptions` built per request (`proposer.ts:118`): `workingDirectory`=worktree,
`sandboxMode` (from `CN_CODEX_SANDBOX`), `approvalPolicy` (from
`CN_CODEX_APPROVAL_POLICY`, default `never`), optional `model`,
`modelReasoningEffort`.

**Streamed event handling** (`proposer.ts:177`):
- `item.completed` + `item.type==="command_execution"` → push to `commandEvents`
- `item.completed` + `item.type==="file_change"` → push to `fileChanges`
- `item.completed` + `item.type==="agent_message"` → `finalResponse = item.text`
- `turn.completed` → `usage = event.usage`
- `turn.failed` → throw `event.error.message`
- `error` → throw `event.message`

Timeout: `AbortController` aborted after `request.timeoutMs` (`proposer.ts:166`);
`timedOut` flag set; on abort the result `ok:false`, `timedOut: error.name==="AbortError"`.

**Thread continuity** (`proposer.ts:80,243`): key = `${mode}:${regionTarget||regionKey}`;
existing threadId resumed from `proposer-threads.json` or `request.threadId`; upserted
on success with `createdAt`/`lastUsedAt` (lastUsedAt recorded but never used for
eviction — inferred from absence of any reader).

**Cost/budget** (`proposer.ts:278`, `orchestrator.ts:401`): no hard budget enforced
on the SDK; `proposerFailure` string-matches `/Reached maximum budget|maximum budget/`
in agent output to classify `crash-budget`. `CN_BUDGET` ("8") is passed as
`budgetUsd` in the request but is **not** plumbed into the SDK call (inferred: not
referenced in `codexOptions`/`threadOptions`) — informational only.

The `changecost` SDK implementer (`changecost.ts:375 runCodexImplementer`) is a
**second, divergent** Codex event loop: hardcodes `sandboxMode:"workspace-write"`,
`approvalPolicy:"never"`, ignores `CN_CODEX_*`, and collects only the final message
(Debt #7).

---

## CONTRACT FRAGMENTS

TypeScript type fragments for every machine-facing surface. These are the
OpenAPI/AsyncAPI equivalents for this CLI.

### `score --json` output (the only `--json` surface)

Emitted as a single stdout line prefixed `@@JSON@@` after the human lines
(`scorer.ts:497`). Reporter progress is redirected to stderr for this mode
(`cli.ts:144`). **Rewrite should emit clean JSON on stdout (no sentinel).**

```ts
// line format: "@@JSON@@" + JSON.stringify(ScoreJson)
interface ScoreJson {
  admissible: boolean;
  keep: boolean;
  loss: number | null;     // null when non-finite/inadmissible
  gain: number;
  risk: number;
  dL: number; dCx: number; dDup: number;  // signed deltas
  mfence: number;          // min touched-region fidelity (1 if none touched)
  touched: string[];       // region keys touched
  blocked: string[];       // touched regions not fence-admissible
  gates: { G1: boolean; G1prime: boolean; G3: boolean; G4: boolean };
  files: string[];         // changed source files, srcDir-stripped
}
```

### `FenceArtifact` (`fence-fidelity.json`)

```ts
interface FenceArtifact {
  schemaVersion: 1;
  baseline: string;        // ref label, e.g. "HEAD"
  baselineSha: string;     // pinned commit (staleness check)
  generatedAt: string;     // ISO 8601
  method: "ast-aware";     // must equal this or → invalid-metadata
  threshold: number;       // must === config.fenceLB
  capPerRegion: number;    // positive integer
  seed: number;            // non-negative integer
  regions: Record<string, RegionRecord>;  // ≥1 key required
}
interface RegionRecord {
  caught: number;          // ≤ total
  total: number;
  p: number; lo: number; hi: number;  // Wilson; 0≤lo≤p≤hi≤1; re-derived from caught/total
  admissible: boolean;     // must === (lo >= threshold)
  survivorSpecs: PlannedMutation[];    // length must === total - caught
}
interface PlannedMutation {
  rel: string;             // repo-relative file
  start: number; end: number;   // 0 ≤ start < end (offsets)
  repl: string;
  op: string;              // e.g. "<→>"
}
```

### `CalibrationArtifact` (`calibration.json`)

```ts
interface CalibrationArtifact {
  schemaVersion: 1;
  baseline: string;
  baselineSha: string;     // non-empty
  generatedAt: string;     // ISO 8601
  commitsSampled: number;  // ≥3, unless scales === defaults {150,15,5}
  scales: { sL: number; sCx: number; sDup: number };  // all positive finite
}
```

### `ValueProxyValidationArtifact` (`value-proxy-validation.json`)

```ts
interface ValueProxyValidationArtifact {
  schemaVersion: 1;
  input: string;           // source candidates path
  passed: boolean;
  reason: null
    | "too-small-corpus" | "undefined-rank-correlation" | "low-rho"
    | "not-significant" | "invalid-config" | "malformed-input";
  candidates: number;      // == rows.length
  minimumCandidates: number;  // ≥2
  minimumRho: number;      // [-1,1]
  alpha: number;           // (0,1]
  rho: number | null;      // [-1,1]; must be ≥ minimumRho to be usable
  pValue: number | null;   // [0,1]; must be ≤ alpha to be usable
  pMethod: "exact" | "sampled" | "degenerate" | null;
  rows: Candidate[];
  error?: string;          // present on invalid-config / malformed-input
}
interface Candidate { id: string; proxy: number; Vhat: number; [k: string]: unknown }
```

### `ChangeCostArtifact` (`changecost.json`)

```ts
interface ChangeCostArtifact {
  schemaVersion: 1;
  ref: string;             // baseline ref the audit ran against
  beta: number;            // ≥0 (CN_BETA, default 60)
  Vhat: number | null;     // mean cost over done results; null if none
  done: number;            // count of status==="done" (== Vhat denominator)
  total: number;           // == results.length
  results: ChangeCostResult[];
}
interface ChangeCostResult {
  id: string;
  status: "impl-fail" | "impl-bad-surface" | "not-done" | "done";
  editTokens?: number;     // done only
  filesTouched?: number;   // done only
  regions?: string[];      // done only
  verifyFrac?: number;     // done only; mean(1-fidelity); [0,1]
  cost?: number;           // done only; == editTokens + beta*verifyFrac
  disallowed?: string[];   // impl-bad-surface only
}
```

### `ProposerThreadState` (`proposer-threads.json`)

```ts
interface ProposerThreadState {
  schemaVersion: 1;
  provider: "codex-sdk";
  threads: Record<string, ProposerThreadEntry>;  // key = `${mode}:${regionTarget}`
}
interface ProposerThreadEntry {
  threadId: string;
  mode: "reduce" | "raise-fence";
  regionKey: string;
  regionTarget: string;
  createdAt: string;       // ISO
  lastUsedAt: string;      // ISO (recorded, not used for eviction)
}
```

### `EngineState` / `ScorerState` (`.state.json`) — identical shape

```ts
interface EngineState {
  baselineSha: string;     // 40-hex (validated by orchestrator; NOT by scorer — CWE-502)
  baselineTsc: number;     // integer baseline type-error count
  startL: number;          // integer starting AST size
  accepted: string[];      // accepted commit short-SHAs
  iter: number;            // integer; increments only on keep
}
```

### Proposer SDK request/response (`proposer.ts:17,32`)

```ts
interface ProposerRequest {
  mode: "reduce" | "raise-fence";
  prompt: string;
  promptFile: string;      // /tmp/...prompt.txt
  repo: string; worktree: string;
  regionKey: string; regionTarget: string;
  timeoutMs: number;       // config.proposerTimeoutMs (default 900000)
  budgetUsd: string;       // "8" (not plumbed into SDK)
  threadId?: string;       // resume token
  env: NodeJS.ProcessEnv;  // forwarded (+ CN_REGION, CN_TARGET overrides)
  progress?: { emit(line: string): void };
}
interface ProposerResult {
  ok: boolean;             // SDK: turn completed without error/abort
  out: string;             // final agent_message text (or error message)
  timedOut: boolean;
  provider: "codex-cli" | "codex-sdk";
  threadId?: string;
  summary?: string;        // out collapsed to ≤200 chars
  error?: string;
  usage?: Usage | null;    // SDK turn.completed usage
  elapsedMs?: number;
  commandEvents?: CommandExecutionItem[];  // from item.completed
  fileChanges?: FileChangeItem[];          // from item.completed
}
// Usage (from @openai/codex-sdk) fields consumed by the status line (runtime.ts:632):
// input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens
```

### `CommandSpec` (config + exec) — `exec/exec.ts:16`

```ts
interface CommandSpec {
  file: string;            // required, non-empty; NO shell strings
  args?: readonly string[];
  timeoutMs?: number;      // finite > 0
  env?: Record<string, string>;
}
```

---

## STREAMING / PROGRESS

Today progress is a **synchronous push reporter** threaded as an optional
`{ emit(line: string): void }` (or, for fence, `{ emit(event: RuntimeEvent): void }`)
down through every command and every subprocess call. There is no event bus, no
backpressure, no structured channel — it is line-oriented text pushed as work
happens. The rewrite should model this as an Effect `Stream` of typed progress
events.

Mechanism details:
1. **CLI live reporter** (`cli.ts:61 liveReporter`): each emitted line is pushed to
   a `streamed[]` array **and** written immediately to the stream (stdout, or stderr
   for `score --json`). After the command resolves, `writeBufferedResult`
   (`cli.ts:70`) writes the final `result.stdout` **only if it wasn't already
   streamed** (de-dup via `alreadyStreamed`, `cli.ts:44`), then writes `stderr`.
   So the buffered final result and the live stream are reconciled to avoid
   double-printing. This dual buffer+stream design is the main thing to replace
   with a clean Effect Stream (no de-dup needed).
2. **Reporter types**: a plain line reporter (`{emit(line)}`) used by doctor,
   calibrate, changecost, validate-proxy, scorer, autoloop; and a structured
   `RuntimeReporter` for fence (`fence/runtime.ts:96`) whose events are rendered to
   lines via `renderRuntimeEvent` (`fence/runtime.ts:125`) and adapted to a line
   reporter via `textReporter` (`fence/runtime.ts:187`).
3. **Fence event model** (the closest existing thing to a typed progress stream —
   `fence/runtime.ts:43 RuntimeEvent`): `audit-start`, `phase {label,index,total}`,
   `region-plan {region,sites,sampled}`, `mutation-progress
   {region,done,total,overallDone,overallTotal,caught,survivors,elapsedMs}`,
   `region-result {region,caught,total,p,lo,hi,threshold,admissible,survivors}`,
   `artifact {path}`, `message {message}`. **This enum is the recommended seed for
   the Effect Stream event ADT** for the whole tool.
4. **Subprocess heartbeats** (`exec.ts:120,142,167`; `agent.ts:55,65,105`): each
   spawn emits `process start`, a 15s-interval `process still running … elapsed=…ms`
   heartbeat, and `process exit/timeout/error` lines through the same reporter — the
   natural source of long-op progress for the streaming rebuild.
5. **Loop telemetry** (`runtime.ts:620,630,748`): `proposerStatusLine`,
   `proposerResultLine` (provider/mode/region/thread/elapsed/commands/fileChanges/
   token usage/summary), per-iter banner, and `logRow` (which also appends to
   `results.tsv`). `results.tsv` is the durable per-iteration telemetry the rewrite
   can promote to a first-class machine-readable run log (NDJSON).

---

## Confidence & Gaps

- **High confidence** (read directly from source, cited): all command routing,
  args, exit codes, env vars, config keys, artifact schemas, git/subprocess calls,
  proposer SDK event handling, reporter mechanism.
- **Inferred (flagged inline):** `CN_BUDGET`/`budgetUsd` not plumbed into the SDK
  call; `lastUsedAt` never used for thread eviction — both inferred from absence of
  any reader, not from a comment.
- **Documentation inconsistencies found:**
  1. `validate-proxy [json]` (README:42 / help:186) — the positional is an **input
     file path**, not a `json` flag; no machine output exists (`value-proxy.ts:285`).
  2. `fence`'s 3rd positional (region CSV filter) is undocumented (`fence/runtime.ts:261`).
  3. `AGENTS.md` calls `CN_TEST/CN_TYPECHECK/CN_PROPOSER/CN_IMPLEMENTER` "trusted
     shell strings" but config **throws** on all four (`config.ts:387,434,437`).
  4. Hardcoded timeouts ignore `config.proposerTimeoutMs`: fence 45s
     (`fence/runtime.ts:104`), orchestrator/scorer/changecost 300s
     (`runtime.ts:101`, `scorer.ts:240`, `changecost.ts:552`).
  5. `changeCostArtifactStatus` exists + is tested but is **not** in the startup gate
     (`runtime.ts:702`) — the changecost artifact is never re-validated at runtime.
  6. `score --json` uses an `@@JSON@@` inline sentinel rather than a clean stdout
     JSON channel (`scorer.ts:499`).
- **Questions for an SME / product owner of the rewrite:**
  - Should `--json` be promoted to a global, POSIX-clean machine output mode across
    all commands (agent-optimised goal)? Currently only `score` supports it.
  - Is the dual buffer+stream reconciliation (de-dup) intentional behavior to
    preserve, or an artifact of the migration that the Effect Stream should drop?
  - Should `CN_BUDGET` actually enforce a hard SDK budget, or remain a
    string-match heuristic over agent output?
  - Should the changecost gate be wired in (Debt #6) or the artifact deprecated?
