/**
 * Manual scorer lifecycle (RULE-044) — the human/agent-driven counterpart to the
 * autoloop. `init` creates a persistent managed worktree at baseline + engine
 * state; the caller edits that worktree; `score` judges the pending change;
 * `accept` commits it (advancing state); `revert` discards it; `status` reports
 * cumulative reduction (RULE-062); `cleanup` tears it down.
 *
 * State lives at `<repo>/.codenuke/state.json` (the ONE Schema-validated reader,
 * RULE-053) and the worktree at `<repo>/.codenuke/worktree` (both gitignored).
 */
import { FileSystem, Path } from "@effect/platform"
import { isSourceFile, measureFiles } from "@codenuke/core"
import { Effect, Either } from "effect"
import { Git } from "../git/git.ts"
import { decodeEngineState, type EngineState } from "../orchestrator/state.ts"
import { scoreCurrentChange } from "../score/score.ts"

const stateFile = (path: Path.Path, repo: string): string => path.join(repo, ".codenuke", "state.json")
export const managedWorktree = (path: Path.Path, repo: string): string =>
  path.join(repo, ".codenuke", "worktree")

const readState = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  repo: string,
): Effect.Effect<EngineState | null> =>
  fs.readFileString(stateFile(path, repo)).pipe(
    Effect.map((s): EngineState | null => {
      try {
        return Either.getOrNull(decodeEngineState(JSON.parse(s)))
      } catch {
        return null
      }
    }),
    Effect.orElseSucceed(() => null),
  )

const writeState = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  repo: string,
  state: EngineState,
): Effect.Effect<void, never, never> =>
  fs
    .makeDirectory(path.join(repo, ".codenuke"), { recursive: true })
    .pipe(
      Effect.ignore,
      Effect.zipRight(fs.writeFileString(stateFile(path, repo), `${JSON.stringify(state, null, 2)}\n`)),
      Effect.ignore,
    )

/** Measure the region's CURRENT working-tree size (L) in a worktree. */
const measureRegionL = (worktree: string, region: string) =>
  Effect.gen(function* () {
    const git = yield* Git
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const rels = (
      yield* git.lsTree(worktree, "HEAD", region).pipe(Effect.orElseSucceed(() => [] as readonly string[]))
    ).filter(isSourceFile)
    const files = yield* Effect.forEach(rels, (rel) =>
      fs
        .readFileString(path.join(worktree, rel))
        .pipe(
          Effect.map((c) => [rel, c] as const),
          Effect.orElseSucceed(() => [rel, ""] as const),
        ),
    )
    return measureFiles(Object.fromEntries(files)).L
  })

export interface LifecycleOptions {
  readonly repo: string
  readonly region: string
}

/** RULE-044 `init` — create the managed worktree at HEAD + write fresh engine state. */
export const runInit = (opts: LifecycleOptions) =>
  Effect.gen(function* () {
    const git = yield* Git
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const worktree = managedWorktree(path, opts.repo)
    // start clean: drop any prior managed worktree
    yield* git.worktreeRemove(opts.repo, worktree).pipe(Effect.ignore)
    yield* fs.remove(worktree, { recursive: true }).pipe(Effect.ignore)

    const baselineSha = yield* git.resolveSha(opts.repo, "HEAD")
    yield* git.worktreeAdd(opts.repo, worktree, baselineSha)
    const startL = yield* measureRegionL(worktree, opts.region)
    const state: EngineState = { baselineSha, baselineTsc: 0, startL, accepted: [], iter: 0 }
    yield* writeState(fs, path, opts.repo, state)
    return { worktree, baselineSha, startL }
  })

/** RULE-044/035 `score` — judge the pending change in the managed worktree (or cwd if uninit). */
export const runScore = (opts: LifecycleOptions) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const state = yield* readState(fs, path, opts.repo)
    const target = state ? managedWorktree(path, opts.repo) : opts.repo
    return yield* scoreCurrentChange({ repo: target, region: opts.region })
  })

/** RULE-044 `accept` — commit the managed worktree change; advance state. */
export const runAccept = (opts: LifecycleOptions) =>
  Effect.gen(function* () {
    const git = yield* Git
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const state = yield* readState(fs, path, opts.repo)
    if (!state) return { ok: false as const, reason: "not initialized — run `codenuke init`" }
    const worktree = managedWorktree(path, opts.repo)
    const sha = yield* git.commitAll(worktree, `codenuke: accept #${state.iter + 1}`)
    yield* writeState(fs, path, opts.repo, {
      ...state,
      iter: state.iter + 1,
      accepted: [...state.accepted, sha],
    })
    return { ok: true as const, sha, iter: state.iter + 1 }
  })

/** RULE-044 `revert` — discard the managed worktree change. */
export const runRevert = (opts: LifecycleOptions) =>
  Effect.gen(function* () {
    const git = yield* Git
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const state = yield* readState(fs, path, opts.repo)
    if (!state) return { ok: false as const, reason: "not initialized — run `codenuke init`" }
    yield* git.discardAll(managedWorktree(path, opts.repo)).pipe(Effect.ignore)
    return { ok: true as const }
  })

/** RULE-044/062 `status` — cumulative reduction % from startL vs current. */
export const runStatus = (opts: LifecycleOptions) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const state = yield* readState(fs, path, opts.repo)
    if (!state) return { initialized: false as const }
    const currentL = yield* measureRegionL(managedWorktree(path, opts.repo), opts.region)
    // RULE-062 — cumulative reduction percentage.
    const reductionPct = state.startL > 0 ? ((state.startL - currentL) / state.startL) * 100 : 0
    return {
      initialized: true as const,
      iter: state.iter,
      accepted: state.accepted.length,
      startL: state.startL,
      currentL,
      reductionPct,
    }
  })

/** RULE-044 `cleanup` — remove the managed worktree + state. */
export const runCleanup = (opts: LifecycleOptions) =>
  Effect.gen(function* () {
    const git = yield* Git
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const worktree = managedWorktree(path, opts.repo)
    yield* git.worktreeRemove(opts.repo, worktree).pipe(Effect.ignore)
    yield* fs.remove(worktree, { recursive: true }).pipe(Effect.ignore)
    yield* fs.remove(stateFile(path, opts.repo)).pipe(Effect.ignore)
    return { ok: true as const }
  })
