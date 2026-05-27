import { FileSystem, Path } from "@effect/platform"
import { ProposerThreadState, type ProposerThreadState as ProposerThreadStateType } from "@codenuke/core"
import { Effect, Either, ParseResult, Schema } from "effect"
import type { ProposerMode } from "./proposer.ts"

export type ThreadState = ProposerThreadStateType

export const proposerThreadKey = (mode: ProposerMode, regionTarget: string): string => `${mode}:${regionTarget}`

const empty = (): ThreadState => ({
  schemaVersion: 1,
  provider: "codex-sdk",
  threads: {},
})

const decode = Schema.decodeUnknownEither(ProposerThreadState)

export const decodeProposerThreadState = (raw: unknown): ThreadState | null => {
  const parsed = decode(raw)
  if (Either.isRight(parsed)) return parsed.right
  ParseResult.TreeFormatter.formatErrorSync(parsed.left)
  return null
}

export const selectProposerThread = (
  state: ThreadState,
  key: string,
  baselineSha: string,
): string | undefined => {
  const entry = state.threads[key]
  if (entry === undefined) return undefined
  if (entry.baselineSha !== baselineSha) return undefined
  return entry.threadID
}

export const upsertProposerThread = (args: {
  readonly state: ThreadState
  readonly key: string
  readonly threadID: string
  readonly baselineSha: string
  readonly now: string
}): ThreadState => ({
  schemaVersion: 1,
  provider: "codex-sdk",
  threads: {
    ...args.state.threads,
    [args.key]: {
      threadID: args.threadID,
      createdAt: args.state.threads[args.key]?.createdAt ?? args.now,
      lastUsedAt: args.now,
      baselineSha: args.baselineSha,
    },
  },
})

export const readProposerThreadState = (
  repo: string,
): Effect.Effect<ThreadState, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const raw = yield* fs
      .readFileString(path.join(repo, ".codenuke", "proposer-threads.json"))
      .pipe(Effect.orElseSucceed(() => null))
    if (raw === null) return empty()
    const parsed = yield* Effect.try((): unknown => JSON.parse(raw)).pipe(Effect.orElseSucceed(() => null))
    return decodeProposerThreadState(parsed) ?? empty()
  })

export const writeProposerThreadState = (
  repo: string,
  state: ThreadState,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dir = path.join(repo, ".codenuke")
    yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.ignore)
    yield* fs
      .writeFileString(path.join(dir, "proposer-threads.json"), `${JSON.stringify(state, null, 2)}\n`)
      .pipe(Effect.ignore)
  })
