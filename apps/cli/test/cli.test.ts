import { describe, expect, it } from "@effect/vitest"
import {
  EXIT_ARTIFACT_MISSING,
  EXIT_CONFIG_INVALID,
  EXIT_GATE_FAILED,
  EXIT_GENERIC,
  EXIT_GIT,
  EXIT_NOT_READY,
  EXIT_PROPOSER,
  EXIT_STATE,
  exitCodeFor,
} from "../src/exit-codes.ts"

describe("cli — tag → POSIX exit-code mapping (pure)", () => {
  it("RULE-032 ConfigInvalid / ShellStringRejected → 3", () => {
    expect(exitCodeFor({ _tag: "ConfigInvalid" })).toBe(EXIT_CONFIG_INVALID)
    expect(exitCodeFor({ _tag: "ShellStringRejected" })).toBe(EXIT_CONFIG_INVALID)
  })

  it("RULE-032 GateFailed → 4", () => {
    expect(exitCodeFor({ _tag: "GateFailed" })).toBe(EXIT_GATE_FAILED)
  })

  it("RULE-032 Artifact* tags get distinct codes", () => {
    expect(exitCodeFor({ _tag: "ArtifactMissing" })).toBe(EXIT_ARTIFACT_MISSING)
    expect(exitCodeFor({ _tag: "ArtifactStale" })).toBe(6)
    expect(exitCodeFor({ _tag: "ArtifactTampered" })).toBe(7)
    expect(exitCodeFor({ _tag: "ArtifactInvalid" })).toBe(7)
  })

  it("RULE-053 StateStale / StateInvalid → 8", () => {
    expect(exitCodeFor({ _tag: "StateStale" })).toBe(EXIT_STATE)
    expect(exitCodeFor({ _tag: "StateInvalid" })).toBe(EXIT_STATE)
  })

  it("RULE-047 Proposer* tags → 9", () => {
    expect(exitCodeFor({ _tag: "ProposerTimeout" })).toBe(EXIT_PROPOSER)
    expect(exitCodeFor({ _tag: "ProposerFailed" })).toBe(EXIT_PROPOSER)
  })

  it("RULE-052 GitFailed / PathEscape → 10", () => {
    expect(exitCodeFor({ _tag: "GitFailed" })).toBe(EXIT_GIT)
    expect(exitCodeFor({ _tag: "PathEscape" })).toBe(EXIT_GIT)
  })

  it("RULE-032 doctor 'not ready' (NotReady) → 2", () => {
    expect(exitCodeFor({ _tag: "NotReady" })).toBe(EXIT_NOT_READY)
  })

  it("RULE-032 an unrecognized or non-tagged error → generic 1", () => {
    expect(exitCodeFor({ _tag: "Whatever" })).toBe(EXIT_GENERIC)
    expect(exitCodeFor(new Error("boom"))).toBe(EXIT_GENERIC)
    expect(exitCodeFor(null)).toBe(EXIT_GENERIC)
    expect(exitCodeFor("string error")).toBe(EXIT_GENERIC)
  })
})

describe("cli — command dispatch by name (stubbed for wave 2)", () => {
  it.skip("RULE-039 `run` (alias `loop`) dispatches to the autoloop with iterations arg", () => {})
  it.skip("RULE-035 `score --json` emits clean NDJSON on stdout (no @@JSON@@ sentinel)", () => {})
  it.skip("`fence [cap] [seed] [regions]` dispatches to the fence audit", () => {})
  it.skip("RULE-011 `changecost [ref]` dispatches to the changecost ground-truth run", () => {})
  it.skip("RULE-010 `calibrate` dispatches to the calibration run", () => {})
  it.skip("RULE-024 `validate-proxy [input]` dispatches to value-proxy validation", () => {})
  it.skip("RULE-044 `init` / `accept` / `revert` / `status` / `cleanup` dispatch to the scorer lifecycle", () => {})
  it.todo("RULE-032 `doctor` exits 0 when ready and 2 when not ready (real path lands wave 2)")
})
