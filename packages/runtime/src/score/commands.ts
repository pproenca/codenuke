import { Command, CommandExecutor } from "@effect/platform"
import { allowlistEnv, countTypeErrors, type CommandSpec } from "@codenuke/core"
import { Chunk, Effect, Stream } from "effect"

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
