/**
 * MutationRunnerLive — the REAL mutation runner (RULE-007 audit step).
 *
 * For one planned mutant it: reads the worktree file, applies the operator flip
 * by byte offset, runs the test command in that worktree, then RESTORES the file
 * (guaranteed via `ensuring`). Outcome:
 *   - test exit 0 ⇒ tests still passed ⇒ mutant SURVIVED ("green")
 *   - test exit ≠ 0 ⇒ caught ("fail")
 *   - any IO/spawn error ⇒ treated as SURVIVED ("green") — fail-toward-risk, so a
 *     broken test command lowers fidelity (fence blocks) rather than reading clean.
 *
 * It is parameterized by the resolved test `CommandSpec` and runs argv-only
 * (`Command.make`, no shell — the trust boundary) with the shared env allowlist.
 * Built as a `Layer` requiring CommandExecutor + FileSystem + Path (NodeContext).
 */
import { Command, CommandExecutor, FileSystem, Path } from "@effect/platform";
import { allowlistEnv, type CommandSpec, type PlannedMutation } from "@codenuke/core";
import { Effect, Layer } from "effect";
import { MutationRunner } from "./audit.ts";
import type { MutantStatus } from "./survivor.ts";

export const makeMutationRunnerLive = (
  testCommand: CommandSpec,
): Layer.Layer<
  MutationRunner,
  never,
  CommandExecutor.CommandExecutor | FileSystem.FileSystem | Path.Path
> =>
  Layer.effect(
    MutationRunner,
    Effect.gen(function* () {
      const executor = yield* CommandExecutor.CommandExecutor;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const env = allowlistEnv(process.env, testCommand.env ?? {});

      const run = (input: {
        readonly worktree: string;
        readonly mutation: PlannedMutation;
      }): Effect.Effect<MutantStatus> =>
        Effect.gen(function* () {
          const file = path.join(input.worktree, input.mutation.rel);
          const original = yield* fs.readFileString(file);
          const { start, end, repl } = input.mutation;
          const mutated = original.slice(0, start) + repl + original.slice(end);

          // apply → test → restore (restore runs even on interrupt/failure)
          return yield* Effect.gen(function* () {
            yield* fs.writeFileString(file, mutated);
            const cmd = Command.make(testCommand.file, ...(testCommand.args ?? [])).pipe(
              Command.workingDirectory(input.worktree),
              Command.env(env),
            );
            const code = yield* Command.exitCode(cmd).pipe(
              Effect.provideService(CommandExecutor.CommandExecutor, executor),
            );
            return (code === 0 ? "green" : "fail") as MutantStatus;
          }).pipe(Effect.ensuring(fs.writeFileString(file, original).pipe(Effect.ignore)));
        }).pipe(
          // fail-toward-risk: any error ⇒ treat the mutant as a survivor.
          Effect.catchAll(() => Effect.succeed("green" as MutantStatus)),
        );

      return MutationRunner.of({ run });
    }),
  );
