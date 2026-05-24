// Characterization tests for the orchestration-layer observable behavior in:
// - legacy loop/autoloop.mjs
// - legacy loop/doctor.mjs
// - legacy bin/codenuke.mjs
//
// The runtime adapter should satisfy these through pure helpers around the side
// effects, so these tests do not spawn git, codex, or shell commands.
import { describe, expect, it } from "vitest";

import {
  chooseRegion,
  cliHelpText,
  commandTarget,
  formatDoctorReport,
  formatResultRow,
  formatResultsHeader,
  inScopeRegions,
  isAllowedRaisePath,
  isAllowedReducePath,
  isReady,
  proposerFailure,
  raisePrompt,
  readinessGaps,
  reducePrompt,
  runStartupFailure,
  selectMode,
  shouldRequireValueProxyValidation,
} from "@codenuke/orchestrator";

describe("chooseRegion / selectMode (RULE-039)", () => {
  const fence = {
    regions: {
      alpha: { admissible: true, lo: 0.95 },
      beta: { admissible: false, lo: 0.7 },
      gamma: { admissible: false, lo: 0.85 },
    },
  };

  it("prefers the blocked region closest to clearing the bar (highest lo)", () => {
    expect(chooseRegion(fence, ["alpha", "beta", "gamma"], "alpha")).toBe("gamma"); // 0.85 > 0.7
  });

  it("falls back to an admissible region when none are blocked", () => {
    const allClear = { regions: { a: { admissible: true, lo: 0.99 }, b: { admissible: true, lo: 0.95 } } };
    expect(chooseRegion(allClear, ["a", "b"], "a")).toBe("a");
  });

  it("falls back to the default region when there are no candidates", () => {
    expect(chooseRegion({ regions: {} }, [], "src")).toBe("src");
  });

  it("selects reduce for an admissible region, raise otherwise", () => {
    expect(selectMode({ admissible: true })).toBe("reduce");
    expect(selectMode({ admissible: false })).toBe("raise");
    expect(selectMode(undefined)).toBe("raise");
  });

  it("filters to a requested target region before falling back to artifact keys", () => {
    const fenced = {
      regions: {
        api: { admissible: false, lo: 0.75 },
        cli: { admissible: false, lo: 0.88 },
      },
    };

    expect(inScopeRegions(fenced, ["api", "cli"], "src/api", "src")).toEqual(["api"]);
    expect(inScopeRegions(fenced, ["web"], "src/api", "src")).toEqual([]);
    expect(inScopeRegions(fenced, ["api", "cli"], "src", "src")).toEqual(["api", "cli"]);
  });

  it("filters to the literal target child when srcDir contains regex metacharacters", () => {
    const fenced = {
      regions: {
        api: { admissible: false, lo: 0.75 },
        cli: { admissible: false, lo: 0.88 },
      },
    };

    expect(inScopeRegions(fenced, ["api", "cli"], "src+/api", "src+")).toEqual(["api"]);
  });
});

describe("readinessGaps / isReady (RULE-032)", () => {
  const ok = {
    baseline: "HEAD",
    baselineExists: true,
    baselineGreen: true,
    typecheckOk: true,
    hasRegions: true,
    fence: { present: true, stale: false, usable: true },
    calibration: { present: true, stale: false, usable: true },
    proposerAvailable: true,
  };

  it("reports no gaps and ready when everything checks out", () => {
    const gaps = readinessGaps(ok);
    expect(gaps).toEqual([]);
    expect(isReady(gaps)).toBe(true);
  });

  it("reports each gap in legacy order", () => {
    const gaps = readinessGaps({
      ...ok,
      baselineGreen: false,
      hasRegions: false,
      fence: { present: true, stale: true, usable: false },
      calibration: { present: false, stale: false, usable: false },
      proposerAvailable: false,
    });
    expect(gaps).toEqual([
      "baseline test command is not green",
      "no source regions detected",
      "fence artifact stale",
      "calibration missing",
      "proposer unavailable",
    ]);
    expect(isReady(gaps)).toBe(false);
  });

  it("distinguishes missing / stale / invalid for the fence", () => {
    expect(readinessGaps({ ...ok, fence: { present: false, stale: false, usable: false } })).toContain("fence artifact missing");
    expect(readinessGaps({ ...ok, fence: { present: true, stale: false, usable: false } })).toContain("fence artifact invalid");
  });

  it("formats the doctor report and not-ready gaps exactly like the legacy command", () => {
    expect(
      formatDoctorReport({
        repo: "/repo",
        baseline: "main",
        srcDir: "src",
        regions: ["api", "cli"],
        testCommand: "pnpm test",
        typeCheckCommand: "pnpm typecheck",
        checks: {
          ...ok,
          baseline: "main",
          baselineGreen: false,
          typecheckOk: false,
          fence: { present: true, stale: true, usable: false },
          calibration: { present: false, stale: false, usable: false },
          proposerAvailable: false,
        },
        fenceArtifact: "/repo/.codenuke/fence.json",
        calibrationArtifact: "/repo/.codenuke/calibration.json",
      }),
    ).toEqual([
      "doctor",
      "repo: /repo",
      "baseline: not-ready (main)",
      "srcDir: src",
      "regions: api,cli",
      "test: not-ready (pnpm test)",
      "typecheck: not-ready (pnpm typecheck)",
      "fence: stale (/repo/.codenuke/fence.json)",
      "calibration: missing (/repo/.codenuke/calibration.json)",
      "proposer: missing",
      "not ready:",
      "- baseline test command is not green",
      "- typecheck command is not green",
      "- fence artifact stale",
      "- calibration missing",
      "- proposer unavailable",
    ]);
  });

  it("prints skipped typecheck and empty-region gaps when no typecheck command is configured", () => {
    expect(
      formatDoctorReport({
        repo: "/repo",
        baseline: "HEAD",
        srcDir: ".",
        regions: [],
        testCommand: "npm test",
        typeCheckCommand: undefined,
        checks: { ...ok, hasRegions: false },
        fenceArtifact: "/repo/.codenuke/fence.json",
        calibrationArtifact: "/repo/.codenuke/calibration.json",
      }),
    ).toEqual([
      "doctor",
      "repo: /repo",
      "baseline: green (HEAD)",
      "srcDir: .",
      "regions: none",
      "test: green (npm test)",
      "typecheck: skipped",
      "fence: present (/repo/.codenuke/fence.json)",
      "calibration: present (/repo/.codenuke/calibration.json)",
      "proposer: available",
      "not ready:",
      "- no source regions detected",
    ]);
  });
});

describe("commandTarget — bin dispatch", () => {
  it("routes engine commands to their modules", () => {
    expect(commandTarget("fence")).toEqual({ module: "fence", passCommand: false });
    expect(commandTarget("run")).toEqual({ module: "autoloop", passCommand: false });
    expect(commandTarget("loop")).toEqual({ module: "autoloop", passCommand: false });
    expect(commandTarget("validate-proxy")).toEqual({ module: "value-proxy", passCommand: false });
  });
  it("routes scorer verbs to scorer with the command passed through", () => {
    for (const c of ["init", "score", "accept", "revert", "status", "cleanup"]) {
      expect(commandTarget(c)).toEqual({ module: "scorer", passCommand: true });
    }
  });
  it("returns null for an unknown command", () => {
    expect(commandTarget("frobnicate")).toBeNull();
  });

  it("keeps --version/-v as local metadata commands and leaves no-arg help local", () => {
    expect(commandTarget("--version")).toEqual({ module: "package-version", passCommand: false });
    expect(commandTarget("-v")).toEqual({ module: "package-version", passCommand: false });
    expect(commandTarget(undefined)).toEqual({ module: "help", passCommand: false });
  });

  it("renders the legacy help text with usage, config, and first-run fence guidance", () => {
    const help = cliHelpText();
    expect(help).toContain("codenuke loop — autonomous behavior-preserving code reduction");
    expect(help).toContain("usage (run from your repo root):");
    expect(help).toContain("codenuke fence [cap=60] [seed=1337]   measure each region's behavior-fence fidelity");
    expect(help).toContain("codenuke run [iterations=5]           run the loop (propose → score → keep/revert)");
    expect(help).toContain("codenuke doctor                       report readiness or precise gaps");
    expect(help).toContain("config: codenuke.loop.json at the repo root, or CN_* env.");
    expect(help).toContain("First run 'fence' so the");
    expect(help).toContain("loop has a measured fence to gate on.");
  });
});

describe("run startup gates (RULE-030, RULE-031)", () => {
  const okArtifacts = {
    fence: { present: true, stale: false, usable: true },
    calibration: { present: true, stale: false, usable: true },
    valueProxy: { present: true, stale: false, usable: true },
    inScopeRegionCount: 1,
    baseline: "HEAD",
    repo: "/repo",
    fenceArtifact: "/repo/.codenuke/fence.json",
    target: "src",
  };

  it("requires value-proxy validation only for long unattended runs", () => {
    expect(shouldRequireValueProxyValidation(5)).toBe(false);
    expect(shouldRequireValueProxyValidation(6)).toBe(true);
  });

  it("fails closed before iterations when the fence is missing, stale, invalid, or empty", () => {
    expect(
      runStartupFailure({
        ...okArtifacts,
        fence: { present: false, stale: false, usable: false },
      }),
    ).toEqual({
      exitCode: 1,
      message:
        "fence artifact missing or invalid at /repo/.codenuke/fence.json; run `codenuke fence` first, then `codenuke doctor`.",
    });

    expect(
      runStartupFailure({
        ...okArtifacts,
        fence: { present: true, stale: true, usable: false },
      }),
    ).toEqual({
      exitCode: 1,
      message:
        "fence artifact is stale for baseline HEAD; run `codenuke fence` first, then `codenuke doctor`.",
    });

    expect(
      runStartupFailure({
        ...okArtifacts,
        fence: { present: true, stale: false, usable: false },
      }),
    ).toEqual({
      exitCode: 1,
      message:
        "fence artifact is invalid for baseline HEAD; run `codenuke fence` first, then `codenuke doctor`.",
    });

    expect(runStartupFailure({ ...okArtifacts, inScopeRegionCount: 0 })).toEqual({
      exitCode: 1,
      message:
        "fence artifact has no measured in-scope regions for target src; run `codenuke fence` for the detected regions, then `codenuke doctor`.",
    });
  });

  it("checks calibration after the fence and before long-run proxy validation", () => {
    expect(
      runStartupFailure({
        ...okArtifacts,
        iterations: 6,
        calibration: { present: false, stale: false, usable: false },
        valueProxy: { present: false, stale: false, usable: false },
      }),
    ).toEqual({
      exitCode: 1,
      message:
        "calibration artifact missing at /repo/.codenuke/calibration.json; run `codenuke calibrate` first, then `codenuke doctor`.",
    });
  });

  it("requires passing value-proxy validation before runs longer than five iterations", () => {
    expect(
      runStartupFailure({
        ...okArtifacts,
        iterations: 6,
        valueProxy: { present: false, stale: false, usable: false },
      }),
    ).toEqual({
      exitCode: 1,
      message:
        "value proxy validation missing at /repo/.codenuke/value-proxy-validation.json; run `codenuke changecost` and `codenuke validate-proxy` before long unattended runs.",
    });

    expect(
      runStartupFailure({
        ...okArtifacts,
        iterations: 6,
        valueProxy: { present: true, stale: false, usable: false },
      }),
    ).toEqual({
      exitCode: 1,
      message:
        "value proxy validation is not passing; run `codenuke changecost` and `codenuke validate-proxy` before long unattended runs.",
    });
  });
});

describe("path-surface enforcement (RULE-025, RULE-026)", () => {
  it("allows reduce edits only to source files under the configured source dir", () => {
    expect(isAllowedReducePath("src/api/index.ts", "src")).toBe(true);
    expect(isAllowedReducePath("src/api/component.tsx", "src")).toBe(true);
    expect(isAllowedReducePath("src/api/index.test.ts", "src")).toBe(false);
    expect(isAllowedReducePath("src/api/types.d.ts", "src")).toBe(false);
    expect(isAllowedReducePath("tests/api/index.test.ts", "src")).toBe(false);
    expect(isAllowedReducePath("node_modules/.bin/tool", "src")).toBe(false);
  });

  it("rejects common tooling paths when the configured source dir is the repo root", () => {
    expect(isAllowedReducePath("packages/app/src/index.ts", ".")).toBe(true);
    expect(isAllowedReducePath("vitest.config.ts", ".")).toBe(false);
    expect(isAllowedReducePath("scripts/release.ts", ".")).toBe(false);
    expect(isAllowedReducePath("docs/example.ts", ".")).toBe(false);
  });

  it("allows raise edits only to .test/.spec files under detected test roots", () => {
    const roots = ["test", "src"];
    expect(isAllowedRaisePath("test/api.behavior.test.ts", roots)).toBe(true);
    expect(isAllowedRaisePath("src/api/component.spec.tsx", roots)).toBe(true);
    expect(isAllowedRaisePath("src/api/component.ts", roots)).toBe(false);
    expect(isAllowedRaisePath("src/api/component.accept.ts", roots)).toBe(false);
    expect(isAllowedRaisePath("bench/api.test.ts", roots)).toBe(false);
  });

  it("treats a dot test root as allowing tests anywhere in the repo", () => {
    expect(isAllowedRaisePath("packages/a/src/foo.test.ts", ["."])).toBe(true);
    expect(isAllowedRaisePath("packages/a/src/foo.ts", ["."])).toBe(false);
  });
});

describe("prompts and proposer failures (RULE-042, RULE-046, RULE-047)", () => {
  it("builds the reduce prompt with the program preface and exact one-file instruction", () => {
    expect(reducePrompt("src/api/", "Refactor safely.")).toBe(
      "Refactor safely.\n\n---\nYou are running now. Target region: src/api/. Make exactly ONE behavior-preserving reduction in a single file under src/api/, then stop. Do not run commands; just edit.",
    );
  });

  it("builds the raise prompt from survivor specs and discovered test layout", () => {
    expect(
      raisePrompt("src/api/", "tests/**/*.test.ts", [
        { rel: "src/api/rules.ts", line: 12, op: "==" },
        { rel: "src/api/rules.ts", line: 48, op: "&&" },
      ]),
    ).toBe(
      "You are the fence-raising proposer. The region src/api/ is fence-BLOCKED: its tests miss some behavior changes (mutation survivors). ADD characterization tests where this repo's test command will discover them: tests/**/*.test.ts. Do NOT change any source — only add/extend tests.\n\nSurviving mutations:\n  - src/api/rules.ts line 12: operator `==` is undetected by any test\n  - src/api/rules.ts line 48: operator `&&` is undetected by any test\n\nRead the source, understand what each operator decides, and assert the real current outputs for inputs exercising both sides. Make the tests pass against current code. Then stop. Do not run commands; just write tests.",
    );
  });

  it("classifies proposer timeout, budget exhaustion, and generic crashes for the journal", () => {
    expect(proposerFailure({ timedOut: true, out: "", timeoutMs: 900000 })).toEqual({
      status: "crash-timeout",
      description: "proposer timeout after 900000ms",
    });
    expect(proposerFailure({ timedOut: false, out: "info\nReached maximum budget\n", timeoutMs: 900000 })).toEqual({
      status: "crash-budget",
      description: "proposer budget exhausted: info Reached maximum budget",
    });
    expect(proposerFailure({ timedOut: false, out: "fatal: denied\n", timeoutMs: 900000 })).toEqual({
      status: "crash",
      description: "proposer error: fatal: denied",
    });
  });
});

describe("results.tsv formatting (RULE-038, RULE-040, RULE-041)", () => {
  it("uses the legacy tab-separated results header", () => {
    expect(formatResultsHeader()).toBe("iter\tcommit\tdAST\tdCx\tbehavior\tmfence\tloss\tstatus\tdescription");
  });

  it("formats keep, revert, crash, and raise rows with legacy column values", () => {
    expect(
      formatResultRow({
        iter: 3,
        commit: "abc1234",
        dAST: -12,
        dCx: -2,
        behavior: true,
        mfence: 0.94,
        loss: -3.125,
        status: "keep",
        description: "ΔAST=-12 src/api/rules.ts",
      }),
    ).toBe("3\tabc1234\t-12\t-2\ttrue\t0.94\t-3.125\tkeep\tΔAST=-12 src/api/rules.ts");

    expect(
      formatResultRow({
        iter: 4,
        commit: "-",
        dAST: 0,
        dCx: 0,
        behavior: "-",
        mfence: 0.82,
        loss: "+Inf",
        status: "crash-timeout",
        description: "proposer timeout after 900000ms",
      }),
    ).toBe("4\t-\t0\t0\t-\t0.82\t+Inf\tcrash-timeout\tproposer timeout after 900000ms");

    expect(
      formatResultRow({
        iter: 5,
        commit: "-",
        dAST: 0,
        dCx: 0,
        behavior: true,
        mfence: 0.91,
        loss: "-",
        status: "raise-nogain",
        description: "api fence 88%→91% lo=88%",
      }),
    ).toBe("5\t-\t0\t0\ttrue\t0.91\t-\traise-nogain\tapi fence 88%→91% lo=88%");
  });
});
