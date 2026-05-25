import { isSourceFile, isTestFile, type GuardrailFailure } from "@codenuke/core"
import { posix as pathPosix } from "node:path"

export const PROBATION_MAX_ITERATIONS = 3
export const PROBATION_MAX_FILES = 1
export const PROBATION_MAX_DIFFSIZE = 80

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
  const set = new Set(names)
  const graph = new Map(
    names.map((file) => [
      file,
      importSpecifiers(files[file] ?? "")
        .map((spec) => resolveImport(file, spec, set))
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
        continue
      }
      visit(target)
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
  const changed = args.allChanged.filter(isSourceFile)
  const size = [
    ...(changed.length > PROBATION_MAX_FILES
      ? [failure("probation-too-many-files", `probation allows ${PROBATION_MAX_FILES} changed source file(s)`)]
      : []),
    ...(args.diffsize > PROBATION_MAX_DIFFSIZE
      ? [failure("probation-diffsize", `probation diffsize cap is ${PROBATION_MAX_DIFFSIZE}`)]
      : []),
  ]
  const paths = args.allChanged.flatMap((file) => [
    ...(isTestFile(file) ? [failure("test-edit", "probation rejects test edits", "reject", file)] : []),
    ...(isDependencyOrConfigPath(file)
      ? [failure("dependency-config-edit", "probation rejects dependency/config edits", "reject", file)]
      : []),
    ...(isGeneratedOrBinaryPath(file)
      ? [failure("generated-binary-edit", "probation rejects generated/vendor/binary/snapshot edits", "reject", file)]
      : []),
  ])
  const exports = changed.flatMap((file) =>
    sameList(exportNames(args.before[file] ?? ""), exportNames(args.after[file] ?? ""))
      ? []
      : [failure("public-api-change", "probation rejects changed public exports", "reject", file)],
  )
  const before = new Set(importCycles(args.beforeGraph ?? args.before))
  const cycles = importCycles(args.afterGraph ?? args.after)
    .filter((cycle) => !before.has(cycle))
    .map((cycle) => failure("import-cycle", "probation rejects new import cycles", "reject", cycle))
  return [...size, ...paths, ...exports, ...cycles]
}
