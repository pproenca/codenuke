/**
 * Fence audit engine (RULE-006/007/008/009) — the effectful orchestration over
 * the pure cores. It is deliberately **git-agnostic**: it consumes an injected
 * `MutationRunner` port (apply mutant → run test → restore) and per-region
 * worktree paths, so `@codenuke/fence` depends only on `@codenuke/core` +
 * `@effect/platform` — never on `@codenuke/runtime`. Worktree provisioning and
 * artifact persistence are the runtime/composition-root's job (no package cycle).
 *
 * ── Concurrency model (CRITICAL — REIMAGINED_ARCHITECTURE §7) ─────────────────
 * Parallelism = PER REGION (`Effect.forEach(..., { concurrency })`), each region
 * in its OWN worktree. WITHIN a region, mutants run SEQUENTIALLY (in-place
 * write → test → restore) — concurrent writers to one tree would corrupt source
 * and destroy determinism. NEVER per-mutant worktrees.
 *
 * ── Determinism (enforced by the property test) ──────────────────────────────
 * `runAudit` at concurrency 1 vs N yields a BYTE-IDENTICAL FenceArtifact:
 *   - regions are sorted by key, so `Effect.forEach` (which preserves input
 *     order) plus a sorted-key Record build give a stable object;
 *   - the per-region plan is seeded (RULE-008) over a fixed site order (files
 *     sorted by rel, sites ascending);
 *   - `generatedAt` is INJECTED by the caller (not read from a clock) so the
 *     timestamp can't make two runs differ.
 */
import type { FenceArtifact, PlannedMutation, RegionRecord } from "@codenuke/core";
import { wilson } from "@codenuke/core";
import { Context, Data, Effect, Layer } from "effect";
import { collectSites } from "./operators.ts";
import { recomputeReplay } from "./replay.ts";
import { samplePlanned } from "./sampling.ts";
import { classify, isCaught, type MutantStatus, tally } from "./survivor.ts";

/** A baseline source file in a region (repo-relative path + its text). */
export interface RegionFile {
  readonly rel: string;
  readonly content: string;
}

/** A region to audit: its key, the isolated worktree it owns, and its sources. */
export interface RegionInput {
  readonly key: string;
  readonly worktree: string;
  readonly files: readonly RegionFile[];
}

/** The whole-run audit request. */
export interface AuditInput {
  readonly regions: readonly RegionInput[];
  readonly baseline: string;
  /** 40-hex pinned commit. */
  readonly baselineSha: string;
  readonly cap: number;
  readonly seed: number;
  readonly threshold: number;
  /** Per-region parallelism (§7). Mutants within a region stay sequential. */
  readonly fenceConcurrency: number;
  /** Injected timestamp (determinism: the engine never reads a clock itself). */
  readonly generatedAt: string;
}

/** One region's audit request (for `auditRegion`). */
export interface AuditRegionRequest {
  readonly region: RegionInput;
  readonly cap: number;
  readonly seed: number;
  readonly threshold: number;
}

/**
 * MutationRunner port — applies one mutant to its worktree file, runs the test
 * command, restores the file, and reports the outcome. The fence engine treats it
 * as a black box; `makeMutationRunnerLive` (runner.ts) is the real impl and
 * `FakeMutationRunnerLive` (below) is the deterministic test double.
 */
export class MutationRunner extends Context.Tag("@codenuke/fence/MutationRunner")<
  MutationRunner,
  {
    readonly run: (input: {
      readonly worktree: string;
      readonly mutation: PlannedMutation;
    }) => Effect.Effect<MutantStatus>;
  }
>() {}

export class ReplayPreconditionFailed extends Data.TaggedError("ReplayPreconditionFailed")<{
  readonly reason: "baseline-red" | "source-changed";
  readonly rel?: string;
}> {}

/** Build a region's deterministic plan: files sorted by rel, sites ascending, then seeded-sampled. */
const planRegion = (region: RegionInput, cap: number, seed: number): PlannedMutation[] => {
  const files = [...region.files].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const planned: PlannedMutation[] = [];
  for (const f of files) {
    for (const s of collectSites(f.content)) planned.push({ ...s, rel: f.rel });
  }
  return samplePlanned(planned, cap, seed);
};

/** Pure: assemble a RegionRecord from a plan + its outcomes (RULE-006/009). */
const recordFromOutcomes = (
  plan: readonly PlannedMutation[],
  outcomes: readonly MutantStatus[],
  threshold: number,
): RegionRecord => {
  const { caught, total } = tally(outcomes);
  const { p, lo, hi } = wilson(caught, total);
  // survivorSpecs: the planned mutants whose outcome classified as SURVIVED.
  const survivorSpecs = plan.filter((_, i) => classify(outcomes[i]));
  return { caught, total, p, lo, hi, admissible: lo >= threshold, survivorSpecs };
};

/**
 * The Fence service.
 *  - `auditRegion`  collect → seeded sample → mutate-in-place SEQUENTIALLY → Wilson.
 *  - `runAudit`     regions in parallel (`concurrency`), assembles the artifact.
 *  - `replayRegion` RULE-043/051 — effectful replay (Slice-1 follow-up; the pure
 *                   monotonic recompute lives in replay.ts and is tested).
 */
export class Fence extends Context.Tag("@codenuke/fence/Fence")<
  Fence,
  {
    readonly auditRegion: (req: AuditRegionRequest) => Effect.Effect<RegionRecord>;
    readonly runAudit: (input: AuditInput) => Effect.Effect<FenceArtifact>;
    readonly replayRegion: (req: {
      readonly region: string;
      readonly worktree: string;
      readonly threshold: number;
      readonly previous: RegionRecord;
      readonly baselineGreen: boolean;
      readonly baselineFiles: Readonly<Record<string, string>>;
      readonly currentFiles: Readonly<Record<string, string>>;
    }) => Effect.Effect<RegionRecord, ReplayPreconditionFailed>;
  }
>() {}

export const FenceLive: Layer.Layer<Fence, never, MutationRunner> = Layer.effect(
  Fence,
  Effect.gen(function* () {
    const runner = yield* MutationRunner;

    const auditRegion = (req: AuditRegionRequest): Effect.Effect<RegionRecord> =>
      Effect.gen(function* () {
        const plan = planRegion(req.region, req.cap, req.seed);
        // Mutants SEQUENTIAL within a region (one in-place tree) — §7.
        const outcomes: MutantStatus[] = [];
        for (const mutation of plan) {
          outcomes.push(yield* runner.run({ worktree: req.region.worktree, mutation }));
        }
        return recordFromOutcomes(plan, outcomes, req.threshold);
      });

    const runAudit = (input: AuditInput): Effect.Effect<FenceArtifact> =>
      Effect.gen(function* () {
        const regions = [...input.regions].sort((a, b) =>
          a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
        );
        const records = yield* Effect.forEach(
          regions,
          (region) =>
            auditRegion({ region, cap: input.cap, seed: input.seed, threshold: input.threshold }),
          { concurrency: input.fenceConcurrency }, // PER REGION ONLY
        );
        // Build the regions Record in sorted-key order → byte-stable JSON.
        const regionRecords: Record<string, RegionRecord> = {};
        regions.forEach((r, i) => {
          regionRecords[r.key] = records[i]!;
        });
        return {
          schemaVersion: 1 as const,
          baseline: input.baseline,
          baselineSha: input.baselineSha,
          generatedAt: input.generatedAt,
          method: "ast-aware" as const,
          threshold: input.threshold,
          capPerRegion: input.cap,
          seed: input.seed,
          regions: regionRecords,
        };
      });

    return Fence.of({
      auditRegion,
      runAudit,
      replayRegion: (req) =>
        Effect.gen(function* () {
          if (!req.baselineGreen) {
            return yield* Effect.fail(new ReplayPreconditionFailed({ reason: "baseline-red" }));
          }
          const outcomes: MutantStatus[] = [];
          for (const mutation of req.previous.survivorSpecs) {
            const before = req.baselineFiles[mutation.rel];
            const now = req.currentFiles[mutation.rel];
            if (before === undefined || now === undefined) {
              outcomes.push("green");
              continue;
            }
            if (before !== now) {
              return yield* Effect.fail(new ReplayPreconditionFailed({ reason: "source-changed", rel: mutation.rel }));
            }
            outcomes.push(yield* runner.run({ worktree: req.worktree, mutation }));
          }
          const killed = outcomes.filter(isCaught).length;
          const replayed = recomputeReplay(req.previous.caught, req.previous.total, killed, req.previous.lo);
          const survivorSpecs = req.previous.survivorSpecs.filter((_, i) => !isCaught(outcomes[i]));
          return {
            caught: replayed.caught,
            total: replayed.total,
            p: replayed.interval.p,
            lo: replayed.interval.lo,
            hi: replayed.interval.hi,
            admissible: replayed.interval.lo >= req.threshold,
            survivorSpecs,
          };
        }),
    });
  }),
);

// ---------------------------------------------------------------------------
// Fake deterministic runner — for the determinism property test (no IO).
// ---------------------------------------------------------------------------

const hashMutation = (m: PlannedMutation): number => {
  const s = `${m.rel}:${m.start}:${m.end}:${m.op}:${m.repl}`;
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
};

/** Deterministic fake outcome: ~1 in 4 mutants survives (green); the rest are caught. */
export const fakeStatus = (m: PlannedMutation): MutantStatus =>
  hashMutation(m) % 4 === 0 ? "green" : "fail";

export const FakeMutationRunnerLive: Layer.Layer<MutationRunner> = Layer.succeed(
  MutationRunner,
  MutationRunner.of({ run: ({ mutation }) => Effect.succeed(fakeStatus(mutation)) }),
);
