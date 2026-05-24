/**
 * `score` — the Slice-0 walking skeleton. Proves the spine end-to-end:
 *   measure(HEAD) + measure(working tree) → assemble ScoreInputs → core `decide`
 *   → Verdict (rendered as NDJSON or a human line by the CLI).
 *
 * It scores the CURRENT working-tree change vs HEAD. Because gain/gates depend
 * only on the DELTA (before − after), measuring just the CHANGED source files is
 * exactly equivalent to measuring the whole region — unchanged files cancel — so
 * we read only what `git diff` reports.
 *
 * SLICE-0 STUBS (each becomes real in a later slice, flagged below): test pass
 * (Slice 2), type errors (Slice 2), fence usability/fidelities (Slice 1),
 * calibration scales (Slice 3). The scoring math, deltas, and gate G4 are REAL.
 */
import {
  decide,
  isSourceFile,
  measureFiles,
  type Measurement,
  type ScoreInputs,
  type Verdict,
  type Weights,
} from "@codenuke/core"
import { Effect } from "effect"
import { Git } from "../git/git.ts"

/** RULE-001/002 default weights (config calibration overrides land in Slice 3). */
export const SCORE_DEFAULT_WEIGHTS: Weights = {
  dL: 1.0,
  dCx: 1.8,
  dDup: 0.35,
  scaleL: 150,
  scaleCx: 15,
  scaleDup: 5,
  r3: 1.0,
}

/**
 * PURE — assemble the `decide` inputs from before/after measurements + diffsize.
 * The Slice-0 safety stubs live here, isolated and explicit, so later slices can
 * replace them one field at a time.
 */
export const assembleScoreInputs = (args: {
  readonly before: Measurement
  readonly after: Measurement
  readonly diffsize: number
  readonly weights?: Weights
}): ScoreInputs => ({
  before: args.before,
  after: args.after,
  // ── SLICE-0 STUBS ────────────────────────────────────────────────────────
  testsPass: true, // Slice 2 — run testCommand (RULE-018, G1)
  fenceUsable: true, // Slice 1 — fence artifact admissibility (RULE-019, G1′)
  blockedRegions: [], // Slice 1
  touchedFidelities: [], // Slice 1 — ⇒ mfence = 1 (no fence penalty yet)
  typeErrors: 0, // Slice 2 — typecheck (RULE-020/060, G3)
  baselineTypeErrors: 0,
  // ── REAL ─────────────────────────────────────────────────────────────────
  diffsize: args.diffsize, // RULE-061 (from git --shortstat)
  weights: args.weights ?? SCORE_DEFAULT_WEIGHTS,
  scales: null, // Slice 3 — calibration (RULE-010)
})

/**
 * Score the current working-tree change of `region` (default whole repo) vs HEAD.
 * Real measurement + real diffsize; Slice-0 safety stubs via assembleScoreInputs.
 */
export const scoreCurrentChange = (opts: {
  readonly repo: string
  readonly region?: string
}) =>
  Effect.gen(function* () {
    const git = yield* Git
    const region = opts.region ?? "."

    const changed = yield* git.diffNames(opts.repo, region)
    const sources = changed.filter(isSourceFile)

    const before: Record<string, string> = {}
    const after: Record<string, string> = {}
    for (const rel of sources) {
      before[rel] = yield* git.showAtRef(opts.repo, "HEAD", rel)
      after[rel] = yield* git.safeRead(opts.repo, rel).pipe(Effect.orElseSucceed(() => ""))
    }

    const shortStat = yield* git.diffShortStat(opts.repo, region)
    const diffsize = shortStat.insertions + shortStat.deletions

    return decide(
      assembleScoreInputs({
        before: measureFiles(before),
        after: measureFiles(after),
        diffsize,
      }),
    )
  })

/** Human-readable one-screen verdict summary (TTY path). */
export const renderScoreHuman = (v: Verdict): string => {
  const word = v.keep ? "KEEP" : v.admissible ? "REVERT (no gain)" : "REVERT (gate fail)"
  const lossStr = v.loss === null ? "null" : v.loss.toFixed(4)
  const failed = v.failedGates.length ? `  failedGates=[${v.failedGates.join(",")}]` : ""
  return [
    `verdict: ${word}`,
    `  gain=${v.gain.toFixed(4)}  risk=${v.risk.toFixed(4)}  loss=${lossStr}`,
    `  ΔL=${v.dL}  ΔCx=${v.dCx}  ΔDup=${v.dDup}  mfence=${v.mfence}`,
    `  gates: G1=${v.gates.G1} G1'=${v.gates.G1prime} G3=${v.gates.G3} G4=${v.gates.G4}${failed}`,
  ].join("\n")
}
