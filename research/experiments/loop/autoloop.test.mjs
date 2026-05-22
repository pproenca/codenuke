import { describe, expect, it } from "vitest";

import { loopConfig, raiseReadiness } from "./lib.mjs";

describe("autoloop readiness", () => {
  it("blocks legacy survivor artifacts instead of treating them as no-op raises", () => {
    const readiness = raiseReadiness({
      caught: 1,
      total: 3,
      p: 1 / 3,
      lo: 0.1,
      admissible: false,
      files: {
        "src/mappers/shared.ts": {
          caught: 1,
          total: 3,
          survivors: ["===→!==", "&&→||"],
        },
      },
    });

    expect(readiness).toEqual({
      kind: "legacy-survivors",
      survivorCount: 2,
    });
  });

  it("uses positional survivor specs for the fence-raising move", () => {
    const specs = [
      { rel: "src/cli/main.ts", start: 10, end: 13, repl: "!==", op: "===→!==" },
    ];

    expect(raiseReadiness({
      caught: 59,
      total: 60,
      p: 0.98,
      lo: 0.91,
      admissible: false,
      survivorSpecs: specs,
    })).toEqual({
      kind: "raise",
      specs,
    });
  });
});

describe("loopConfig", () => {
  it("derives repo, target, artifact, and state paths from the environment", () => {
    expect(loopConfig({
      CN_MAIN: "/tmp/repo-a",
      CN_WORKTREE: "/tmp/worktree-a",
      CN_TARGET: "src/provider/",
      CN_TAG: "provider-run",
      CN_FIDELITY: "/tmp/repo-a/artifact.json",
    })).toEqual({
      main: "/tmp/repo-a",
      worktree: "/tmp/worktree-a",
      state: "/tmp/cn-loop-provider-run-provider.state.json",
      target: "src/provider/",
      region: "provider",
      tag: "provider-run",
      branch: "autoresearch/provider-run",
      fidelity: "/tmp/repo-a/artifact.json",
      program: "/tmp/repo-a/experiments/loop/program.md",
      results: "/tmp/repo-a/experiments/loop/results.tsv",
      fidelityScript: "/tmp/repo-a/experiments/mutation/fidelity.mjs",
      promptFile: "/tmp/cn-proposer-provider-run-provider.prompt.txt",
    });
  });
});
