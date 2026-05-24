#!/usr/bin/env node
/**
 * codenuke CLI entrypoint — @effect/cli command tree (architecture §8).
 *
 * Subcommands: fence, run (alias loop), score (--json), changecost, calibrate,
 * validate-proxy, doctor, init, accept, revert, status, cleanup, plus --version.
 *
 * Layer wiring = NodeContext.layer + the runtime service Lives. Cancellation +
 * worktree cleanup rely on `NodeRuntime.runMain` (NEVER process.exit) so SIGINT/
 * SIGTERM interrupt the main fiber and run scoped finalizers.
 *
 * The tag→POSIX-exit-code table is owned here (see ./exit-codes.ts) and applied
 * by the runMain error handler. Command bodies are `Effect.die("unimplemented")`
 * stubs EXCEPT `--version` (handled by Command.run) and doctor's "not ready"
 * path (real enough to exit 2).
 */
import { Args, Command, Options } from "@effect/cli"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { FenceLive, makeMutationRunnerLive } from "@codenuke/fence"
import {
  CalibrationServiceLive,
  ChangeCostServiceLive,
  CodexProposerLive,
  ConfigLive,
  GitLive,
  makeApplyingFakeProposerLive,
  ndjsonRenderer,
  OrchestratorLive,
  ProgressBus,
  ProgressBusLive,
  renderScoreHuman,
  runAccept,
  runCalibrate,
  runChangeCost,
  runCleanup,
  runDoctor,
  runFenceAudit,
  runInit,
  runReduceLoop,
  runRevert,
  runScore,
  runStatus,
  runValidateProxy,
  shouldRequireValueProxyValidation,
  ttyRenderer,
  toNdjson,
  ValueProxyServiceLive,
} from "@codenuke/runtime"
import { Cause, Console, Effect, Fiber, Layer, Option } from "effect"
import { existsSync } from "node:fs"
import { resolve as pathResolve } from "node:path"

/** Build the test CommandSpec from the env (argv only; never a shell string). */
const testCommandFromEnv = (): { readonly file: string; readonly args: readonly string[] } => {
  const file = process.env.CN_TEST_FILE ?? "npm"
  const raw = process.env.CN_TEST_ARGS_JSON
  if (!raw) return { file, args: ["test"] }
  try {
    const v: unknown = JSON.parse(raw)
    return { file, args: Array.isArray(v) ? v.map(String) : ["test"] }
  } catch {
    return { file, args: ["test"] }
  }
}

const envCommand = (
  prefix: string,
  fallback: { readonly file: string; readonly args: readonly string[] } | null,
): { readonly file: string; readonly args: readonly string[] } | null => {
  const file = process.env[`${prefix}_FILE`] ?? fallback?.file
  const raw = process.env[`${prefix}_ARGS_JSON`]
  if (!file) return null
  if (!raw) return { file, args: fallback?.args ?? [] }
  try {
    const v: unknown = JSON.parse(raw)
    return { file, args: Array.isArray(v) ? v.map(String) : fallback?.args ?? [] }
  } catch {
    return { file, args: fallback?.args ?? [] }
  }
}

const typeCheckCommandFromEnv = (): { readonly file: string; readonly args: readonly string[] } | null => {
  if (process.env.CN_TYPECHECK_FILE || process.env.CN_TYPECHECK_ARGS_JSON) {
    return envCommand("CN_TYPECHECK", { file: process.env.CN_TYPECHECK_FILE ?? "npm", args: ["run", "typecheck"] })
  }
  const tsc = pathResolve(process.cwd(), "node_modules/.bin/tsc")
  if (existsSync(pathResolve(process.cwd(), "tsconfig.json")) && existsSync(tsc)) {
    return { file: tsc, args: ["-p", "tsconfig.json", "--noEmit"] }
  }
  return null
}
import { exitCodeFor, EXIT_NOT_READY } from "./exit-codes.ts"

const VERSION = "0.5.0"

// ---------------------------------------------------------------------------
// Reusable args / options.
// ---------------------------------------------------------------------------
// `Options.boolean` already defaults to false when the flag is absent.
const jsonOption = Options.boolean("json")

// ---------------------------------------------------------------------------
// Subcommands. Bodies are stubs (Effect.die) except doctor (real "not ready").
// Each handler is wired so the dispatcher (RULE-039 etc.) routes by name.
// ---------------------------------------------------------------------------

/**
 * `fence [cap] [seed] [regions]` — Slice 1. Runs the AST-aware mutation audit
 * (one worktree per region, mutants sequential in-place; RULE-006/007/008/009),
 * writing `.codenuke/fence-fidelity.json`. The test command comes from
 * CN_TEST_FILE / CN_TEST_ARGS_JSON; regions default to CN_SRC (or `src`).
 */
const fence = Command.make(
  "fence",
  {
    cap: Args.integer({ name: "cap" }).pipe(Args.withDefault(60)),
    seed: Args.integer({ name: "seed" }).pipe(Args.withDefault(1337)),
    regions: Args.text({ name: "regions" }).pipe(Args.optional),
  },
  ({ cap, regions, seed }) =>
    Effect.gen(function* () {
      const regionList = (Option.getOrUndefined(regions) ?? process.env.CN_SRC ?? "src")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      const result = yield* runFenceAudit({
        repo: process.cwd(),
        regions: regionList,
        cap,
        seed,
        threshold: 0.9, // RULE-006 fenceLB default (CN_FENCE_LB wiring: Slice 3)
        fenceConcurrency: 1, // bounded pool / CPU-derived concurrency: follow-up
      }).pipe(
        Effect.provide(FenceLive.pipe(Layer.provide(makeMutationRunnerLive(testCommandFromEnv())))),
      )
      yield* Console.log(`fence: wrote ${result.outPath}`)
      for (const [key, rec] of Object.entries(result.artifact.regions)) {
        yield* Console.log(
          `  ${key}: caught ${rec.caught}/${rec.total} p=${rec.p.toFixed(3)} lo=${rec.lo.toFixed(3)} admissible=${rec.admissible}`,
        )
      }
    }),
)

/**
 * The reduce autoloop (RULE-038): startup gate (RULE-030/054) → propose→score→
 * keep/revert for N iterations. Proposer selected by CN_PROPOSER_PROVIDER
 * (`codex` default | `fake`); the applying fake removes CN_FAKE_MARKER lines from
 * CN_FAKE_FILE for hermetic smokes. Region = CN_SRC (or `src`).
 */
const reduceRun = (iterations: number, json: boolean) =>
  Effect.gen(function* () {
    const repo = process.cwd()
    const region = process.env.CN_SRC ?? "src"
    const provider = process.env.CN_PROPOSER_PROVIDER ?? "codex"
    const proposerLayer =
      provider === "fake"
        ? makeApplyingFakeProposerLive({
            rel: process.env.CN_FAKE_FILE ?? `${region}/index.ts`,
            marker: process.env.CN_FAKE_MARKER ?? "codenuke:remove",
          })
        : CodexProposerLive
    const progress = yield* ProgressBus
    const renderer = json ? ndjsonRenderer(progress.stream) : ttyRenderer(progress.stream, process.stderr.isTTY && !process.env.NO_COLOR)
    const renderFiber = yield* Effect.fork(renderer)
    const report = yield* runReduceLoop({
      repo,
      region,
      iterations,
      testCommand: testCommandFromEnv(),
      typeCheckCommand: typeCheckCommandFromEnv(),
      threshold: 0.9,
      resultRef: "refs/codenuke/result",
    }).pipe(
      Effect.provide(proposerLayer),
      Effect.ensuring(progress.shutdown),
      Effect.ensuring(Fiber.join(renderFiber).pipe(Effect.ignore)),
    )
    if (!json) {
      yield* Console.log(
        `run: kept ${report.kept}, reverted ${report.reverted} over ${report.iterations.length} iteration(s); reduction ${report.reductionPct.toFixed(1)}%`,
      )
      for (const o of report.iterations) {
        yield* Console.log(`  #${o.iter} ${o.kept ? "KEEP" : "REVERT"} ΔL=${o.dL} (${o.reason})`)
      }
      yield* Console.log("journal: .codenuke/results.tsv")
      if (report.resultRef !== null) {
        yield* Console.log(`result: ${report.resultRef} — \`git merge ${report.resultRef}\` to adopt`)
      }
    }
  })

const run = Command.make(
  "run",
  { iterations: Args.integer({ name: "iterations" }).pipe(Args.withDefault(5)), json: jsonOption },
  ({ iterations, json }) => reduceRun(iterations, json),
)

/** `loop` is an alias of `run`. */
const loop = Command.make(
  "loop",
  { iterations: Args.integer({ name: "iterations" }).pipe(Args.withDefault(5)), json: jsonOption },
  ({ iterations, json }) => reduceRun(iterations, json),
)

/** The target region (single-region for now): CN_SRC or `src`. */
const srcRegion = (): string => process.env.CN_SRC ?? "src"

/**
 * `score [--json]` — judge the pending change in the managed worktree (RULE-044/035),
 * or the cwd working-tree change when uninitialized. `--json` emits the `Scored`
 * v2 envelope; otherwise a human summary.
 */
const score = Command.make("score", { json: jsonOption }, ({ json }) =>
  Effect.gen(function* () {
    const envelope = yield* runScore({
      repo: process.cwd(),
      region: srcRegion(),
      testCommand: testCommandFromEnv(),
      typeCheckCommand: typeCheckCommandFromEnv(),
    })
    yield* Console.log(json ? toNdjson({ _tag: "Scored", envelope }) : renderScoreHuman(envelope))
  }),
)

/** `changecost [ref]` (C11, RULE-011/012/013) — held-out implementer benchmark → 𝒱̂. */
const changecost = Command.make(
  "changecost",
  { ref: Args.text({ name: "ref" }).pipe(Args.optional) },
  () =>
    Effect.gen(function* () {
      const r = yield* runChangeCost({
        repo: process.cwd(),
        benchmarkDir: process.env.CN_BENCH ?? ".codenuke/benchmark",
        region: process.env.CN_SRC ?? "src",
        beta: Number(process.env.CN_BETA ?? "60"),
        testCommand: testCommandFromEnv(),
      })
      yield* Console.log(`changecost: wrote ${r.outPath}`)
      yield* Console.log(`  Vhat=${r.Vhat ?? "null"} done=${r.done}/${r.total}`)
    }),
)

/** `calibrate` (C9, RULE-010) — derive per-repo value scales from git history. */
const calibrate = Command.make("calibrate", {}, () =>
  Effect.gen(function* () {
    const r = yield* runCalibrate({ repo: process.cwd(), region: process.env.CN_SRC ?? "src" })
    yield* Console.log(`calibrate: wrote ${r.outPath}`)
    yield* Console.log(
      `  scales sL=${r.scales.sL} sCx=${r.scales.sCx} sDup=${r.scales.sDup} (commitsSampled=${r.commitsSampled}, enoughHistory=${r.enoughHistory})`,
    )
  }),
)

/** `validate-proxy [input]` (C10, RULE-024) — Spearman proxy↔𝒱̂ validation. */
const validateProxy = Command.make(
  "validate-proxy",
  { input: Args.text({ name: "input" }).pipe(Args.optional) },
  ({ input }) =>
    Effect.gen(function* () {
      const inputPath =
        Option.getOrUndefined(input) ??
        process.env.CN_PROXY_INPUT ??
        ".codenuke/value-proxy-input.json"
      const r = yield* runValidateProxy({ repo: process.cwd(), inputPath })
      yield* Console.log(`validate-proxy: wrote ${r.outPath}`)
      yield* Console.log(
        `  passed=${r.report.passed} reason=${r.report.reason ?? "none"} rho=${r.report.rho ?? "null"} p=${r.report.pValue ?? "null"} (n=${r.report.candidates})`,
      )
    }),
)

/**
 * `doctor [iterations]` (RULE-032) — collect readiness gaps (no short-circuit,
 * unlike the startup gate) and report. With no iteration count, report full
 * artifact readiness; with a count, mirror the startup gate for that run length.
 * Exit 0 when ready, 2 when not.
 */
const doctor = Command.make(
  "doctor",
  { iterations: Args.integer({ name: "iterations" }).pipe(Args.optional) },
  ({ iterations }) =>
    Effect.gen(function* () {
      const requestedIterations = Option.getOrUndefined(iterations)
      const requireValueProxy =
        requestedIterations === undefined
          ? true
          : shouldRequireValueProxyValidation(requestedIterations)
      const gaps = yield* runDoctor(process.cwd(), requireValueProxy)
      if (gaps.length === 0) {
        yield* Console.log("codenuke doctor: ready")
        return
      }
      yield* Console.error(`codenuke doctor: not ready (${gaps.length} gap(s))`)
      for (const g of gaps) {
        yield* Console.error(`  ✗ ${g.kind}: ${g.message}`)
      }
      return yield* Effect.fail({ _tag: "NotReady" as const })
    }),
)

/** RULE-044 — manual scorer lifecycle over a persistent managed worktree. */
const init = Command.make("init", {}, () =>
  Effect.gen(function* () {
    const r = yield* runInit({ repo: process.cwd(), region: srcRegion(), typeCheckCommand: typeCheckCommandFromEnv() })
    yield* Console.log(
      `init: managed worktree ${r.worktree} @ ${r.baselineSha.slice(0, 7)} (startL=${r.startL})`,
    )
  }),
)
const accept = Command.make("accept", {}, () =>
  Effect.gen(function* () {
    const r = yield* runAccept({
      repo: process.cwd(),
      region: srcRegion(),
      testCommand: testCommandFromEnv(),
      typeCheckCommand: typeCheckCommandFromEnv(),
    })
    yield* Console.log(r.ok ? `accept: committed ${r.sha.slice(0, 7)} (iter ${r.iter})` : `accept: ${r.reason}`)
  }),
)
const revert = Command.make("revert", {}, () =>
  Effect.gen(function* () {
    const r = yield* runRevert({ repo: process.cwd(), region: srcRegion() })
    yield* Console.log(r.ok ? "revert: discarded the pending change" : `revert: ${r.reason}`)
  }),
)
const status = Command.make("status", {}, () =>
  Effect.gen(function* () {
    const s = yield* runStatus({ repo: process.cwd(), region: srcRegion() })
    if (!s.initialized) {
      yield* Console.log("status: not initialized — run `codenuke init`")
      return
    }
    yield* Console.log(
      `status: iter=${s.iter} accepted=${s.accepted} startL=${s.startL} currentL=${s.currentL} reduction=${s.reductionPct.toFixed(1)}%`,
    )
  }),
)
const cleanup = Command.make("cleanup", {}, () =>
  Effect.gen(function* () {
    yield* runCleanup({ repo: process.cwd(), region: srcRegion() })
    yield* Console.log("cleanup: removed managed worktree + state")
  }),
)

// ---------------------------------------------------------------------------
// Root command + subcommand tree.
// ---------------------------------------------------------------------------
const codenuke = Command.make("codenuke", {}, () =>
  Console.log("codenuke — run `codenuke --help` for usage"),
).pipe(
  Command.withSubcommands([
    fence,
    run,
    loop,
    score,
    changecost,
    calibrate,
    validateProxy,
    doctor,
    init,
    accept,
    revert,
    status,
    cleanup,
  ]),
)

// ---------------------------------------------------------------------------
// Service layer wiring.
// ---------------------------------------------------------------------------
const RuntimeServices = Layer.mergeAll(
  ConfigLive,
  GitLive,
  OrchestratorLive,
  ProgressBusLive,
  CalibrationServiceLive,
  ValueProxyServiceLive,
  ChangeCostServiceLive,
)

// `provideMerge` wires NodeContext (FileSystem / CommandExecutor / Path) INTO the
// runtime services (GitLive needs them) AND re-exposes them — so the program's
// requirements are fully discharged. (A plain mergeAll would leave them unmet.)
const AppLayer = RuntimeServices.pipe(Layer.provideMerge(NodeContext.layer))

// ---------------------------------------------------------------------------
// Run. `Command.run` provides --help / --version / completions. The error
// handler maps tagged errors to POSIX exit codes via exitCodeFor and sets
// process.exitCode (never process.exit) so finalizers run.
// ---------------------------------------------------------------------------
const cli = Command.run(codenuke, { name: "codenuke", version: VERSION })

const program = cli(process.argv).pipe(
  Effect.catchAll((error) =>
    Effect.sync(() => {
      const code = exitCodeFor(error)
      process.exitCode = code === 0 ? EXIT_NOT_READY : code
    }),
  ),
  Effect.catchAllCause((cause) =>
    Effect.sync(() => {
      process.stderr.write(Cause.pretty(cause) + "\n")
      process.exitCode = 1
    }),
  ),
  Effect.provide(AppLayer),
)

NodeRuntime.runMain(program)
