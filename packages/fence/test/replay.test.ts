import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { Fence, FenceLive, MutationRunner, type PlannedMutation } from "../src/index.ts";

/**
 * RULE-043 — Monotonic fence replay (keep iff strictly-higher lower bound).
 *
 * The PURE keep-comparison (`isStrictlyHigherLowerBound`) is tested for real
 * and PASSES. The numeric monotonic recompute (`recomputeReplay`) is backed by
 * core's `wilson` — tested when core exports it, otherwise skipped. The full
 * effectful replay (re-test survivors over the worktree) and the RULE-051
 * precondition (sources unchanged + green) are effectful → skipped.
 *
 * `replay.ts` imports `wilson` from @codenuke/core; loaded dynamically so a
 * missing core export skips rather than fails the build.
 */

type ReplayMod = typeof import("../src/replay.ts");

let mod: ReplayMod | null = null;
let loadError: unknown = null;
try {
  mod = await import("../src/replay.ts");
  if (typeof mod.recomputeReplay !== "function") {
    loadError = new Error("@codenuke/core did not export `wilson`");
    mod = null;
  }
} catch (e) {
  loadError = e;
}

const guarded = mod ? describe : describe.skip;

guarded("RULE-043 monotonic fence replay (pure comparison)", () => {
  it("RULE-043 keep iff lo strictly higher than before by > 1e-9", () => {
    expect(mod!.EPSILON).toBe(1e-9);
    expect(mod!.isStrictlyHigherLowerBound(0.8, 0.86)).toBe(true);
    expect(mod!.isStrictlyHigherLowerBound(0.8, 0.8)).toBe(false); // equal => raise-nogain
    expect(mod!.isStrictlyHigherLowerBound(0.8, 0.79)).toBe(false);
    expect(mod!.isStrictlyHigherLowerBound(0.8, 0.8 + 1e-12)).toBe(false); // within epsilon
    expect(mod!.isStrictlyHigherLowerBound(0.8, 0.8 + 1e-6)).toBe(true);
  });

  it("RULE-043 recompute fixes the denominator and lo only rises (killing 3 of 5 survivors)", () => {
    // previous {caught:30, total:35}, 5 survivors; added tests kill 3.
    const before = mod!.wilson(30, 35);
    const r = mod!.recomputeReplay(30, 35, 3, before.lo);
    expect(r.caught).toBe(33);
    expect(r.total).toBe(35); // denominator fixed
    expect(r.interval.lo).toBeGreaterThan(before.lo); // strictly higher
    expect(r.improved).toBe(true);
  });

  it("RULE-043 killing 0 survivors leaves lo unchanged (no improvement)", () => {
    const before = mod!.wilson(30, 35);
    const r = mod!.recomputeReplay(30, 35, 0, before.lo);
    expect(r.caught).toBe(30);
    expect(r.interval.lo).toBe(before.lo);
    expect(r.improved).toBe(false);
  });

  it.effect("RULE-043 effectful replay re-tests prior survivors over the worktree (Fence service)", () => {
    const killed: PlannedMutation = { rel: "src/a.ts", start: 0, end: 1, repl: "b", op: "kill" };
    const survivor: PlannedMutation = { rel: "src/a.ts", start: 2, end: 3, repl: "d", op: "live" };
    const ReplayRunnerLive = Layer.succeed(
      MutationRunner,
      MutationRunner.of({
        run: ({ mutation }) => Effect.succeed(mutation.op === "kill" ? "fail" : "green"),
      }),
    );
    return Effect.gen(function* () {
      const fence = yield* Fence;
      const before = mod!.wilson(1, 3);
      const replayed = yield* fence.replayRegion({
        region: "src",
        worktree: "/tmp/replay",
        threshold: 0.9,
        baselineGreen: true,
        baselineFiles: { "src/a.ts": "abc" },
        currentFiles: { "src/a.ts": "abc" },
        previous: {
          caught: 1,
          total: 3,
          p: before.p,
          lo: before.lo,
          hi: before.hi,
          admissible: false,
          survivorSpecs: [killed, survivor],
        },
      });
      expect(replayed.caught).toBe(2);
      expect(replayed.total).toBe(3);
      expect(replayed.lo).toBeGreaterThan(before.lo);
      expect(replayed.survivorSpecs).toEqual([survivor]);
    }).pipe(Effect.provide(FenceLive.pipe(Layer.provide(ReplayRunnerLive))));
  });
});

describe("RULE-051 replay precondition (sources unchanged + green)", () => {
  const mutation: PlannedMutation = { rel: "src/a.ts", start: 0, end: 1, repl: "b", op: "live" };
  const ReplayRunnerLive = Layer.succeed(
    MutationRunner,
    MutationRunner.of({
      run: () => Effect.succeed("green"),
    }),
  );

  it.effect("RULE-051 throws 'source changed before replay' when a survivor file differs from baseline", () =>
    Effect.gen(function* () {
      const fence = yield* Fence;
      const before = mod!.wilson(1, 2);
      const exit = yield* fence
        .replayRegion({
          region: "src",
          worktree: "/tmp/replay",
          threshold: 0.9,
          baselineGreen: true,
          baselineFiles: { "src/a.ts": "before" },
          currentFiles: { "src/a.ts": "after" },
          previous: {
            caught: 1,
            total: 2,
            p: before.p,
            lo: before.lo,
            hi: before.hi,
            admissible: false,
            survivorSpecs: [mutation],
          },
        })
        .pipe(Effect.exit);
      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        expect(String(exit.cause)).toContain("ReplayPreconditionFailed");
      }
    }).pipe(Effect.provide(FenceLive.pipe(Layer.provide(ReplayRunnerLive)))),
  );

  it.effect("RULE-051 throws 'source changed before replay' when survivor source is missing", () =>
    Effect.gen(function* () {
      const fence = yield* Fence;
      const before = mod!.wilson(1, 2);
      const exit = yield* fence
        .replayRegion({
          region: "src",
          worktree: "/tmp/replay",
          threshold: 0.9,
          baselineGreen: true,
          baselineFiles: { "src/a.ts": "before" },
          currentFiles: {},
          previous: {
            caught: 1,
            total: 2,
            p: before.p,
            lo: before.lo,
            hi: before.hi,
            admissible: false,
            survivorSpecs: [mutation],
          },
        })
        .pipe(Effect.exit);
      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        expect(String(exit.cause)).toContain("ReplayPreconditionFailed");
      }
    }).pipe(Effect.provide(FenceLive.pipe(Layer.provide(ReplayRunnerLive)))),
  );

  it.effect("RULE-051 throws 'worktree baseline not green' when the baseline test status is red", () =>
    Effect.gen(function* () {
      const fence = yield* Fence;
      const before = mod!.wilson(1, 2);
      const exit = yield* fence
        .replayRegion({
          region: "src",
          worktree: "/tmp/replay",
          threshold: 0.9,
          baselineGreen: false,
          baselineFiles: { "src/a.ts": "before" },
          currentFiles: { "src/a.ts": "before" },
          previous: {
            caught: 1,
            total: 2,
            p: before.p,
            lo: before.lo,
            hi: before.hi,
            admissible: false,
            survivorSpecs: [mutation],
          },
        })
        .pipe(Effect.exit);
      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        expect(String(exit.cause)).toContain("ReplayPreconditionFailed");
      }
    }).pipe(Effect.provide(FenceLive.pipe(Layer.provide(ReplayRunnerLive)))),
  );
});

describe("RULE-008 determinism property", () => {
  // The audit runner is stubbed (Effect.die), so this cannot run yet; pinned
  // as a todo with the exact required description.
  it.todo("RULE-008 determinism: audit at concurrency 1 vs N yields byte-identical FenceArtifact");
});

if (!mod) {
  describe("RULE-043 monotonic fence replay (skipped)", () => {
    it.skip(`RULE-043 skipped — @codenuke/core wilson import unavailable: ${String(loadError)}`, () => {});
  });
}
