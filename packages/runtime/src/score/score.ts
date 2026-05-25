import { Command, CommandExecutor, FileSystem, Path } from "@effect/platform"
import { posix as pathPosix } from "node:path"
import {
  allowlistEnv,
  countTypeErrors,
  decide,
  guardrailReport,
  hashUnknown,
  isSourceFile,
  isTestFile,
  measureFiles,
  metricContext,
  scoreEnvelope,
  type CalibrationScales,
  type CommandSpec,
  type GuardrailFailure,
  type Measurement,
  type MetricConfidence,
  type MetricProvenance,
  type ScoreEnvelope,
  type ScoreInputs,
  type Verdict,
  type Weights,
} from "@codenuke/core"
import { Chunk, Effect, Stream } from "effect"
import { readArtifactBundle } from "../artifacts/artifact-readiness.ts"
import { Git } from "../git/git.ts"

export const SCORE_DEFAULT_WEIGHTS: Weights = {
  dL: 1.0,
  dCx: 1.8,
  dDup: 0.35,
  scaleL: 150,
  scaleCx: 15,
  scaleDup: 5,
  r3: 1.0,
}

export const PROBATION_MAX_ITERATIONS = 3
export const PROBATION_MAX_FILES = 1
export const PROBATION_MAX_DIFFSIZE = 80

export interface GateInputs {
  readonly testsPass: boolean
  readonly fenceUsable: boolean
  readonly blockedRegions: readonly string[]
  readonly touchedFidelities: readonly number[]
  readonly diffsize: number
  readonly typeErrors: number
  readonly baselineTypeErrors: number
  readonly weights?: Weights
  readonly scales?: CalibrationScales | null
}

export const assembleScoreInputs = (args: {
  readonly before: Measurement
  readonly after: Measurement
} & GateInputs): ScoreInputs => ({
  before: args.before,
  after: args.after,
  testsPass: args.testsPass,
  fenceUsable: args.fenceUsable,
  blockedRegions: [...args.blockedRegions],
  touchedFidelities: [...args.touchedFidelities],
  diffsize: args.diffsize,
  typeErrors: args.typeErrors,
  baselineTypeErrors: args.baselineTypeErrors,
  weights: args.weights ?? SCORE_DEFAULT_WEIGHTS,
  scales: args.scales ?? null,
})

export const buildMetricProvenance = (args: {
  readonly baselineSha: string
  readonly config: unknown
  readonly artifactHashes: Record<string, string>
}): MetricProvenance => ({
  baselineSha: args.baselineSha,
  configHash: hashUnknown(args.config),
  artifactHashes: args.artifactHashes,
  toolchain: {
    node: process.version,
    codenuke: "0.5.0",
    typescript: "5.7",
  },
})

export const decideEnvelope = (args: {
  readonly before: Measurement
  readonly after: Measurement
  readonly gates: GateInputs
  readonly baselineSha: string
  readonly confidence: MetricConfidence
  readonly artifactHashes: Record<string, string>
  readonly config: unknown
  readonly guardrailFailures?: readonly GuardrailFailure[]
}): ScoreEnvelope => {
  const inputs = assembleScoreInputs({ before: args.before, after: args.after, ...args.gates })
  const guardrails = guardrailReport(args.guardrailFailures ?? [])
  const verdict = guardrails.failures.some((f) => f.severity === "block") ? null : decide(inputs)
  const metric = metricContext({
    confidence: args.confidence,
    weights: inputs.weights,
    provenance: buildMetricProvenance({
      baselineSha: args.baselineSha,
      config: args.config,
      artifactHashes: args.artifactHashes,
    }),
  })
  return scoreEnvelope({ verdict, metric, guardrails })
}

const commandExitCode = (
  worktree: string,
  spec: CommandSpec,
): Effect.Effect<number, never, CommandExecutor.CommandExecutor> => {
  const cmd = Command.make(spec.file, ...(spec.args ?? [])).pipe(
    Command.workingDirectory(worktree),
    Command.env(allowlistEnv(process.env, spec.env ?? {})),
  )
  return Command.exitCode(cmd).pipe(Effect.orElseSucceed(() => 1))
}

const chunksToString = (chunks: Chunk.Chunk<Uint8Array>): string =>
  Buffer.concat(Chunk.toReadonlyArray(chunks).map((chunk) => Buffer.from(chunk))).toString("utf8")

const commandResult = (
  worktree: string,
  spec: CommandSpec,
): Effect.Effect<{ readonly code: number; readonly output: string }, never, CommandExecutor.CommandExecutor> =>
  Effect.scoped(
    Effect.gen(function* () {
      const cmd = Command.make(spec.file, ...(spec.args ?? [])).pipe(
        Command.workingDirectory(worktree),
        Command.env(allowlistEnv(process.env, spec.env ?? {})),
      )
      const proc = yield* Command.start(cmd)
      const [stdout, stderr, code] = yield* Effect.all(
        [Stream.runCollect(proc.stdout), Stream.runCollect(proc.stderr), proc.exitCode],
        { concurrency: "unbounded" },
      )
      return { code: Number(code), output: `${chunksToString(stdout)}\n${chunksToString(stderr)}` }
    }),
  ).pipe(Effect.orElseSucceed(() => ({ code: 1, output: "" })))

export const runTestCommand = (
  worktree: string,
  spec: CommandSpec,
): Effect.Effect<boolean, never, CommandExecutor.CommandExecutor> =>
  commandExitCode(worktree, spec).pipe(Effect.map((code) => code === 0))

export const runTypecheckCount = (
  worktree: string,
  spec: CommandSpec | null | undefined,
): Effect.Effect<number, never, CommandExecutor.CommandExecutor> => {
  if (spec == null) return Effect.succeed(0)
  return commandResult(worktree, spec).pipe(Effect.map(({ code, output }) => countTypeErrors(output, code !== 0)))
}

const exportNames = (source: string): readonly string[] => {
  const out = new Set<string>()
  for (const match of source.matchAll(/\bexport\s+(?:declare\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gu)) {
    if (match[1]) out.add(match[1])
  }
  for (const match of source.matchAll(/\bexport\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["']/gu)) {
    if (match[1] && match[2]) out.add(`*as:${match[1]}:${match[2]}`)
  }
  for (const match of source.matchAll(/\bexport\s+\*\s+from\s+["']([^"']+)["']/gu)) {
    if (match[1]) out.add(`*:${match[1]}`)
  }
  for (const match of source.matchAll(/\bexport\s*\{([^}]+)\}/gu)) {
    for (const part of (match[1] ?? "").split(",")) {
      const name = part.trim().split(/\s+as\s+/u)[1] ?? part.trim().split(/\s+/u)[0]
      if (name) out.add(name)
    }
  }
  if (/\bexport\s+default\b/u.test(source)) out.add("default")
  return [...out].sort()
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index])

const isUnderRegion = (file: string, region: string): boolean =>
  region === "." || file === region || file.startsWith(region.endsWith("/") ? region : `${region}/`)

const isDependencyOrConfigPath = (file: string): boolean =>
  /(^|\/)(package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb|tsconfig(?:\.[^/]*)?\.json|vite\.config\.[cm]?[jt]s|rollup\.config\.[cm]?[jt]s|webpack\.config\.[cm]?[jt]s)$/u.test(file) ||
  file.startsWith(".github/")

const isGeneratedOrBinaryPath = (file: string): boolean =>
  /(^|\/)(vendor|generated|dist|coverage)\//u.test(file) ||
  /\.(?:generated|min)\.[cm]?[jt]sx?$/u.test(file) ||
  /\.(?:png|jpg|jpeg|gif|webp|avif|pdf|zip|tar|gz|tgz|snap)$/u.test(file)

const importSpecifiers = (source: string): readonly string[] => {
  const specs: string[] = []
  for (const match of source.matchAll(/\b(?:import|export)\s+(?:type\s+)?(?:[^'"`]*?\s+from\s+)?["']([^"']+)["']/gu)) {
    if (match[1]?.startsWith(".")) specs.push(match[1])
  }
  for (const match of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu)) {
    if (match[1]?.startsWith(".")) specs.push(match[1])
  }
  return specs.sort()
}

const resolveImport = (from: string, spec: string, files: ReadonlySet<string>): string | null => {
  const base = pathPosix.normalize(pathPosix.join(pathPosix.dirname(from), spec))
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    pathPosix.join(base, "index.ts"),
    pathPosix.join(base, "index.tsx"),
    pathPosix.join(base, "index.js"),
    pathPosix.join(base, "index.jsx"),
  ]
  return candidates.find((candidate) => files.has(candidate)) ?? null
}

const canonicalCycle = (cycle: readonly string[]): string => {
  const body = cycle.slice(0, -1)
  if (body.length === 0) return ""
  const rotations = body.map((_, index) => [...body.slice(index), ...body.slice(0, index)].join(">"))
  return rotations.sort()[0] ?? body.join(">")
}

const importCycles = (files: Record<string, string>): readonly string[] => {
  const names = Object.keys(files).filter((file) => files[file] !== "").sort()
  const fileSet = new Set(names)
  const graph = new Map(
    names.map((file) => [
      file,
      importSpecifiers(files[file] ?? "")
        .map((spec) => resolveImport(file, spec, fileSet))
        .filter((target): target is string => target !== null)
        .sort(),
    ]),
  )
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []
  const cycles = new Set<string>()

  const visit = (file: string): void => {
    if (visited.has(file)) return
    if (visiting.has(file)) return
    visiting.add(file)
    stack.push(file)
    for (const target of graph.get(file) ?? []) {
      if (visiting.has(target)) {
        const start = stack.indexOf(target)
        if (start >= 0) cycles.add(canonicalCycle([...stack.slice(start), target]))
      } else {
        visit(target)
      }
    }
    stack.pop()
    visiting.delete(file)
    visited.add(file)
  }

  for (const file of names) visit(file)
  return [...cycles].filter(Boolean).sort()
}

const failure = (
  code: string,
  message: string,
  severity: GuardrailFailure["severity"] = "reject",
  path?: string,
): GuardrailFailure => ({ code, message, severity, ...(path === undefined ? {} : { path }) })

export const probationGuardrails = (args: {
  readonly probation: boolean
  readonly changed: readonly string[]
  readonly allChanged: readonly string[]
  readonly diffsize: number
  readonly before: Record<string, string>
  readonly after: Record<string, string>
  readonly beforeGraph?: Record<string, string>
  readonly afterGraph?: Record<string, string>
}): readonly GuardrailFailure[] => {
  if (!args.probation) return []
  const failures: GuardrailFailure[] = []
  const sourceChanged = args.allChanged.filter(isSourceFile)
  if (sourceChanged.length > PROBATION_MAX_FILES) {
    failures.push(failure("probation-too-many-files", `probation allows ${PROBATION_MAX_FILES} changed source file(s)`))
  }
  if (args.diffsize > PROBATION_MAX_DIFFSIZE) {
    failures.push(failure("probation-diffsize", `probation diffsize cap is ${PROBATION_MAX_DIFFSIZE}`))
  }
  for (const file of args.allChanged) {
    if (isTestFile(file)) failures.push(failure("test-edit", "probation rejects test edits", "reject", file))
    if (isDependencyOrConfigPath(file)) {
      failures.push(failure("dependency-config-edit", "probation rejects dependency/config edits", "reject", file))
    }
    if (isGeneratedOrBinaryPath(file)) {
      failures.push(failure("generated-binary-edit", "probation rejects generated/vendor/binary/snapshot edits", "reject", file))
    }
  }
  for (const file of sourceChanged) {
    const beforeExports = exportNames(args.before[file] ?? "")
    const afterExports = exportNames(args.after[file] ?? "")
    if (!sameList(beforeExports, afterExports)) {
      failures.push(failure("public-api-change", "probation rejects changed public exports", "reject", file))
    }
  }
  const beforeCycles = new Set(importCycles(args.beforeGraph ?? args.before))
  for (const cycle of importCycles(args.afterGraph ?? args.after)) {
    if (!beforeCycles.has(cycle)) {
      failures.push(failure("import-cycle", "probation rejects new import cycles", "reject", cycle))
    }
  }
  return failures
}

export const scoreCurrentChange = (opts: {
  readonly repo: string
  readonly artifactRepo?: string
  readonly region?: string
  readonly testCommand: CommandSpec
  readonly typeCheckCommand?: CommandSpec | null
  readonly baselineTypeErrors?: number
  readonly baselineSha?: string
  readonly threshold?: number
  readonly weights?: Weights
  readonly probation?: boolean
}) =>
  Effect.gen(function* () {
    const git = yield* Git
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const region = opts.region ?? "."
    const artifactRepo = opts.artifactRepo ?? opts.repo
    const threshold = opts.threshold ?? 0.9
    const baselineSha = opts.baselineSha ?? (yield* git.resolveSha(opts.repo, "HEAD"))
    const artifacts = yield* readArtifactBundle({ repo: artifactRepo, baselineSha, threshold })

    const changed = yield* git.diffNames(opts.repo, region)
    const allChanged = yield* git.diffNames(opts.repo, ".").pipe(Effect.orElseSucceed(() => changed))
    const sources = changed.filter(isSourceFile)
    const allSources = [...new Set(allChanged.filter(isSourceFile))].sort()

    const before: Record<string, string> = {}
    const after: Record<string, string> = {}
    for (const rel of sources) {
      before[rel] = yield* git.showAtRef(opts.repo, "HEAD", rel)
      after[rel] = yield* git.safeRead(opts.repo, rel).pipe(Effect.orElseSucceed(() => ""))
    }
    const beforeChanged: Record<string, string> = { ...before }
    const afterChanged: Record<string, string> = { ...after }
    for (const rel of allSources) {
      if (beforeChanged[rel] === undefined) beforeChanged[rel] = yield* git.showAtRef(opts.repo, "HEAD", rel)
      if (afterChanged[rel] === undefined) {
        afterChanged[rel] = yield* git.safeRead(opts.repo, rel).pipe(Effect.orElseSucceed(() => ""))
      }
    }

    const shortStat = yield* git.diffShortStat(opts.repo, region)
    const diffsize = shortStat.insertions + shortStat.deletions
    const testsPass = yield* runTestCommand(opts.repo, opts.testCommand)
    const typeErrors = yield* runTypecheckCount(opts.repo, opts.typeCheckCommand)
    const baselineTypeErrors =
      opts.baselineTypeErrors ??
      (opts.typeCheckCommand == null
        ? 0
        : yield* Effect.scoped(
            Effect.gen(function* () {
              const parent = yield* fs.makeTempDirectoryScoped({ prefix: "codenuke-score-baseline-" })
              const worktree = path.join(parent, "tree")
              yield* Effect.acquireRelease(git.worktreeAdd(opts.repo, worktree, baselineSha), () =>
                git.worktreeRemove(opts.repo, worktree).pipe(Effect.ignore),
              )
              const repoNodeModules = path.join(opts.repo, "node_modules")
              const worktreeNodeModules = path.join(worktree, "node_modules")
              const hasNodeModules = yield* fs.exists(repoNodeModules).pipe(Effect.orElseSucceed(() => false))
              if (hasNodeModules) {
                yield* fs.symlink(repoNodeModules, worktreeNodeModules).pipe(Effect.ignore)
              }
              return yield* runTypecheckCount(worktree, opts.typeCheckCommand)
            }).pipe(Effect.orElseSucceed(() => 0)),
          ))

    const fenceRec = artifacts.fence?.regions[region]
    const fenceUsable = artifacts.readiness.fenceUsable && fenceRec !== undefined
    const touchedFidelities = changed.length > 0 && fenceRec ? [fenceRec.lo] : []
    const outOfSurface = allChanged.filter((file) => !isUnderRegion(file, region))
    const blockedRegions = [
      ...outOfSurface,
      ...(changed.length > 0 && fenceRec?.admissible !== true ? [region] : []),
    ]
    const probation = opts.probation ?? artifacts.confidence !== "validated"
    const guardrailFailures = probationGuardrails({
      probation,
      changed,
      allChanged,
      diffsize,
      before: beforeChanged,
      after: afterChanged,
      beforeGraph: beforeChanged,
      afterGraph: afterChanged,
    })

    return decideEnvelope({
      before: measureFiles(before),
      after: measureFiles(after),
      gates: {
        testsPass,
        fenceUsable,
        blockedRegions,
        touchedFidelities,
        diffsize,
        typeErrors,
        baselineTypeErrors,
        weights: opts.weights ?? SCORE_DEFAULT_WEIGHTS,
        scales: artifacts.calibrationScales,
      },
      baselineSha,
      confidence: artifacts.confidence,
      artifactHashes: artifacts.artifactHashes,
      config: {
        region,
        threshold,
        weights: opts.weights ?? SCORE_DEFAULT_WEIGHTS,
        probation,
        testCommand: opts.testCommand,
        typeCheckCommand: opts.typeCheckCommand ?? null,
      },
      guardrailFailures,
    })
  })

export const renderScoreHuman = (envelope: ScoreEnvelope): string => {
  const v: Verdict | null = envelope.verdict
  const guardrail = envelope.guardrails.failures[0]
  if (v === null) {
    return [
      `verdict: BLOCKED`,
      `  metric=${envelope.metric.identity.semver} confidence=${envelope.metric.confidence}`,
      guardrail ? `  guardrail=${guardrail.code}: ${guardrail.message}` : "  guardrail=unknown",
    ].join("\n")
  }
  const word = envelope.status === "accepted" ? "KEEP" : v.admissible ? "REVERT (no gain)" : "REVERT (gate fail)"
  const lossStr = v.loss === null ? "null" : v.loss.toFixed(4)
  const failed = v.failedGates.length ? `  failedGates=[${v.failedGates.join(",")}]` : ""
  const guardrailText = guardrail ? `\n  guardrail=${guardrail.code}: ${guardrail.message}` : ""
  return [
    `verdict: ${word}`,
    `  metric=${envelope.metric.identity.semver} confidence=${envelope.metric.confidence}`,
    `  gain=${v.gain.toFixed(4)}  risk=${v.risk.toFixed(4)}  loss=${lossStr}`,
    `  ΔL=${v.dL}  ΔCx=${v.dCx}  ΔDup=${v.dDup}  mfence=${v.mfence}`,
    `  gates: G1=${v.gates.G1} G1'=${v.gates.G1prime} G3=${v.gates.G3} G4=${v.gates.G4}${failed}${guardrailText}`,
  ].join("\n")
}
